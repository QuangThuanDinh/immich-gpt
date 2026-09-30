import socket
from unittest.mock import patch

import pytest

from app.config import settings
from app.services.ai_provider import (
    OpenAIProvider,
    get_openrouter_api_base_url,
    build_provider,
)
from app.services.url_validation import ServiceUrlError


def test_openai_provider_sets_default_timeout():
    with patch("openai.OpenAI") as openai:
        OpenAIProvider("key")

    openai.assert_called_once_with(api_key="key", timeout=120)


def test_build_provider_allows_openai_timeout_override():
    with patch("openai.OpenAI") as openai:
        build_provider("openai", {"api_key": "key", "timeout": 45})

    openai.assert_called_once_with(api_key="key", timeout=45)


def test_openrouter_uses_default_api_base():
    public_address = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))
    ]

    with patch("app.services.url_validation.socket.getaddrinfo", return_value=public_address):
        with patch("openai.OpenAI") as openai:
            build_provider("openrouter", {"api_key": "key"})

    assert openai.call_args.kwargs["base_url"] == "https://openrouter.ai/api/v1"


def test_openrouter_appends_api_path_to_custom_origin(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_SERVICE_URLS", True)

    with patch("openai.OpenAI") as openai:
        build_provider(
            "openrouter",
            {
                "api_key": "key",
                "base_url": "http://192.168.0.19:4000/",
            },
        )

    assert openai.call_args.kwargs["base_url"] == "http://192.168.0.19:4000/api/v1"


def test_openrouter_rejects_base_url_with_path(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_SERVICE_URLS", True)

    with pytest.raises(ServiceUrlError, match="must be an origin"):
        get_openrouter_api_base_url("http://192.168.0.19:4000/custom")
