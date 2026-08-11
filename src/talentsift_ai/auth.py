import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass

ADMIN_USERNAME_PREFIX = "adm"
ORG_USERNAME_PREFIX = "org"
PASSWORD_PREFIX = "pw"
LICENSE_KEY_PREFIX = "lic"
CREDENTIAL_BYTES = 32
SLUG_PATTERN = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class AdminCredential:
    admin_id: int
    username: str
    password: str
    password_prefix: str


@dataclass(frozen=True)
class OrganizationCredential:
    organization_id: int
    display_name: str
    username: str
    password: str
    password_prefix: str
    license_key: str
    license_key_prefix: str


def generate_admin_username() -> str:
    return f"{ADMIN_USERNAME_PREFIX}_{secrets.token_urlsafe(CREDENTIAL_BYTES)}"


def generate_organization_username() -> str:
    return f"{ORG_USERNAME_PREFIX}_{secrets.token_urlsafe(CREDENTIAL_BYTES)}"


def generate_password() -> str:
    return f"{PASSWORD_PREFIX}_{secrets.token_urlsafe(CREDENTIAL_BYTES)}"


def generate_license_key() -> str:
    return f"{LICENSE_KEY_PREFIX}_{secrets.token_urlsafe(CREDENTIAL_BYTES)}"


def hash_secret(secret: str, pepper: str = "") -> str:
    normalized_secret = secret.strip()
    if pepper:
        return hmac.new(
            pepper.encode("utf-8"),
            normalized_secret.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
    return hashlib.sha256(normalized_secret.encode("utf-8")).hexdigest()


def verify_secret(secret: str, expected_hash: str, pepper: str = "") -> bool:
    actual_hash = hash_secret(secret, pepper=pepper)
    return hmac.compare_digest(actual_hash, expected_hash)


def secret_public_prefix(secret: str) -> str:
    return secret[:12]


def normalize_username(username: str) -> str:
    return username.strip().lower()


def slugify(value: str) -> str:
    slug = SLUG_PATTERN.sub("-", value.strip().lower()).strip("-")
    return slug or "organization"


def unique_slug(value: str) -> str:
    return f"{slugify(value)}-{secrets.token_hex(4)}"
