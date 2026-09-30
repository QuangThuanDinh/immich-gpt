"""
AI Provider interface and implementations.

The provider is intentionally schema-agnostic: it speaks JSON to the
upstream model and returns a parsed `dict`. Validation against the
routing schema is done in the orchestrator with `AIRoutingResult`.
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse

from .url_validation import ServiceUrlError, validate_service_url


OPENROUTER_DEFAULT_ORIGIN = "https://openrouter.ai"


def get_openrouter_api_base_url(base_url: Optional[str] = None) -> str:
    """Return the validated OpenRouter-compatible /api/v1 endpoint."""
    origin = validate_service_url(
        base_url or OPENROUTER_DEFAULT_ORIGIN,
        field_name="OpenRouter Base URL",
    )
    parsed = urlparse(origin)
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ServiceUrlError(
            "OpenRouter Base URL must be an origin without a path, query, or fragment"
        )
    return f"{origin.rstrip('/')}/api/v1"


class AIProvider(ABC):
    @abstractmethod
    def classify_routing(
        self,
        prompt_messages: List[Dict[str, Any]],
        image_payload: Optional[dict] = None,
    ) -> Dict[str, Any]:
        """Send a JSON-mode chat request and return the parsed dict."""

    @abstractmethod
    def health_check(self) -> bool:
        """Return True if provider is reachable."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        pass


def _inject_image(
    messages: List[Dict[str, Any]],
    image_payload: Optional[dict],
    detail: Optional[str] = "low",
) -> List[Dict[str, Any]]:
    """Append an image_url part to the last user message in-place (copy)."""
    msgs = list(messages)
    if not (image_payload and image_payload.get("data_url")):
        return msgs
    for i in range(len(msgs) - 1, -1, -1):
        if msgs[i].get("role") == "user":
            content = msgs[i]["content"]
            if isinstance(content, str):
                content = [{"type": "text", "text": content}]
            image_url: Dict[str, Any] = {"url": image_payload["data_url"]}
            if detail:
                image_url["detail"] = detail
            content.append({"type": "image_url", "image_url": image_url})
            msgs[i] = {"role": "user", "content": content}
            break
    return msgs


def _parse_json_content(raw: str) -> Dict[str, Any]:
    """Best-effort JSON parse, stripping markdown code fences if present."""
    import json

    if not raw:
        raise ValueError("Empty response from provider")
    stripped = raw.strip()
    if stripped.startswith("```"):
        stripped = stripped[3:]
        newline = stripped.find("\n")
        if newline != -1:
            lang_tag = stripped[:newline].strip().lower()
            if lang_tag in ("json", ""):
                stripped = stripped[newline + 1:]
        stripped = stripped.strip()
        if stripped.endswith("```"):
            stripped = stripped[:-3].strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON from provider: {e}\nRaw: {raw[:500]}")


def _normalize_azure_base_url(base_url: str) -> tuple[str, str]:
    endpoint = validate_service_url(
        base_url,
        field_name="Azure OpenAI Base URL",
    )
    parsed = urlparse(endpoint)
    if parsed.query or parsed.fragment:
        raise ServiceUrlError(
            "Azure OpenAI Base URL cannot contain a query or fragment"
        )

    path = parsed.path.rstrip("/")
    if path not in {"", "/openai/v1"}:
        raise ServiceUrlError(
            "Azure OpenAI Base URL must be a resource origin or end with /openai/v1"
        )

    origin = f"{parsed.scheme}://{parsed.netloc}"
    return origin, f"{origin}/openai/v1"


class OpenAIProvider(AIProvider):
    DEFAULT_TIMEOUT_SECONDS = 120.0

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o",
        base_url: Optional[str] = None,
        azure_api_version: Optional[str] = None,
        azure_deployment: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ):
        self.verification_skipped = False
        if azure_api_version or azure_deployment:
            if not api_key:
                raise ValueError("Azure OpenAI requires an API key")
            if not base_url or not azure_deployment:
                raise ValueError(
                    "Azure OpenAI requires Base URL and Deployment"
                )
            azure_endpoint, azure_v1_base_url = _normalize_azure_base_url(base_url)
            if azure_api_version:
                from openai import AzureOpenAI
                self._client = AzureOpenAI(
                    api_key=api_key,
                    azure_endpoint=azure_endpoint,
                    api_version=azure_api_version,
                    azure_deployment=azure_deployment,
                    timeout=timeout,
                )
            else:
                from openai import OpenAI
                self._client = OpenAI(
                    api_key=api_key,
                    base_url=azure_v1_base_url,
                    timeout=timeout,
                )
            self.model = azure_deployment
            self.verification_skipped = True
        else:
            from openai import OpenAI
            kwargs: Dict[str, Any] = {"api_key": api_key, "timeout": timeout}
            if base_url:
                kwargs["base_url"] = validate_service_url(
                    base_url,
                    field_name="Provider base URL",
                )
            self._client = OpenAI(**kwargs)
            self.model = model

    @property
    def provider_name(self) -> str:
        return "openai"

    def health_check(self) -> bool:
        if self.verification_skipped:
            return True
        try:
            self._client.models.list()
            return True
        except Exception:
            return False

    def classify_routing(
        self,
        prompt_messages: List[Dict[str, Any]],
        image_payload: Optional[dict] = None,
    ) -> Dict[str, Any]:
        messages = _inject_image(prompt_messages, image_payload, detail="low")
        response = self._client.chat.completions.create(
            model=self.model,
            messages=messages,  # type: ignore
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=1024,
        )
        raw = response.choices[0].message.content or "{}"
        return _parse_json_content(raw)


