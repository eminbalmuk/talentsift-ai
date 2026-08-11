from talentsift_ai.auth import (
    generate_admin_username,
    generate_license_key,
    generate_organization_username,
    generate_password,
    hash_secret,
    normalize_username,
    secret_public_prefix,
    slugify,
    unique_slug,
    verify_secret,
)


def test_secret_hash_verification_uses_pepper() -> None:
    password = generate_password()
    secret_hash = hash_secret(password, pepper="secret")

    assert verify_secret(password, secret_hash, pepper="secret")
    assert not verify_secret(password, secret_hash, pepper="different")


def test_secret_has_expected_public_prefix() -> None:
    password = "pw_abcdefghijklmnopqrstuvwxyz"

    assert secret_public_prefix(password) == "pw_abcdefghi"


def test_random_credentials_use_expected_prefixes() -> None:
    assert generate_admin_username().startswith("adm_")
    assert generate_organization_username().startswith("org_")
    assert generate_password().startswith("pw_")
    assert generate_license_key().startswith("lic_")


def test_normalize_username() -> None:
    assert normalize_username("  Admin@Acme.COM ") == "admin@acme.com"


def test_slugify() -> None:
    assert slugify("Acme Corp, Inc.") == "acme-corp-inc"


def test_unique_slug_adds_suffix() -> None:
    assert unique_slug("Acme Corp").startswith("acme-corp-")
