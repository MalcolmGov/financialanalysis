"""HMAC-signed terminal webhooks back to the portal. Retried up to 3x."""
from __future__ import annotations

import hashlib
import hmac
import json
import time

import httpx

from .config import settings


def sign(raw: bytes) -> str:
    return hmac.new(
        settings().webhook_hmac_key.encode(), raw, hashlib.sha256
    ).hexdigest()


def send_webhook(url: str, payload: dict) -> bool:
    raw = json.dumps(payload, separators=(",", ":")).encode()
    signature = sign(raw)
    for attempt in range(3):
        try:
            resp = httpx.post(
                url,
                content=raw,
                headers={
                    "content-type": "application/json",
                    "x-signature": signature,
                },
                timeout=30,
            )
            if resp.status_code < 300:
                return True
        except httpx.HTTPError:
            pass
        time.sleep(2 * (attempt + 1))
    return False
