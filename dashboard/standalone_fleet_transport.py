"""Normalize real Fleet list metadata before domain ownership checks."""
from __future__ import annotations

import asyncio
import re

from fastapi import HTTPException


class FleetOriginTransport:
    """Some Fleet versions omit origin only on list rows; details remain authoritative.

    Credentials and all HTTP stay in the injected backend transport. This adapter
    never authorizes a task: the services router still compares the hydrated
    origin with the current authenticated context before returning any row.
    """

    def __init__(self, transport):
        self.transport = transport

    async def __call__(self, method, path, body=None, params=None):
        value = await self.transport(method, path, body, params)
        if method != 'GET' or path != '/tasks':
            return value
        rows = value.get('tasks') if isinstance(value, dict) else value
        if not isinstance(rows, list) or len(rows) > 1000:
            raise HTTPException(502, 'Invalid Fleet task list')

        slots = asyncio.Semaphore(8)

        async def hydrate(row):
            if not isinstance(row, dict):
                raise HTTPException(502, 'Invalid Fleet task row')
            if isinstance(row.get('origin'), dict):
                return row
            task_id = row.get('id')
            if not isinstance(task_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', task_id):
                raise HTTPException(502, 'Invalid Fleet task identifier')
            async with slots:
                detail = await self.transport('GET', '/tasks/' + task_id)
            task = detail.get('task') if isinstance(detail, dict) else None
            origin = task.get('origin') if isinstance(task, dict) else None
            if not isinstance(task, dict) or task.get('id') != task_id:
                raise HTTPException(502, 'Fleet task ownership metadata unavailable')
            # Legacy/unowned tasks may genuinely have no origin in details.
            # Leave them unverified so the domain ownership check excludes them.
            return {**row, 'origin': origin} if isinstance(origin, dict) else row

        hydrated = await asyncio.gather(*(hydrate(row) for row in rows))
        return {**value, 'tasks': hydrated} if isinstance(value, dict) else hydrated
