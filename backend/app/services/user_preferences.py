from sqlalchemy.orm import Session

from ..models.app_setting import AppSetting


PROCESSING_CONCURRENCY_KEY = "processing_concurrency"
DEFAULT_PROCESSING_CONCURRENCY = 1
MIN_PROCESSING_CONCURRENCY = 1
MAX_PROCESSING_CONCURRENCY = 10


def get_processing_concurrency(db: Session, user_id: str) -> int:
    row = db.query(AppSetting).filter(
        AppSetting.user_id == user_id,
        AppSetting.key == PROCESSING_CONCURRENCY_KEY,
    ).first()
    if not row or not row.value:
        return DEFAULT_PROCESSING_CONCURRENCY
    try:
        value = int(row.value)
    except ValueError:
        return DEFAULT_PROCESSING_CONCURRENCY
    return max(MIN_PROCESSING_CONCURRENCY, min(MAX_PROCESSING_CONCURRENCY, value))
