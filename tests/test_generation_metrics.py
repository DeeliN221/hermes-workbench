"""Throughput is durable, turn-scoped and independent of tool wall time."""
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).parents[1] / 'dashboard'))
from codex_bridge import BridgeStore
from generation_metrics import decorate

IDENTITY = ('reader', 'default', 'session')
BASE = 1800000000000


def emit(store, method, seconds, turn='turn', **params):
    return store.append_event(*IDENTITY, method, {'method': method, 'params': {'turnId': turn, 'timestamp': BASE + seconds * 1000, **params}})


def metrics(store, turn='turn'):
    return decorate(store.connection, IDENTITY, [{'id': turn}])[0]['generationMetrics']


def usage(store, seconds, output, response='r1', turn='turn'):
    return emit(store, 'token_usage_record', seconds, turn, response_id=response, output_tokens=output, reasoning_output_tokens=output // 2)


def test_generation_tool_wait_idle_duplicates_and_restart(tmp_path):
    path = tmp_path / 'db'
    store = BridgeStore(path)
    emit(store, 'turn/started', 0)
    emit(store, 'item/agentMessage/delta', 1, delta='a')
    emit(store, 'item/agentMessage/delta', 3, delta='b')
    usage(store, 3, 100)
    assert metrics(store)['tokensPerSecond'] == pytest.approx(100 / 3)
    emit(store, 'item/started', 3, item={'id': 'tool', 'type': 'commandExecution'})
    # Usage updates while a tool is running must not create a time window.
    usage(store, 20, 100)
    emit(store, 'item/completed', 100, item={'id': 'tool', 'type': 'commandExecution'})
    emit(store, 'item/reasoning/textDelta', 101, delta='x')
    emit(store, 'item/reasoning/textDelta', 103, delta='y')
    usage(store, 103, 100, response='r2')
    emit(store, 'item/agentMessage/delta', 200, delta='c')
    emit(store, 'item/agentMessage/delta', 202, delta='d')
    usage(store, 202, 100, response='r3')
    emit(store, 'turn/completed', 220)
    before = metrics(store)
    # Includes silent reasoning/request time; removes the 97-second tool run.
    assert before['activeSeconds'] == 105
    assert before['outputTokens'] == 300 and before['reasoningOutputTokens'] == 150
    assert before['tokensPerSecond'] == pytest.approx(300 / 105)
    # A replay and late final counter cannot add time or double-count output.
    usage(store, 202, 100, response='r3')
    usage(store, 240, 100, response='r3')
    assert metrics(store) == before
    store.close()
    store = BridgeStore(path)
    assert metrics(store) == before
    assert decorate(store.connection, ('other', 'default', 'session'), [{'id': 'turn'}])[0]['generationMetrics']['outputTokens'] == 0
    store.close()


def test_silent_reasoning_with_only_final_usage_produces_an_estimate(tmp_path):
    store = BridgeStore(tmp_path / 'db')
    emit(store, 'turn/started', 0)
    usage(store, 60, 3000)
    result = metrics(store)
    assert result['activeSeconds'] == 60
    assert result['tokensPerSecond'] == 50
    assert result['timingBasis'] == 'observed-response-time'
    # Freeze the denominator with the counter, including through finalization.
    emit(store, 'item/agentMessage/delta', 90, delta='late final text')
    emit(store, 'turn/completed', 100)
    assert metrics(store)['tokensPerSecond'] == 50
    store.close()


def test_parallel_tools_and_human_waits_are_excluded(tmp_path):
    store = BridgeStore(tmp_path / 'db')
    emit(store, 'turn/started', 0)
    emit(store, 'item/started', 2, item={'id': 'a', 'type': 'commandExecution'})
    emit(store, 'item/started', 3, item={'id': 'b', 'type': 'subAgentActivity'})
    emit(store, 'item/completed', 10, item={'id': 'a', 'type': 'commandExecution'})
    emit(store, 'item/completed', 20, item={'id': 'b', 'type': 'subAgentActivity'})
    emit(store, 'item/commandExecution/requestApproval', 22, approvalId='approval')
    emit(store, 'serverRequest/resolved', 100, requestId='approval')
    usage(store, 102, 300)
    assert metrics(store)['activeSeconds'] == 6
    assert metrics(store)['tokensPerSecond'] == 50
    store.close()


def test_final_counter_after_completion_does_not_charge_delivery_delay(tmp_path):
    store = BridgeStore(tmp_path / 'db')
    emit(store, 'turn/started', 0)
    emit(store, 'turn/completed', 10)
    usage(store, 30, 500)
    assert metrics(store)['samples'] == 0
    assert metrics(store)['activeSeconds'] == 10
    assert metrics(store)['tokensPerSecond'] == 50
    store.close()


def test_upstream_emission_time_survives_batched_delivery(tmp_path):
    store = BridgeStore(tmp_path / 'db')
    def notification(method, seconds, **params):
        return store.append_event(*IDENTITY, method, {
            'method': method, 'emittedAtMs': BASE + seconds * 1000,
            'params': {'turnId': 'turn', **params}})
    notification('turn/started', 0)
    notification('thread/tokenUsage/updated', 10, tokenUsage={
        'total': {'outputTokens': 500}, 'last': {'outputTokens': 500}})
    assert metrics(store)['activeSeconds'] == 10
    assert metrics(store)['tokensPerSecond'] == 50
    notification('item/agentMessage/delta', 5, delta='delayed')
    notification('thread/tokenUsage/updated', 12, tokenUsage={
        'total': {'outputTokens': 600}, 'last': {'outputTokens': 100}})
    assert metrics(store)['activeSeconds'] == 12
    assert metrics(store)['tokensPerSecond'] == 50
    store.close()


def test_thread_totals_are_differenced_not_added_and_turns_are_isolated(tmp_path):
    store = BridgeStore(tmp_path / 'db')
    def count(seconds, total, last, turn='turn'):
        return emit(store, 'event_msg', seconds, turn, msg={'type': 'token_count', 'info': {
            'total_token_usage': {'output_tokens': total, 'reasoning_output_tokens': 0},
            'last_token_usage': {'output_tokens': last, 'reasoning_output_tokens': 0}}})
    count(1, 1100, 100)
    count(3, 1200, 200)
    assert metrics(store)['outputTokens'] == 200
    assert metrics(store)['tokensPerSecond'] is None
    usage(store, 3, 200)  # Alternative reporting of the same response.
    assert metrics(store)['outputTokens'] == 200
    count(10, 1250, 50, 'second')
    count(12, 1300, 100, 'second')
    assert metrics(store, 'second')['outputTokens'] == 100
    assert metrics(store)['outputTokens'] == 200
    count(13, 1100, 100)  # Delayed old snapshot cannot reset thread totals.
    assert metrics(store)['outputTokens'] == 200
    count(14, 1300, 100, 'second')
    assert metrics(store, 'second')['outputTokens'] == 100
    store.close()


@pytest.mark.parametrize('gap', [0, .1, 10])
def test_insufficient_samples(gap, tmp_path):
    store = BridgeStore(tmp_path / 'db')
    usage(store, 0, 20)
    assert metrics(store)['tokensPerSecond'] is None
    usage(store, gap, 40)
    assert metrics(store)['tokensPerSecond'] is None
    store.close()


def test_invalid_and_unscoped_usage_cannot_pollute_turn(tmp_path):
    store = BridgeStore(tmp_path / 'db')
    emit(store, 'turn/started', 0)
    usage(store, 1, float('nan'))
    assert metrics(store)['outputTokens'] == 0
    store.append_event(*IDENTITY, 'token_usage_record', {'params': {'output_tokens': 9000}})
    assert metrics(store)['outputTokens'] == 0
    store.close()


def test_raw_rollout_generation_and_short_tool_wait(tmp_path):
    store = BridgeStore(tmp_path / 'db')
    def event(seconds, kind, **data):
        return emit(store, 'event_msg', seconds, msg={'type': kind, **data})
    event(1, 'agent_message_delta', delta='a')
    event(2, 'agent_message_delta', delta='b')
    usage(store, 2, 40)
    event(2, 'exec_command_begin', call_id='tool')
    event(4, 'exec_command_end', call_id='tool')
    event(4, 'agent_message_delta', delta='c')
    event(5, 'agent_message_delta', delta='d')
    # Until the counter arrives, don't divide old tokens by a newer time span.
    assert metrics(store)['tokensPerSecond'] is None
    usage(store, 5, 80)
    assert metrics(store)['activeSeconds'] == 2
    assert metrics(store)['tokensPerSecond'] is None
    store.close()


def test_nested_usage_record_and_camel_case_notification(tmp_path):
    store = BridgeStore(tmp_path / 'db')
    emit(store, 'item/agentMessage/delta', 1, delta='a')
    emit(store, 'event_msg', 3, msg={'type': 'token_usage_record', 'payload': {
        'turn_id': 'turn', 'response_id': 'r1', 'usage': {'output_tokens': 100, 'reasoning_output_tokens': 20}}})
    assert metrics(store)['tokensPerSecond'] is None
    emit(store, 'thread/tokenUsage/updated', 3, tokenUsage={'total': {'outputTokens': 500}, 'last': {'outputTokens': 100}})
    assert metrics(store)['outputTokens'] == 100
    assert metrics(store)['reasoningOutputTokens'] == 20
    store.close()


def test_large_tool_output_never_inflates_model_tokens(tmp_path):
    store = BridgeStore(tmp_path / 'db')
    emit(store, 'item/agentMessage/delta', 1, delta='a')
    usage(store, 2, 40)
    before = metrics(store)
    emit(store, 'item/started', 2, item={'id': 'tool', 'type': 'commandExecution'})
    emit(store, 'item/commandExecution/outputDelta', 3, delta='tool output ' * 100000)
    emit(store, 'item/completed', 30, item={'id': 'tool', 'type': 'commandExecution', 'aggregatedOutput': 'x' * 1000000})
    after = metrics(store)
    assert after['outputTokens'] == before['outputTokens'] == 40
    assert after['activeSeconds'] == before['activeSeconds']
    assert after['timingBasis'] == 'observed-event-gaps'
    assert after['tokensPerSecond'] is None
    store.close()
