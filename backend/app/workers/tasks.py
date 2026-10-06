"""
RQ background tasks.
Decorated with rq.job so RQ can auto-retry on transient failures.
"""
from contextlib import nullcontext
from typing import Optional, List

from ..database import SessionLocal
from ..services.job_progress import JobProgressService
from ..services.asset_sync import AssetSyncService
from ..services.immich_client import ImmichClient
from ..services.routing_classification import RoutingClassificationOrchestrator
from ..services.provider_resolver import resolve_user_provider
from ..services.secret_store import decrypt_secret
from ..services.user_preferences import get_processing_concurrency


def _immich_client_context(client):
    """Use ImmichClient pooling when available while keeping simple test fakes valid."""
    if hasattr(client, "__enter__") and hasattr(client, "__exit__"):
        return client
    return nullcontext(client)


def _get_user_immich_client(db, user_id: Optional[str]) -> ImmichClient:
    """Resolve Immich credentials for a specific user."""
    from ..models.app_setting import AppSetting
    from ..config import settings
    if not user_id:
        raise ValueError("Job is missing an owner")
    url_row = db.query(AppSetting).filter(
        AppSetting.user_id == user_id, AppSetting.key == "immich_url"
    ).first()
    key_row = db.query(AppSetting).filter(
        AppSetting.user_id == user_id, AppSetting.key == "immich_api_key"
    ).first()
    url = (url_row.value if url_row and url_row.value else None) or settings.IMMICH_URL
    stored_key = key_row.value if key_row and key_row.value else None
    api_key = decrypt_secret(stored_key) if stored_key else settings.IMMICH_API_KEY
    return ImmichClient(url, api_key)


def _should_stop_job(job_id: str) -> bool:
    from ..models.job_run import JobRun

    control_db = SessionLocal()
    try:
        job = control_db.query(JobRun).filter(JobRun.id == job_id).first()
        return job is not None and job.status in ("paused", "cancelled")
    finally:
        control_db.close()


def run_asset_sync(
    job_id: str,
    scope: str = "all",
    album_ids: Optional[List[str]] = None,
    user_id: Optional[str] = None,
    run_routing_after: bool = False,
    full_sync: bool = False,
) -> dict:
    db = SessionLocal()
    try:
        from ..models.job_run import JobRun as _JobRun

        job_svc = JobProgressService(db)
        # Only reset counters for RQ automatic retries (job is in "failed" state).
        # For user-initiated resumes the job is already "queued" — preserve prior progress.
        current_job = job_svc.get_job(job_id)
        if current_job and current_job.status == "failed":
            job_svc.reset_for_retry(job_id)
        job_svc.start_job(job_id)

        scope_label = {
            "all": "all assets",
            "favorites": "favourited assets",
            "albums": f"{len(album_ids or [])} album(s)",
        }.get(scope, scope)
        sync_mode = "full" if full_sync else "incremental"

        job_svc.update_progress(
            job_id, status="syncing_assets",
            current_step=f"Syncing {scope_label} from Immich",
            log_line=(
                f"Asset sync started (scope: {scope_label}, mode: {sync_mode})"
            ),
        )

        def progress_cb(msg: str):
            job_svc.update_progress(job_id, log_line=msg, flush=False)

        def should_stop() -> bool:
            return _should_stop_job(job_id)

        with _immich_client_context(_get_user_immich_client(db, user_id)) as immich:
            sync_svc = AssetSyncService(db, immich, user_id=user_id)

            if scope == "favorites":
                result = sync_svc.sync_favorites(
                    job_progress_callback=progress_cb,
                    should_stop=should_stop,
                    full_sync=full_sync,
                )
            elif scope == "albums" and album_ids:
                result = sync_svc.sync_albums(
                    album_ids,
                    job_progress_callback=progress_cb,
                    should_stop=should_stop,
                    full_sync=full_sync,
                )
            else:
                result = sync_svc.sync_all(
                    job_progress_callback=progress_cb,
                    should_stop=should_stop,
                    full_sync=full_sync,
                )

        job_svc.flush()
        db.expire_all()
        j = db.query(_JobRun).filter(_JobRun.id == job_id).first()
        if j and j.status not in ("paused", "cancelled"):
            job_svc.complete_job(
                job_id,
                message=(
                    f"Sync complete. Hydrated: {result['synced']}, "
                    f"Created: {result['created']}, "
                    f"Updated: {result['updated']}, "
                    f"Unchanged: {result.get('unchanged', 0)}, "
                    f"Live Photo motion assets filtered: {result.get('filtered', 0)}, "
                    f"Errors: {result['errors']}"
                ),
            )
            if run_routing_after:
                from ..workers.executor import enqueue_routing_classification
                asset_ids = (
                    result.get("synced_asset_ids")
                    if full_sync
                    else result.get("created_asset_ids")
                )
                if asset_ids:
                    enqueue_routing_classification(
                        db,
                        user_id=user_id,
                        asset_ids=asset_ids,
                        force=False,
                    )
                else:
                    progress_cb("No newly synced assets require routing")
        return result

    except Exception as e:
        db.rollback()
        try:
            JobProgressService(db).fail_job(job_id, str(e))
        except Exception:
            pass
        raise
    finally:
        db.close()


def run_routing_classification(
    job_id: str,
    plan_id: Optional[str] = None,
    asset_ids: Optional[List[str]] = None,
    limit: Optional[int] = None,
    force: bool = False,
    user_id: Optional[str] = None,
) -> dict:
    """Background task: classify assets against the user's routing tree."""
    db = SessionLocal()
    try:
        if not user_id:
            raise ValueError("Job is missing an owner")
        provider = resolve_user_provider(db, user_id)

        with _immich_client_context(_get_user_immich_client(db, user_id)) as immich:
            orch = RoutingClassificationOrchestrator(
                db,
                provider,
                user_id=user_id,
                immich_client=immich,
                processing_concurrency=get_processing_concurrency(db, user_id),
            )
            orch.run_classification_job(
                job_id, asset_ids=asset_ids, limit=limit, force=force, plan_id=plan_id,
            )
        return {"status": "done"}

    except Exception as e:
        db.rollback()
        try:
            JobProgressService(db).fail_job(job_id, str(e))
        except Exception:
            pass
        raise
    finally:
        db.close()
