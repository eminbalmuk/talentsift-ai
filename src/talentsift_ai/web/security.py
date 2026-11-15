import base64
import hashlib
import hmac
import json
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request

MAX_SESSION_TOKEN_BYTES = 8192
ALLOWED_LINK_SCHEMES = ("http://", "https://")


def create_signed_session(payload: dict[str, Any], secret: str, ttl_seconds: int = 28_800) -> str:
    if not secret:
        raise ValueError("Session secret must not be empty.")
    now = int(time.time())
    issued_payload = {**payload, "iat": now, "exp": now + ttl_seconds}
    body = _b64encode(json.dumps(issued_payload, separators=(",", ":")).encode("utf-8"))
    signature = _sign(body, secret)
    return f"{body}.{signature}"


def verify_signed_session(
    token: str,
    secret: str,
    *,
    expected_role: str | None = None,
) -> dict[str, Any] | None:
    if not secret or not token or len(token) > MAX_SESSION_TOKEN_BYTES or "." not in token:
        return None
    body, signature = token.rsplit(".", 1)
    if not hmac.compare_digest(signature, _sign(body, secret)):
        return None
    try:
        payload = json.loads(_b64decode(body))
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None
    try:
        exp = int(payload.get("exp", 0))
    except (ValueError, TypeError):
        return None
    if exp < int(time.time()):
        return None
    if expected_role is not None and payload.get("role") != expected_role:
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


class AuthRateLimiter:
    """In-memory sliding-window rate limiter to protect login/register endpoints."""

    def __init__(self, *, max_attempts: int = 12, window_seconds: int = 60) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> int | None:
        """Records an attempt and returns Retry-After seconds if limit exceeded, else None."""
        now = time.monotonic()
        cutoff = now - self.window_seconds
        bucket = self._hits[key]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= self.max_attempts:
            retry_after = max(1, int(self.window_seconds - (now - bucket[0])) + 1)
            return retry_after
        bucket.append(now)
        return None

    def reset(self) -> None:
        self._hits.clear()


auth_rate_limiter = AuthRateLimiter(max_attempts=12, window_seconds=60)


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def enforce_auth_rate_limit(request: Request, *, scope: str) -> None:
    key = f"{scope}:{get_client_ip(request)}"
    retry_after = auth_rate_limiter.check(key)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Çok fazla deneme yapıldı. Lütfen kısa süre bekleyip tekrar deneyin.",
            headers={"Retry-After": str(retry_after)},
        )


def validate_safe_filename(filename: str | None, *, default: str = "resume.pdf") -> str:
    if not filename:
        return default
    clean = Path(filename.replace("\\", "/").replace("\x00", "")).name.strip()
    return (clean or default)[:180]


def validate_resume_magic_bytes(content: bytes, suffix: str) -> None:
    """Reject disguised binaries uploaded under .pdf or .docx extensions."""
    if suffix == ".pdf" and not content.lstrip().startswith(b"%PDF"):
        raise ValueError("Geçersiz PDF dosyası (dosya başlığı %PDF ile başlamıyor).")
    if suffix == ".docx" and not content.startswith(b"PK\x03\x04"):
        raise ValueError("Geçersiz Word (.docx) dosyası (bozuk veya geçersiz arşiv başlığı).")


def validate_safe_location_or_link(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    lowered = cleaned.lower()
    if lowered.startswith(("javascript:", "data:", "vbscript:")):
        raise ValueError("Güvenlik nedeniyle bu bağlantı şemasına izin verilmiyor.")
    return cleaned
