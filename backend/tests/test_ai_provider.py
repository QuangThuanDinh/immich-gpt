import socket
from unittest.mock import patch

import pytest

from app.config import settings
from app.services.ai_provider import (
    OpenAIProvider,
    OpenRouterProvider,
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


def test_openai_provider_uses_custom_base_url():
    public_address = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))
    ]

    with patch("app.services.url_validation.socket.getaddrinfo", return_value=public_address):
        with patch("openai.OpenAI") as openai:
            OpenAIProvider("key", base_url="https://gateway.example.com/v1")

    assert openai.call_args.kwargs["base_url"] == "https://gateway.example.com/v1"


def test_azure_openai_v1_appends_api_base_and_uses_deployment():
    public_address = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))
    ]

    with patch("app.services.url_validation.socket.getaddrinfo", return_value=public_address):
        with patch("openai.OpenAI") as openai:
            provider = OpenAIProvider(
                "key",
                base_url="https://resource.openai.azure.com",
                azure_deployment="vision-deployment",
            )

    assert openai.call_args.kwargs["base_url"] == (
        "https://resource.openai.azure.com/openai/v1"
    )
    assert provider.model == "vision-deployment"
    assert provider.verification_skipped is True
    assert provider.health_check() is True
    openai.return_value.models.list.assert_not_called()


def test_versioned_azure_openai_uses_azure_client():
    public_address = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))
    ]

    with patch("app.services.url_validation.socket.getaddrinfo", return_value=public_address):
        with patch("openai.AzureOpenAI") as azure_openai:
            provider = OpenAIProvider(
                "key",
                base_url="https://resource.openai.azure.com/",
                azure_api_version="2024-10-21",
                azure_deployment="vision-deployment",
            )

    azure_openai.assert_called_once_with(
        api_key="key",
        azure_endpoint="https://resource.openai.azure.com",
        api_version="2024-10-21",
        azure_deployment="vision-deployment",
        timeout=120,
    )
    assert provider.model == "vision-deployment"
    assert provider.verification_skipped is True


def test_azure_openai_rejects_missing_api_key():
    with pytest.raises(ValueError, match="requires an API key"):
        OpenAIProvider(
            "",
            base_url="https://resource.openai.azure.com",
            azure_deployment="vision-deployment",
        )


def test_openrouter_uses_default_api_base():
    public_address = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))
    ]

    with patch("app.services.url_validation.socket.getaddrinfo", return_value=public_address):
        with patch("openai.OpenAI") as openai:
            build_provider("openrouter", {"api_key": "key"})

    assert openai.call_args.kwargs["base_url"] == "https://openrouter.ai/api/v1"


def test_openrouter_health_check_rejects_unauthorized_response():
    public_address = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))
    ]

    with patch("app.services.url_validation.socket.getaddrinfo", return_value=public_address):
        with patch("openai.OpenAI"):
            provider = OpenRouterProvider("invalid-key")
    with patch("httpx.get") as http_get:
        http_get.return_value.status_code = 401
        assert provider.health_check() is False
    assert http_get.call_args.args[0] == "https://openrouter.ai/api/v1/auth/key"


def test_custom_openrouter_health_check_uses_models(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_SERVICE_URLS", True)

    with patch("openai.OpenAI"):
        provider = OpenRouterProvider(
            "key",
            base_url="http://192.168.0.19:4000",
        )
    with patch("httpx.get") as http_get:
        http_get.return_value.status_code = 200
        assert provider.health_check() is True
    assert http_get.call_args.args[0] == "http://192.168.0.19:4000/api/v1/models"


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
