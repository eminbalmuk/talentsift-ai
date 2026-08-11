import base64
import hashlib
import hmac
import json
import time
from typing import Any


def create_signed_session(payload: dict[str, Any], secret: str, ttl_seconds: int = 28_800) -> str:
    issued_payload = {**payload, "exp": int(time.time()) + ttl_seconds}
    body = _b64encode(json.dumps(issued_payload, separators=(",", ":")).encode("utf-8"))
    signature = _sign(body, secret)
    return f"{body}.{signature}"


def verify_signed_session(token: str, secret: str) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    body, signature = token.rsplit(".", 1)
    if not hmac.compare_digest(signature, _sign(body, secret)):
        return None
    try:
        payload = json.loads(_b64decode(body))
    except (ValueError, TypeError):
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload


def _sign(body: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest()
    return _b64encode(digest)


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)

