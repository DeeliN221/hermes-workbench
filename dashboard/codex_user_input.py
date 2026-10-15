"""Validate answers to Codex's server-initiated question requests."""
from typing import Any
from fastapi import HTTPException

USER_INPUT_METHOD = 'item/tool/requestUserInput'


def user_input_result(params: dict[str, Any], answers: Any) -> dict[str, Any]:
    questions = params.get('questions')
    if not isinstance(questions, list) or not questions:
        raise HTTPException(409, 'Codex sent no answerable questions')
    ids = [q.get('id') for q in questions if isinstance(q, dict)]
    if len(ids) != len(questions) or any(not isinstance(i, str) or not i for i in ids) or len(set(ids)) != len(ids):
        raise HTTPException(409, 'Codex sent invalid question IDs')
    if not isinstance(answers, dict) or set(answers) != set(ids):
        raise HTTPException(400, 'Answer every question using its original ID')
    result = {}
    for question in questions:
        value = answers[question['id']]
        items = value.get('answers') if isinstance(value, dict) else None
        if not isinstance(items, list) or not items or any(not isinstance(v, str) or not v.strip() for v in items):
            raise HTTPException(400, 'Each question requires a non-empty answer')
        options = question.get('options')
        if isinstance(options, list) and options and not question.get('isOther', False):
            labels = {o.get('label') for o in options if isinstance(o, dict)}
            if any(v not in labels for v in items):
                raise HTTPException(400, 'Choose an offered answer for this question')
        result[question['id']] = {'answers': items}
    return {'answers': result}
