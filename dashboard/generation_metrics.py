"""Turn-local provider output counters and observed response-time estimates.

Output counters include reasoning tokens (a subset, never added twice), never
text lengths or tool output. Response time includes hidden reasoning and request
latency, with tool execution and approval waits removed. It is an estimate, not
authoritative model-only generation time. Legacy event gaps remain diagnostic.
"""
import json
import math
from datetime import datetime

MAX_GAP_MS = 5000


def install_schema(connection):
    connection.execute('''CREATE TABLE IF NOT EXISTS codex_generation_metrics (
        user_id TEXT, profile TEXT, session_id TEXT, turn_id TEXT, state TEXT,
        PRIMARY KEY(user_id, profile, session_id, turn_id))''')


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def timestamp(value, fallback):
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000
        except ValueError:
            return fallback
    value = number(value)
    return (value * 1000 if value < 1e12 else value) if value is not None else fallback


def public(state):
    output = max(state.get('recordOutput', 0), state.get('countOutput', 0))
    reasoning = max(state.get('recordReasoning', 0), state.get('countReasoning', 0))
    estimated = 'responseUsageMs' in state
    active = state.get('responseUsageMs', state.get('usageActiveMs', 0))
    rate = output / (active / 1000) if estimated and active >= 250 and output >= 2 else None
    return dict(outputTokens=output, reasoningOutputTokens=reasoning if state.get('hasReasoning') else None,
                activeSeconds=active / 1000, firstGeneratedAt=state.get('first'), lastGeneratedAt=state.get('last'),
                samples=state.get('samples', 0),
                timingBasis='observed-response-time' if estimated else 'observed-event-gaps', tokensPerSecond=rate)


def read_state(connection, identity, turn):
    row = connection.execute('SELECT state FROM codex_generation_metrics WHERE user_id=? AND profile=? AND session_id=? AND turn_id=?', (*identity, turn)).fetchone()
    return json.loads(row[0]) if row else {}


def write_state(connection, identity, turn, state):
    connection.execute('INSERT INTO codex_generation_metrics VALUES (?,?,?,?,?) ON CONFLICT(user_id,profile,session_id,turn_id) DO UPDATE SET state=excluded.state', (*identity, turn, json.dumps(state)))


