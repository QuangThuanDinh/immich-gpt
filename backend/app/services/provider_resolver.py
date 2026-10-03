from sqlalchemy.orm import Session

from ..config import settings
from ..models.provider_config import ProviderConfig
from .ai_provider import AIProvider, build_provider
from .secret_store import decrypt_secret


def resolve_user_provider(db: Session, user_id: str) -> AIProvider:
    query = db.query(ProviderConfig).filter(
        ProviderConfig.user_id == user_id,
        ProviderConfig.enabled.is_(True),
    )
    provider_config = query.filter(ProviderConfig.is_default.is_(True)).first()
    if not provider_config:
        provider_config = query.first()

    if not provider_config:
        if not settings.OPENAI_API_KEY:
            raise ValueError(
                "No AI provider configured. Set OPENAI_API_KEY or configure a provider."
            )
        return build_provider(
            "openai",
            {
                "api_key": settings.OPENAI_API_KEY,
                "model_name": settings.OPENAI_MODEL,
            },
        )

    config = {
        "api_key": decrypt_secret(provider_config.api_key_encrypted) or "",
        "model_name": provider_config.model_name,
        "base_url": provider_config.base_url,
    }
    if provider_config.extra_config_json:
        config.update(provider_config.extra_config_json)
    return build_provider(provider_config.provider_name, config)
