from talentsift_ai.web.security import create_signed_session, verify_signed_session


def test_signed_session_round_trip() -> None:
    token = create_signed_session({"admin_id": 1}, "secret")

    assert verify_signed_session(token, "secret")["admin_id"] == 1


def test_signed_session_rejects_wrong_secret() -> None:
    token = create_signed_session({"admin_id": 1}, "secret")

    assert verify_signed_session(token, "other") is None


def test_signed_session_enforces_expected_role() -> None:
    admin_token = create_signed_session({"role": "admin", "admin_id": 1}, "secret")
    assert verify_signed_session(admin_token, "secret", expected_role="admin") is not None
    assert verify_signed_session(admin_token, "secret", expected_role="org") is None
    assert verify_signed_session(admin_token, "secret", expected_role="candidate") is None