def observe(connection, identity, method, payload, observed_at):
    """Called within append_events' transaction, only for newly inserted events."""
    params = payload.get('params', payload)
    if not isinstance(params, dict):
        return None
    body = params.get('msg', params.get('event', params))
    if not isinstance(body, dict):
        return None
    if body.get('type') == 'event_msg':
        nested = body.get('payload')
        if not isinstance(nested, dict):
            return None
        body = {**body, **nested}
    if not isinstance(body, dict):
        return None
    if body.get('type') == 'token_usage_record' and isinstance(body.get('payload'), dict):
        body = {**body, **body['payload']}
    turn = params.get('turn', {})
    turn_id = params.get('turnId') or params.get('turn_id') or body.get('turn_id') or body.get('turnId') or (turn.get('id') if isinstance(turn, dict) else None)
    # Never attribute an unscoped counter to whichever turn happens to be active.
    if not turn_id:
        return None
    state = read_state(connection, identity, str(turn_id))
    state.setdefault('samples', 0)
    kind = str(body.get('type', method))
    usage = None
    total = None
    if kind == 'token_count' or method.endswith('/token_count') or method == 'thread/tokenUsage/updated':
        info = body.get('info') or params.get('tokenUsage') or {}
        if isinstance(info, dict):
            total = info.get('total_token_usage', info.get('total'))
            usage = info.get('last_token_usage', info.get('last'))
    elif kind == 'token_usage_record' or method.endswith('token_usage_record'):
        usage = body.get('usage', body.get('token_usage', body))
    def counters(value):
        if not isinstance(value, dict):
            return None
        output = number(value.get('output_tokens', value.get('outputTokens')))
        reasoning = number(value.get('reasoning_output_tokens', value.get('reasoningOutputTokens')))
        if output is None or output > 2**53 - 1 or int(output) != output:
            return None
        if reasoning is not None and (reasoning > output or int(reasoning) != reasoning):
            reasoning = None
        return output, reasoning
    previous_output = max(state.get('recordOutput', 0), state.get('countOutput', 0))
    values, totals = counters(usage), counters(total)
    if totals:
        session = read_state(connection, identity, '')
        previous = session.get('total')
        # First observation may belong to imported history: only the last
        # response is attributable, never the entire thread's lifetime total.
        delta = max(0, totals[0] - previous[0]) if previous else (values[0] if values else 0)
        delta_r = (max(0, (totals[1] or 0) - (previous[1] or 0)) if totals[0] >= previous[0] else 0) if previous else ((values[1] or 0) if values else 0)
        state['countOutput'] = state.get('countOutput', 0) + delta
        state['countReasoning'] = state.get('countReasoning', 0) + delta_r
        # A delayed/replayed older snapshot cannot reset the high-water mark.
        if previous is None or totals[0] >= previous[0]:
            session['total'] = totals
        write_state(connection, identity, '', session)
    elif values:
        response_id = body.get('response_id') or params.get('response_id') or params.get('responseId')
        # Without a response id, counters are treated as a turn snapshot.
        records = state.setdefault('responses', {})
        key = str(response_id or 'turn')
        previous = records.get(key, [0, 0])
        records[key] = [max(previous[0], values[0]), max(previous[1], values[1] or 0)]
        state['recordOutput'] = sum(row[0] for row in records.values())
        state['recordReasoning'] = sum(row[1] for row in records.values())
    if (values and values[1] is not None) or (totals and totals[1] is not None):
        state['hasReasoning'] = True
    item = params.get('item')
    item = item if isinstance(item, dict) else {}
    item_type = item.get('type')
    raw_tool_start = kind in {'exec_command_begin', 'mcp_tool_call_begin', 'web_search_begin', 'patch_apply_begin'}
    raw_tool_end = kind in {'exec_command_end', 'mcp_tool_call_end', 'web_search_end', 'patch_apply_end'}
    tool = raw_tool_start or raw_tool_end or item_type in {'commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'imageView', 'collabAgentToolCall', 'subAgentActivity'}
    now = timestamp(payload.get('emittedAtMs', body.get('timestamp', params.get('timestamp', payload.get('timestamp')))), observed_at * 1000)
    generating = kind in {'agent_message_delta', 'agent_reasoning_delta', 'reasoning_content_delta'} or method.startswith(('item/agentMessage/', 'item/reasoning/')) and method.endswith(('delta', 'Delta'))
    # Counter updates can timestamp generation when textual deltas are absent.
    output = max(state.get('recordOutput', 0), state.get('countOutput', 0))
    generating = generating or bool((values or totals) and output > previous_output)
    # A turn boundary is required: imported fragments cannot establish a full
    # response duration. Unlike delta gaps, this includes non-streamed reasoning.
    if method == 'turn/started' or kind == 'task_started':
        state.setdefault('responseClock', now)
        state.setdefault('responseActiveMs', 0)
    clock = state.get('responseClock')
    if clock is not None and not state.get('finished'):
        now = max(now, clock)  # Delayed events cannot move the clock backwards.
        if not state.get('tools') and not state.get('responsePaused'):
            state['responseActiveMs'] += now - clock
        state['responseClock'] = now
        if 'requestApproval' in method or method.endswith('/requestUserInput'):
            state['responsePaused'] = True
        elif method == 'serverRequest/resolved' or generating or tool and (method == 'item/started' or raw_tool_start):
            # Some adapters omit turnId on resolution; the next scoped model or
            # tool event also safely resumes without charging the human wait.
            state.pop('responsePaused', None)
    if tool:
        tools = set(state.get('tools', []))
        tool_id = str(item.get('id') or body.get('call_id') or kind.rsplit('_', 1)[0])
        if method == 'item/started' or raw_tool_start:
            tools.add(tool_id)
        elif method == 'item/completed' or raw_tool_end:
            tools.discard(tool_id)
        state['tools'] = sorted(tools)
    if method in {'turn/completed', 'turn/failed'}:
        state['finished'] = True
    if tool or 'requestApproval' in method or method in {'turn/completed', 'turn/failed', 'turn/started'}:
        state.pop('window', None)
    elif generating and not state.get('tools') and not state.get('finished'):
        previous = state.get('window')
        if previous is None or now > previous:
            if previous is not None and now - previous <= MAX_GAP_MS:
                state['activeMs'] = state.get('activeMs', 0) + now - previous
            state['window'] = now
            state.setdefault('first', now)
            state['last'] = now
            state['samples'] = state.get('samples', 0) + 1
    if (values or totals) and output > previous_output:
        state['usageActiveMs'] = state.get('activeMs', 0)
        if clock is not None:
            # Freeze time with its counter; new text must not dilute old usage.
            state['responseUsageMs'] = state.get('responseActiveMs', 0)
    write_state(connection, identity, str(turn_id), state)
    return {'turnId': str(turn_id), **public(state)}


def decorate(connection, identity, turns):
    metrics = {row[0]: public(json.loads(row[1])) for row in connection.execute('SELECT turn_id,state FROM codex_generation_metrics WHERE user_id=? AND profile=? AND session_id=? AND turn_id<>\'\'', identity)}
    return [{**turn, 'generationMetrics': metrics.get(str(turn.get('id')), public({}))} for turn in turns]
