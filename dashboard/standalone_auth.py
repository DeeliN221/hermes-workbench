"""Explicit local-cookie or trusted-proxy authentication; no forwarded-header trust."""
from __future__ import annotations

import hmac
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from fastapi import HTTPException


def private_secret_file(path: str) -> str:
    source = Path(path)
    info = source.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise ValueError('Credential must be an owner-only regular file (0600)')
    value = source.read_text().strip()
    if not value:
        raise ValueError('Credential file is empty')
    return value


@dataclass(frozen=True)
class AuthPolicy:
    mode: str
    secret: str = ''
    users: frozenset[str] = frozenset()
    public_origin: str = ''
    hosts: frozenset[str] = frozenset()

    @classmethod
    def from_environment(cls):
        mode = os.environ.get('WORKBENCH_AUTH_MODE', 'local')
        if mode == 'local':
            return cls(mode)
        if mode != 'trusted-proxy':
            raise ValueError('WORKBENCH_AUTH_MODE must be local or trusted-proxy')
        secret_path = os.environ.get('WORKBENCH_TRUSTED_PROXY_SECRET_FILE') or os.environ.get('HERMES_DASHBOARD_TRUSTED_PROXY_SECRET_FILE')
        secret = private_secret_file(secret_path) if secret_path else os.environ.get('WORKBENCH_TRUSTED_PROXY_SECRET') or os.environ.get('HERMES_DASHBOARD_TRUSTED_PROXY_SECRET', '')
        users = frozenset(filter(None, re.split(r'[,;\s]+', os.environ.get('WORKBENCH_ALLOWED_USERS') or os.environ.get('HERMES_WORKBENCH_ALLOWED_USERS', ''))))
        origin = os.environ.get('WORKBENCH_PUBLIC_ORIGIN', '').rstrip('/')
        hosts = frozenset(value.strip().lower() for value in os.environ.get('WORKBENCH_ALLOWED_HOSTS', '').split(',') if value.strip())
        parsed = urlparse(origin)
        if not secret or not users or not hosts or parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            raise ValueError('Trusted proxy requires a secret, allowed users, HTTPS public origin and allowed hosts')
        if any('/' in value or '*' in value or not value for value in hosts) or parsed.netloc.lower() not in hosts:
            raise ValueError('Allowed hosts must explicitly include the public origin authority')
        return cls(mode, secret, users, origin, hosts)

    def verify(self, *, headers, scheme: str, path: str, method: str, cookie: str = '', local_cookie: str = '', websocket=False):
        host = headers.get('host', '').lower()
        if self.mode == 'trusted-proxy':
            if host not in self.hosts:
                raise HTTPException(403, 'Untrusted host')
            expected_origin = self.public_origin
            if not hmac.compare_digest(headers.get('x-hermes-proxy-secret', ''), self.secret):
                raise HTTPException(401, 'Trusted proxy authentication required')
            user = headers.get('remote-user', '')
            if not user or user not in self.users:
                raise HTTPException(403, 'User is not allowed')
        else:
            parsed = urlparse('http://' + host)
            if parsed.hostname not in ('localhost', '127.0.0.1', '::1', 'testserver'):
                raise HTTPException(403, 'Untrusted host')
            expected_origin = ('https' if scheme in ('https', 'wss') else 'http') + '://' + host
            if path != '/api/standalone/bootstrap' or websocket:
                if not local_cookie or not hmac.compare_digest(cookie, local_cookie):
                    raise HTTPException(401, 'Open the local bootstrap URL to authenticate')
            user = 'local-owner'
        origin = headers.get('origin')
        if (websocket and not origin) or origin and origin != expected_origin:
            raise HTTPException(403, 'Cross-origin request rejected')
        if not websocket and method not in ('GET', 'HEAD', 'OPTIONS') and headers.get('x-workbench-request') != '1':
            raise HTTPException(403, 'Same-origin request header required')
        return user
