from talentsift_ai.web.security import create_signed_session, verify_signed_session


def test_signed_session_round_trip() -> None:
    token = create_signed_session({"admin_id": 1}, "secret")

    assert verify_signed_session(token, "secret")["admin_id"] == 1


def test_signed_session_rejects_wrong_secret() -> None:
    token = create_signed_session({"admin_id": 1}, "secret")

    assert verify_signed_session(token, "other") is None