class OllamaProvider(AIProvider):
    """Ollama via the OpenAI-compatible /v1 endpoint (>= 0.1.24)."""

    def __init__(self, base_url: str = "http://localhost:11434", model: str = "llava"):
        self.base_url = validate_service_url(base_url, field_name="Ollama URL")
        self.model = model

    @property
    def provider_name(self) -> str:
        return "ollama"

    def health_check(self) -> bool:
        try:
            import httpx
            r = httpx.get(f"{self.base_url}/api/tags", timeout=5)
            return r.status_code == 200
        except Exception:
            return False

    def classify_routing(
        self,
        prompt_messages: List[Dict[str, Any]],
        image_payload: Optional[dict] = None,
    ) -> Dict[str, Any]:
        import httpx

        messages = _inject_image(prompt_messages, image_payload, detail=None)

        # Append a JSON-only reminder for non-instruct models.
        if messages and messages[-1].get("role") == "user":
            last = messages[-1]
            text = (
                last["content"] if isinstance(last["content"], str)
                else next((c["text"] for c in last["content"] if c.get("type") == "text"), "")
            )
            if "json" not in text.lower():
                hint = "\n\nRespond ONLY with valid JSON matching the required schema."
                if isinstance(last["content"], str):
                    messages[-1] = {"role": "user", "content": last["content"] + hint}
                else:
                    new_content = list(last["content"])
                    for i, part in enumerate(new_content):
                        if part.get("type") == "text":
                            new_content[i] = {"type": "text", "text": part["text"] + hint}
                            break
                    messages[-1] = {"role": "user", "content": new_content}

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "temperature": 0.2,
            "max_tokens": 1024,
            "response_format": {"type": "json_object"},
        }
        try:
            with httpx.Client(timeout=120) as client:
                r = client.post(f"{self.base_url}/v1/chat/completions", json=payload)
                if r.status_code != 200:
                    raise ValueError(f"Ollama returned HTTP {r.status_code}: {r.text[:400]}")
                resp = r.json()
        except httpx.ConnectError as e:
            raise ValueError(f"Cannot connect to Ollama at {self.base_url}: {e}")
        except httpx.TimeoutException:
            raise ValueError(f"Ollama request timed out (model={self.model})")

        raw = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
        return _parse_json_content(raw)


class OpenRouterProvider(AIProvider):
    """OpenRouter-compatible API using the hosted service or a custom origin."""

    def __init__(
        self,
        api_key: str,
        model: str = "openai/gpt-4o",
        base_url: Optional[str] = None,
    ):
        self._api_key = api_key
        self._model = model
        self.base_url = get_openrouter_api_base_url(base_url)
        self._extra_headers = {
            "HTTP-Referer": "https://github.com/titatom/immich-gpt",
            "X-OpenRouter-Title": "immich-gpt",
        }
        from openai import OpenAI
        self._client = OpenAI(
            api_key=api_key,
            base_url=self.base_url,
            default_headers=self._extra_headers,
        )

    @property
    def provider_name(self) -> str:
        return "openrouter"

    def health_check(self) -> bool:
        try:
            import httpx
            path = (
                "key"
                if self.base_url == f"{OPENROUTER_DEFAULT_ORIGIN}/api/v1"
                else "models"
            )
            r = httpx.get(
                f"{self.base_url}/{path}",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    **self._extra_headers,
                },
                timeout=10,
            )
            return r.status_code == 200
        except Exception:
            return False

    def classify_routing(
        self,
        prompt_messages: List[Dict[str, Any]],
        image_payload: Optional[dict] = None,
    ) -> Dict[str, Any]:
        messages = _inject_image(prompt_messages, image_payload, detail="low")
        try:
            response = self._client.chat.completions.create(
                model=self._model,
                messages=messages,  # type: ignore
                response_format={"type": "json_object"},
                temperature=0.2,
                max_tokens=1024,
            )
        except Exception as e:
            err = str(e).lower()
            if "response_format" in err or "json_object" in err or "unsupported" in err:
                response = self._client.chat.completions.create(
                    model=self._model,
                    messages=messages,  # type: ignore
                    temperature=0.2,
                    max_tokens=1024,
                )
            else:
                raise
        raw = response.choices[0].message.content or "{}"
        return _parse_json_content(raw)


def build_provider(provider_name: str, config: dict) -> AIProvider:
    """Factory function to instantiate the right provider."""
    if provider_name == "openai":
        return OpenAIProvider(
            api_key=config["api_key"],
            model=config.get("model_name") or "gpt-4o",
            base_url=config.get("base_url"),
            azure_api_version=config.get("azure_api_version"),
            azure_deployment=config.get("azure_deployment"),
            timeout=float(config.get("timeout", OpenAIProvider.DEFAULT_TIMEOUT_SECONDS)),
        )
    elif provider_name == "ollama":
        return OllamaProvider(
            base_url=config.get("base_url") or "http://localhost:11434",
            model=config.get("model_name") or "llava",
        )
    elif provider_name == "openrouter":
        return OpenRouterProvider(
            api_key=config["api_key"],
            model=config.get("model_name") or "openai/gpt-4o",
            base_url=config.get("base_url"),
        )
    raise ValueError(f"Unknown provider: {provider_name}")
