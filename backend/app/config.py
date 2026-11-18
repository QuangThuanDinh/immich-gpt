from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings
from typing import List
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from urllib.parse import urlsplit


def validate_oidc_url(value: str, name: str):
    parsed = urlsplit(value)
    if (parsed.scheme not in {"https", "http"} or not parsed.hostname
            or parsed.username or parsed.password or parsed.fragment
            or not value.isascii() or any(char.isspace() for char in value)
            or (parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"})):
        raise ValueError(f"{name} must use HTTPS (HTTP is allowed only on loopback).")
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError(f"{name} has an invalid port.")
    return parsed

# Minimum acceptable length for SECRET_KEY (256-bit entropy when hex-encoded).
_SECRET_KEY_MIN_LENGTH = 32

# Well-known placeholder values that must never be used in production.
_WEAK_SECRET_KEYS = {
    "change-me-in-production",
    "secret",
    "changeme",
    "insecure",
    "dev",
    "",
}


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Immich GPT"
    APP_VERSION: str = "0.6.33"
    DEBUG: bool = False
    TZ: str = "UTC"

    # Database — SQLite is the supported and recommended database.
    # The path inside the container should always be under /data so it lands
    # on the mounted persistent volume.
    DATABASE_URL: str = "sqlite:///./data/immich_gpt.db"

    # Redis / RQ — optional.  Leave blank (default) to run jobs in-process
    # via the built-in ThreadPoolExecutor.  Set to a Redis URL only if you
    # already run Redis on your home lab and want distributed workers.
    REDIS_URL: str = ""

    # Number of background job threads (in-process executor).
    # Ignored when REDIS_URL is set.
    WORKER_CONCURRENCY: int = 2
    ROUTING_PLAN_PAGE_SIZE: int = Field(default=20, ge=1, le=100)

    # Immich
    IMMICH_URL: str = ""
    IMMICH_API_KEY: str = ""

    # Server-side upstream URL safety.  Keep false for Internet-exposed installs.
    # Set true only when Immich/Ollama intentionally live on a trusted LAN or host.
    ALLOW_PRIVATE_SERVICE_URLS: bool = False

    # OpenAI
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"

    # Image limits
    MAX_IMAGE_BYTES: int = 20 * 1024 * 1024  # 20 MB
    THUMBNAIL_WIDTH: int = 512
    THUMBNAIL_HEIGHT: int = 512

    # Session cookie
    # SESSION_COOKIE_SECURE controls whether the Set-Cookie header includes the
    # Secure flag.  Browsers silently discard Secure cookies over plain HTTP,
    # which breaks login entirely on non-TLS deployments.
    #
    # Default is False so that out-of-the-box HTTP deployments (Unraid, home
    # lab, Docker on a LAN) work without any extra configuration.
    # Set SESSION_COOKIE_SECURE=true when the app is served over HTTPS
    # (e.g. behind an Nginx / Caddy reverse proxy with TLS).
    SESSION_COOKIE_NAME: str = "session_id"
    SESSION_COOKIE_SECURE: bool = False
    SESSION_COOKIE_SAMESITE: str = "strict"

    # Secret key — must be a strong random value (≥ 32 chars).
    # The Docker entrypoint auto-generates and persists one in /data/.secret_key
    # when this is not supplied.  Generate manually with:
    #   python -c "import secrets; print(secrets.token_hex(32))"
    SECRET_KEY: str = ""

    OIDC_ISSUER: str = ""
    OIDC_CLIENT_ID: str = ""
    OIDC_CLIENT_SECRET: str = ""
    OIDC_REDIRECT_URI: str = ""
    OIDC_TOKEN_AUTH_METHOD: str = "client_secret_basic"

    @model_validator(mode="after")
    def _validate_oidc(self) -> "Settings":
        required = ("OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI")
        if not any(getattr(self, name) for name in required):
            return self
        missing = [name for name in required if not getattr(self, name).strip()]
        if missing:
            raise ValueError("Incomplete OIDC configuration: " + ", ".join(missing))
        issuer = validate_oidc_url(self.OIDC_ISSUER, "OIDC_ISSUER")
        redirect = validate_oidc_url(self.OIDC_REDIRECT_URI, "OIDC_REDIRECT_URI")
        if issuer.query or redirect.query or redirect.path != "/api/auth/oidc/callback":
            raise ValueError("OIDC_REDIRECT_URI must end at /api/auth/oidc/callback without query parameters.")
        if self.OIDC_TOKEN_AUTH_METHOD not in {"client_secret_basic", "client_secret_post"}:
            raise ValueError("Unsupported OIDC_TOKEN_AUTH_METHOD.")
        return self

    @property
    def oidc_configured(self) -> bool:
        return bool(self.OIDC_ISSUER and self.OIDC_CLIENT_ID and self.OIDC_CLIENT_SECRET and self.OIDC_REDIRECT_URI)

    @property
    def oidc_secure(self) -> bool:
        return self.OIDC_REDIRECT_URI.startswith("https://")

    # CORS — comma-separated list of allowed origins.
    # Leave blank when the frontend is served by the same origin as the API
    # (the normal single-container case).  Set explicitly if you run the
    # frontend dev server separately:
    #   CORS_ORIGINS=http://localhost:3000,https://myapp.example.com
    CORS_ORIGINS: str = ""

    # Logging — controls the root logger level.
    # Valid values: DEBUG, INFO, WARNING, ERROR, CRITICAL
    LOG_LEVEL: str = "INFO"

    # Rate limiting — disable in test environments to avoid shared-IP collisions.
    RATELIMIT_ENABLED: bool = True

    @field_validator("TZ")
    @classmethod
    def _validate_timezone(cls, value: str) -> str:
        timezone_name = value.strip()
        try:
            ZoneInfo(timezone_name)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(
                f"TZ must be a valid IANA timezone, got {value!r}"
            ) from exc
        return timezone_name

    @model_validator(mode="after")
    def _validate_secret_key(self) -> "Settings":
        key = self.SECRET_KEY
        if key in _WEAK_SECRET_KEYS:
            raise ValueError(
                "SECRET_KEY is not set or uses a known weak placeholder. "
                "Set a strong random value in your .env or environment. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
        if len(key) < _SECRET_KEY_MIN_LENGTH:
            raise ValueError(
                f"SECRET_KEY must be at least {_SECRET_KEY_MIN_LENGTH} characters long. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
        return self

    @property
    def cors_origins_list(self) -> List[str]:
        """Return the parsed list of allowed CORS origins."""
        if not self.CORS_ORIGINS:
            return []
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def thumbnail_size(self) -> tuple:
        return (self.THUMBNAIL_WIDTH, self.THUMBNAIL_HEIGHT)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
