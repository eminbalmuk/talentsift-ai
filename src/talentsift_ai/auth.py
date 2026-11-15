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
    user_salt = secrets.token_hex(16)
    salt_material = f"{user_salt}:{pepper}".encode()
    key = hashlib.pbkdf2_hmac("sha256", normalized_secret.encode(), salt_material, 100_000)
    return f"pbkdf2$sha256${user_salt}${key.hex()}"


def verify_secret(secret: str, expected_hash: str, pepper: str = "") -> bool:
    normalized_secret = secret.strip()
    if expected_hash.startswith("pbkdf2$sha256$"):
        parts = expected_hash.split("$")
        if len(parts) != 4:
            return False
        _, _, user_salt, expected_digest = parts
        salt_material = f"{user_salt}:{pepper}".encode()
        actual_key = hashlib.pbkdf2_hmac(
            "sha256", normalized_secret.encode(), salt_material, 100_000
        )
        return hmac.compare_digest(actual_key.hex(), expected_digest)

    # Legacy static-salt PBKDF2-SHA256 fallback check for existing hashes
    legacy_pbkdf2_salt = pepper.encode("utf-8") if pepper else b"talentsift_ai_salt"
    legacy_pbkdf2 = hashlib.pbkdf2_hmac(
        "sha256", normalized_secret.encode("utf-8"), legacy_pbkdf2_salt, 100_000
    ).hex()
    if hmac.compare_digest(legacy_pbkdf2, expected_hash):
        return True

    # Legacy HMAC-SHA256 fallback check for existing hashes
    if pepper:
        legacy_hash = hmac.new(
            pepper.encode("utf-8"),
            normalized_secret.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
    else:
        legacy_hash = hashlib.sha256(normalized_secret.encode("utf-8")).hexdigest()

    return hmac.compare_digest(legacy_hash, expected_hash)


def secret_public_prefix(secret: str) -> str:
    return secret[:12]


def normalize_username(username: str) -> str:
    return username.strip().lower()


def slugify(value: str) -> str:
    slug = SLUG_PATTERN.sub("-", value.strip().lower()).strip("-")
    return slug or "organization"


def unique_slug(value: str) -> str:
    return f"{slugify(value)}-{secrets.token_hex(4)}"
