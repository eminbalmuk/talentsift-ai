from talentsift_ai.settings import Settings


def test_settings_parse_comma_separated_mistral_keys() -> None:
    settings = Settings(mistral_api_keys="key-1, key-2,,key-3")

    assert settings.mistral_api_keys == ["key-1", "key-2", "key-3"]
