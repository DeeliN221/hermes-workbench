"""Read the existing identity-scoped sidebar store without starting agent runtimes."""
from __future__ import annotations

import asyncio


async def profile_overview(service, user: str, profiles: list[dict]) -> dict:
    semaphore = asyncio.Semaphore(4)

    async def load(profile):
        name = profile['name']
        result = {**profile, 'projects': [], 'sessions': [], 'failed': []}
        if service is None:
            return result
        async with semaphore:
            async def read_groups():
                return await asyncio.to_thread(service.store.groups, user, name)

            async def read_sessions():
                rows = []
                offset = 0
                while True:
                    page = await asyncio.to_thread(service.store.list_sessions, user, name, 100, offset)
                    rows.extend(page)
                    if len(page) < 100:
                        return rows
                    offset += 100

            values = await asyncio.gather(read_groups(), read_sessions(), return_exceptions=True)
            for key, value in zip(('projects', 'sessions'), values):
                if isinstance(value, BaseException):
                    result['failed'].append(key)
                else:
                    result[key] = value
        return result

    return {'profiles': await asyncio.gather(*(load(profile) for profile in profiles))}
