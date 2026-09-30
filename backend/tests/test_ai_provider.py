import socket
from unittest.mock import MagicMock, patch

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


def test_azure_openai_v1_accepts_full_api_base():
    public_address = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))
    ]

    with patch("app.services.url_validation.socket.getaddrinfo", return_value=public_address):
        with patch("openai.OpenAI") as openai:
            provider = OpenAIProvider(
                "key",
                base_url="https://resource.openai.azure.com/openai/v1/",
                azure_deployment="vision-deployment",
            )

    assert openai.call_args.kwargs["base_url"] == (
        "https://resource.openai.azure.com/openai/v1"
    )
    assert provider.model == "vision-deployment"


def test_versioned_azure_openai_uses_azure_client():
    public_address = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))
    ]

    with patch("app.services.url_validation.socket.getaddrinfo", return_value=public_address):
        with patch("openai.AzureOpenAI") as azure_openai:
            provider = OpenAIProvider(
                "key",
                base_url="https://resource.openai.azure.com/openai/v1",
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
    assert openai.call_args.kwargs["default_headers"]["X-OpenRouter-Title"] == "immich-gpt"


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
    assert http_get.call_args.args[0] == "https://openrouter.ai/api/v1/key"


def test_custom_openrouter_health_check_uses_models(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_SERVICE_URLS", True)

    with patch("openai.OpenAI"):
        provider = OpenRouterProvider(
            "key",
            base_url="http://192.168.0.19:4000/v1",
        )
    with patch("httpx.get") as http_get:
        http_get.return_value.status_code = 200
        assert provider.health_check() is True
    assert http_get.call_args.args[0] == "http://192.168.0.19:4000/v1/models"


def test_openrouter_uses_custom_api_base_exactly(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_SERVICE_URLS", True)

    with patch("openai.OpenAI") as openai:
        build_provider(
            "openrouter",
            {
                "api_key": "key",
                "base_url": "http://192.168.0.19:4000/v1/",
            },
        )

    assert openai.call_args.kwargs["base_url"] == "http://192.168.0.19:4000/v1"


def test_openrouter_rejects_base_url_with_query(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_SERVICE_URLS", True)

    with pytest.raises(ServiceUrlError, match="cannot contain a query"):
        get_openrouter_api_base_url("http://192.168.0.19:4000/v1?tenant=one")


def test_openrouter_retries_without_unsupported_temperature(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_SERVICE_URLS", True)
    success = MagicMock()
    success.choices = [MagicMock(message=MagicMock(content='{"ok": true}'))]

    with patch("openai.OpenAI") as openai:
        completion = openai.return_value.chat.completions.create
        completion.side_effect = [
            Exception("UnsupportedParamsError: model doesn't support temperature=0.2"),
            success,
        ]
        provider = OpenRouterProvider(
            "key",
            model="gpt-5-mini-1",
            base_url="http://192.168.0.19:4000/v1",
        )
        result = provider.classify_routing(
            [{"role": "user", "content": "Return JSON"}],
        )

    assert result == {"ok": True}
    assert completion.call_count == 2
    assert completion.call_args_list[0].kwargs["temperature"] == 0.2
    assert "temperature" not in completion.call_args_list[1].kwargs
    assert completion.call_args_list[1].kwargs["response_format"] == {
        "type": "json_object"
    }


def test_build_provider_uses_defaults_for_blank_database_values(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_SERVICE_URLS", True)

    provider = build_provider(
        "ollama",
        {"api_key": "", "base_url": "", "model_name": None},
    )

    assert provider.base_url == "http://localhost:11434"
    assert provider.model == "llava"


def test_ollama_uses_openai_compatible_payload_for_vision(monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_PRIVATE_SERVICE_URLS", True)
    provider = build_provider(
        "ollama",
        {
            "api_key": "",
            "base_url": "http://192.168.0.19:11434",
            "model_name": "gemma4",
        },
    )
    with patch("httpx.Client") as http_client:
        client = http_client.return_value.__enter__.return_value
        client.post.return_value.status_code = 200
        client.post.return_value.json.return_value = {
            "choices": [{"message": {"content": "{}"}}]
        }

        provider.classify_routing(
            [{"role": "user", "content": "Classify this image as JSON"}],
            {"data_url": "data:image/jpeg;base64,ZmFrZQ=="},
        )

        payload = client.post.call_args.kwargs["json"]
        assert payload["temperature"] == 0.2
        assert payload["max_tokens"] == 1024
        assert payload["response_format"] == {"type": "json_object"}
        assert "options" not in payload
        assert "format" not in payload
        assert payload["messages"][0]["content"][1]["image_url"]["url"].startswith(
            "data:image/jpeg;base64,"
        )
