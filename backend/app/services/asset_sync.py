"""
Asset sync service: pulls assets from Immich and stores them locally.
"""
import uuid
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime
from typing import Optional, Dict, Any, List, Callable, Set, Tuple
from sqlalchemy.orm import Session

from ..models.asset import Asset
from ..services.immich_client import ImmichClient
from datetime import timezone


def _parse_dt(val: Any) -> Optional[datetime]:
    if not val:
        return None
    if isinstance(val, datetime):
        return val
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except Exception:
        return None


class AssetSyncService:
    def __init__(
        self,
        db: Session,
        immich_client: Optional[ImmichClient] = None,
        user_id: Optional[str] = None,
    ):
        self.db = db
        self.immich = immich_client or ImmichClient()
        self.user_id = user_id

    def sync_all(
        self,
        job_progress_callback=None,
        page_size: int = 100,
        should_stop: Optional[Callable[[], bool]] = None,
        full_sync: bool = False,
    ) -> Dict[str, Any]:
        """Sync all assets from Immich."""
        excluded_motion_ids, trash_lookup_completed, preparation_errors = (
            self._prepare_motion_exclusions(
                page_size,
                should_stop,
                job_progress_callback,
            )
        )
        result, completed, created_ids, updated_ids = self._sync_paged(
            fetch_fn=lambda page: self.immich.list_assets(page=page, page_size=page_size),
            job_progress_callback=job_progress_callback,
            page_size=page_size,
            should_stop=should_stop,
            full_sync=full_sync,
            excluded_motion_ids=excluded_motion_ids,
            filter_motion_assets=trash_lookup_completed,
        )
        if full_sync and completed:
            recovery_updated, recovery_errors, recovery_ids = (
                self._recover_incomplete_assets(
                    excluded_motion_ids,
                    job_progress_callback,
                    should_stop,
                )
            )
            result["updated"] += recovery_updated
            result["errors"] += recovery_errors
            updated_ids.update(recovery_ids)
        result["errors"] += preparation_errors
        return self._finish_sync(
            result,
            completed,
            created_ids,
            updated_ids,
            job_progress_callback,
            page_size,
            should_stop,
            excluded_motion_ids,
            trash_lookup_completed,
        )

    def sync_favorites(
        self,
        job_progress_callback=None,
        page_size: int = 100,
        should_stop: Optional[Callable[[], bool]] = None,
        full_sync: bool = False,
    ) -> Dict[str, Any]:
        """Sync only favorited assets from Immich."""
        excluded_motion_ids, trash_lookup_completed, preparation_errors = (
            self._prepare_motion_exclusions(
                page_size,
                should_stop,
                job_progress_callback,
            )
        )
        result, completed, created_ids, updated_ids = self._sync_paged(
            fetch_fn=lambda page: self.immich.list_assets(
                page=page, page_size=page_size, is_favorite=True
            ),
            job_progress_callback=job_progress_callback,
            page_size=page_size,
            should_stop=should_stop,
            full_sync=full_sync,
            excluded_motion_ids=excluded_motion_ids,
            filter_motion_assets=trash_lookup_completed,
        )
        result["errors"] += preparation_errors
        return self._finish_sync(
            result,
            completed,
            created_ids,
            updated_ids,
            job_progress_callback,
            page_size,
            should_stop,
            excluded_motion_ids,
            trash_lookup_completed,
        )

    def sync_album(
        self,
        album_id: str,
        job_progress_callback=None,
        page_size: int = 100,
        should_stop: Optional[Callable[[], bool]] = None,
        full_sync: bool = False,
    ) -> Dict[str, Any]:
        """Sync assets from a specific album."""
        excluded_motion_ids, trash_lookup_completed, preparation_errors = (
            self._prepare_motion_exclusions(
                page_size,
                should_stop,
                job_progress_callback,
            )
        )
        result, completed, created_ids, updated_ids = self._sync_paged(
            fetch_fn=lambda page: self.immich.list_album_assets(
                album_id=album_id, page=page, page_size=page_size
            ),
            job_progress_callback=job_progress_callback,
            page_size=page_size,
            should_stop=should_stop,
            full_sync=full_sync,
            excluded_motion_ids=excluded_motion_ids,
            filter_motion_assets=trash_lookup_completed,
        )
        result["errors"] += preparation_errors
        return self._finish_sync(
            result,
            completed,
            created_ids,
            updated_ids,
            job_progress_callback,
            page_size,
            should_stop,
            excluded_motion_ids,
            trash_lookup_completed,
        )

    def sync_albums(
        self,
        album_ids: List[str],
        job_progress_callback=None,
        page_size: int = 100,
        should_stop: Optional[Callable[[], bool]] = None,
        full_sync: bool = False,
    ) -> Dict[str, Any]:
        """Sync assets from multiple albums."""
        total_created = total_updated = total_unchanged = total_errors = 0
        total_skipped_motion = 0
        created_ids: Set[str] = set()
        updated_ids: Set[str] = set()
        completed = True
        excluded_motion_ids, trash_lookup_completed, preparation_errors = (
            self._prepare_motion_exclusions(
                page_size,
                should_stop,
                job_progress_callback,
            )
        )
        total_errors += preparation_errors
        for album_id in album_ids:
            if should_stop and should_stop():
                if job_progress_callback:
                    job_progress_callback("Sync stopped due to pause/cancel request.")
                completed = False
                break
            if job_progress_callback:
                job_progress_callback(f"Syncing album {album_id}")
            result, album_completed, album_created_ids, album_updated_ids = (
                self._sync_paged(
                    fetch_fn=lambda page, current_album_id=album_id: (
                        self.immich.list_album_assets(
                            album_id=current_album_id,
                            page=page,
                            page_size=page_size,
                        )
                    ),
                    job_progress_callback=job_progress_callback,
                    page_size=page_size,
                    should_stop=should_stop,
                    full_sync=full_sync,
                    excluded_motion_ids=excluded_motion_ids,
                    filter_motion_assets=trash_lookup_completed,
                )
            )
            total_created += result["created"]
            total_updated += result["updated"]
            total_errors += result["errors"]
            total_unchanged += result["unchanged"]
            total_skipped_motion += result["skipped_motion"]
            created_ids.update(album_created_ids)
            updated_ids.update(album_updated_ids)
            if not album_completed:
                completed = False
                break

        return self._finish_sync(
            {
                "created": total_created,
                "updated": total_updated,
                "unchanged": total_unchanged,
                "errors": total_errors,
                "skipped_motion": total_skipped_motion,
            },
            completed,
            created_ids,
            updated_ids,
            job_progress_callback,
            page_size,
            should_stop,
            excluded_motion_ids,
            trash_lookup_completed,
        )

    def _finish_sync(
        self,
        result: Dict[str, Any],
        completed: bool,
        created_ids: Set[str],
        updated_ids: Set[str],
        job_progress_callback=None,
        page_size: int = 100,
        should_stop: Optional[Callable[[], bool]] = None,
        excluded_motion_ids: Optional[Set[str]] = None,
        trash_lookup_completed: bool = False,
    ) -> Dict[str, Any]:
        filtered_ids: Set[str] = set()
        if completed and trash_lookup_completed:
            filtered_ids = self._remove_live_photo_motion_assets(
                excluded_motion_ids
            )
            if filtered_ids and job_progress_callback:
                job_progress_callback(
                    f"Filtered {len(filtered_ids)} linked Live Photo motion asset(s)"
                )

        result["created"] -= len(filtered_ids & created_ids)
        result["updated"] -= len(filtered_ids & updated_ids)
        result["synced"] = result["created"] + result["updated"]
        result["filtered"] = result.pop("skipped_motion", 0) + len(filtered_ids)
        result["created_asset_ids"] = sorted(created_ids - filtered_ids)
        result["synced_asset_ids"] = sorted(
            (created_ids | updated_ids) - filtered_ids
        )
        return result

    def _prepare_motion_exclusions(
        self,
        page_size: int,
        should_stop: Optional[Callable[[], bool]],
        job_progress_callback=None,
    ) -> Tuple[Set[str], bool, int]:
        motion_ids = self._known_live_photo_motion_ids()
        try:
            trashed_motion_ids, completed = (
                self._collect_trashed_live_photo_motion_ids(
                    page_size=page_size,
                    should_stop=should_stop,
                    job_progress_callback=job_progress_callback,
                )
            )
            motion_ids.update(trashed_motion_ids)
            return motion_ids, completed, 0
        except Exception as exc:
            if job_progress_callback:
                job_progress_callback(
                    f"Error fetching trashed asset relationships: {exc}"
                )
            return set(), False, 1

    def _known_live_photo_motion_ids(self) -> Set[str]:
        query = self.db.query(Asset.raw_metadata_json)
        if self.user_id:
            query = query.filter(Asset.user_id == self.user_id)
        return {
            motion_id
            for (metadata,) in query.all()
            if isinstance(metadata, dict)
            and (motion_id := metadata.get("livePhotoVideoId"))
        }

    def _recover_incomplete_assets(
        self,
        excluded_motion_ids: Set[str],
        job_progress_callback=None,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> Tuple[int, int, Set[str]]:
        query = self.db.query(
            Asset.id,
            Asset.immich_id,
            Asset.asset_type,
            Asset.tags_json,
            Asset.people_json,
            Asset.faces_json,
            Asset.raw_metadata_json,
        )
        if self.user_id:
            query = query.filter(Asset.user_id == self.user_id)
        candidates = [
            (asset_id, immich_id)
            for (
                asset_id,
                immich_id,
                asset_type,
                tags,
                people,
                faces,
                raw_metadata,
            ) in query.all()
            if any(
                value is None
                for value in (tags, people, faces, raw_metadata)
            )
            if not (
                asset_type == "VIDEO"
                and immich_id in excluded_motion_ids
            )
        ]
        if not candidates:
            return 0, 0, set()

        if job_progress_callback:
            job_progress_callback(
                f"Full Sync recovery: hydrating {len(candidates)} incomplete "
                "legacy asset(s) omitted from the asset listing"
            )

        updated = errors = 0
        updated_ids: Set[str] = set()
        synced_at = datetime.now(timezone.utc).replace(tzinfo=None)
        workers = min(self._DETAIL_FETCH_CONCURRENCY, len(candidates))
        candidate_iterator = iter(candidates)
        processed = 0
        pending = 0

        with ThreadPoolExecutor(max_workers=workers) as executor:
            in_flight = {}

            def submit_next() -> bool:
                try:
                    candidate = next(candidate_iterator)
                except StopIteration:
                    return False
                _, immich_id = candidate
                future = executor.submit(
                    self._hydrate_asset,
                    {"id": immich_id},
                )
                in_flight[future] = candidate
                return True

            for _ in range(workers):
                submit_next()

            stopped = False
            while in_flight and not stopped:
                done, _ = wait(
                    in_flight,
                    return_when=FIRST_COMPLETED,
                )
                for future in done:
                    _, immich_id = in_flight.pop(future)
                    if should_stop and should_stop():
                        stopped = True
                        if job_progress_callback:
                            job_progress_callback(
                                "Full Sync recovery stopped due to "
                                "pause/cancel request."
                            )
                        break
                    try:
                        hydrated = future.result()
                        _, was_updated, asset_id = self._upsert_asset(
                            hydrated,
                            synced_at,
                        )
                        updated += was_updated
                        if asset_id:
                            updated_ids.add(asset_id)
                        pending += 1
                    except Exception as exc:
                        errors += 1
                        if job_progress_callback:
                            job_progress_callback(
                                "Error recovering incomplete asset "
                                f"{immich_id}: {exc}"
                            )

                    processed += 1
                    if pending >= self._COMMIT_BATCH_SIZE:
                        self.db.commit()
                        pending = 0
                    if (
                        job_progress_callback
                        and (
                            processed % self._COMMIT_BATCH_SIZE == 0
                            or processed == len(candidates)
                        )
                    ):
                        job_progress_callback(
                            "Full Sync recovery progress: "
                            f"{processed}/{len(candidates)} processed, "
                            f"{errors} error(s)"
                        )
                    submit_next()

        if pending:
            self.db.commit()
        return updated, errors, updated_ids

    def _collect_trashed_live_photo_motion_ids(
        self,
        page_size: int,
        should_stop: Optional[Callable[[], bool]] = None,
        job_progress_callback=None,
    ) -> Tuple[Set[str], bool]:
        motion_ids: Set[str] = set()
        page = 1

        while True:
            if should_stop and should_stop():
                if job_progress_callback:
                    job_progress_callback("Sync stopped due to pause/cancel request.")
                return set(), False

            if job_progress_callback:
                job_progress_callback(f"Fetching trashed asset relationships page {page}")
            raw_assets = self.immich.list_trashed_assets(
                page=page,
                page_size=page_size,
            )

            if should_stop and should_stop():
                if job_progress_callback:
                    job_progress_callback("Sync stopped due to pause/cancel request.")
                return set(), False

            for raw in raw_assets:
                motion_id = raw.get("livePhotoVideoId")
                if motion_id:
                    motion_ids.add(motion_id)

            if len(raw_assets) < page_size:
                return motion_ids, True
            page += 1

    _COMMIT_BATCH_SIZE = 100
    _DETAIL_FETCH_CONCURRENCY = 4

    def refresh_asset(self, immich_id: str) -> str:
        hydrated = self._hydrate_asset({"id": immich_id})
        synced_at = datetime.now(timezone.utc).replace(tzinfo=None)
        _, _, asset_id = self._upsert_asset(hydrated, synced_at)
        if not asset_id:
            raise ValueError("Immich returned an asset without an ID")
        self.db.commit()
        return asset_id

    def _hydrate_asset(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        detailed = self.immich.get_asset(raw["id"])
        faces = self.immich.get_asset_faces(raw["id"])
        return {**raw, **detailed, "_faces": faces}

    def _sync_paged(
        self,
        fetch_fn,
        job_progress_callback=None,
        page_size: int = 100,
        should_stop: Optional[Callable[[], bool]] = None,
        full_sync: bool = False,
        excluded_motion_ids: Optional[Set[str]] = None,
        filter_motion_assets: bool = True,
    ) -> Tuple[Dict[str, int], bool, Set[str], Set[str]]:
        created = updated = unchanged = errors = 0
        created_ids: Set[str] = set()
        updated_ids: Set[str] = set()
        page = 1
        synced_at = datetime.now(timezone.utc).replace(tzinfo=None)
        pending = 0  # rows flushed but not yet committed
        completed = False
        if excluded_motion_ids is None:
            excluded_motion_ids = set()
        skipped_motion_ids: Set[str] = set()

        while True:
            # Cooperative stop check (pause/cancel)
            if should_stop and should_stop():
                if job_progress_callback:
                    job_progress_callback("Sync stopped due to pause/cancel request.")
                break

            if job_progress_callback:
                job_progress_callback(f"Fetching page {page}")
            try:
                raw_assets = fetch_fn(page)
            except Exception as e:
                if job_progress_callback:
                    job_progress_callback(f"Error fetching page {page}: {e}")
                break

            if not raw_assets:
                completed = True
                break

            if filter_motion_assets:
                excluded_motion_ids.update(
                    raw["livePhotoVideoId"]
                    for raw in raw_assets
                    if raw.get("livePhotoVideoId")
                )
            syncable_assets = []
            for raw in raw_assets:
                if (
                    filter_motion_assets
                    and raw.get("id") in excluded_motion_ids
                    and raw.get("type") == "VIDEO"
                ):
                    skipped_motion_ids.add(raw["id"])
                else:
                    syncable_assets.append(raw)

            existing_by_immich_id = self._load_existing_assets(syncable_assets)
            assets_to_hydrate = [
                raw for raw in syncable_assets
                if self._needs_hydration(
                    raw,
                    existing_by_immich_id.get(raw.get("id")),
                    full_sync,
                )
            ]
            page_unchanged = len(syncable_assets) - len(assets_to_hydrate)
            page_motion = len(raw_assets) - len(syncable_assets)
            unchanged += page_unchanged
            if job_progress_callback and (
                page_unchanged > 0 or page_motion > 0
            ):
                summary = (
                    f"Page {page}: hydrating {len(assets_to_hydrate)} asset(s), "
                    f"skipping {page_unchanged} unchanged"
                )
                if page_motion:
                    summary += (
                        f", filtering {page_motion} Live Photo companion(s)"
                    )
                job_progress_callback(summary)

            workers = min(
                self._DETAIL_FETCH_CONCURRENCY,
                len(assets_to_hydrate),
            )
            if workers == 0:
                if len(raw_assets) < page_size:
                    completed = True
                    break
                page += 1
                continue
            with ThreadPoolExecutor(max_workers=workers) as executor:
                detail_futures = [
                    executor.submit(self._hydrate_asset, raw)
                    for raw in assets_to_hydrate
                ]

            for raw, detail_future in zip(assets_to_hydrate, detail_futures):
                try:
                    hydrated = detail_future.result()
                    c, u, asset_id = self._upsert_asset(hydrated, synced_at)
                    created += c
                    updated += u
                    if asset_id:
                        if c:
                            created_ids.add(asset_id)
                        elif u:
                            updated_ids.add(asset_id)
                    pending += 1
                except Exception as exc:
                    errors += 1
                    if job_progress_callback:
                        raw_id = raw.get("id", "unknown")
                        job_progress_callback(
                            f"Error syncing asset {raw_id}: {exc}"
                        )

                if pending >= self._COMMIT_BATCH_SIZE:
                    self.db.commit()
                    pending = 0

            if len(raw_assets) < page_size:
                completed = True
                break
            page += 1

        # Commit any remaining rows
        if pending:
            self.db.commit()

        return (
            {
                "created": created,
                "updated": updated,
                "unchanged": unchanged,
                "errors": errors,
                "skipped_motion": len(skipped_motion_ids),
            },
            completed,
            created_ids,
            updated_ids,
        )

    def _load_existing_assets(
        self,
        raw_assets: List[Dict[str, Any]],
    ) -> Dict[str, Asset]:
        immich_ids = [
            raw["id"] for raw in raw_assets
            if raw.get("id")
        ]
        if not immich_ids:
            return {}
        query = self.db.query(Asset).filter(Asset.immich_id.in_(immich_ids))
        if self.user_id:
            query = query.filter(Asset.user_id == self.user_id)
        return {asset.immich_id: asset for asset in query.all()}

    def _needs_hydration(
        self,
        raw: Dict[str, Any],
        existing: Optional[Asset],
        full_sync: bool,
    ) -> bool:
        if full_sync or existing is None:
            return True
        if any(
            value is None
            for value in (
                existing.tags_json,
                existing.people_json,
                existing.faces_json,
                existing.raw_metadata_json,
            )
        ):
            return True

        remote_updated_at = _parse_dt(raw.get("updatedAt"))
        stored_metadata = existing.raw_metadata_json
        stored_updated_at = _parse_dt(
            stored_metadata.get("updatedAt")
            if isinstance(stored_metadata, dict)
            else None
        )
        if remote_updated_at is None or stored_updated_at is None:
            return True
        return remote_updated_at != stored_updated_at

    def _remove_live_photo_motion_assets(
        self,
        additional_motion_ids: Optional[Set[str]] = None,
    ) -> Set[str]:
        query = self.db.query(Asset)
        if self.user_id:
            query = query.filter(Asset.user_id == self.user_id)
        assets = query.all()
        motion_assets = {
            (asset.user_id, metadata.get("livePhotoVideoId"))
            for asset in assets
            if isinstance((metadata := asset.raw_metadata_json), dict)
            and metadata.get("livePhotoVideoId")
        }
        motion_assets.update(
            (self.user_id, motion_id)
            for motion_id in (additional_motion_ids or set())
        )
        if not motion_assets:
            return set()

        companions = [
            asset for asset in assets
            if (asset.user_id, asset.immich_id) in motion_assets
            and asset.asset_type == "VIDEO"
        ]
        companion_ids = {asset.id for asset in companions}
        for companion in companions:
            self.db.delete(companion)
        if companions:
            self.db.commit()
        return companion_ids

    def _upsert_asset(self, raw: Dict[str, Any], synced_at: datetime):
        immich_id = raw.get("id")
        if not immich_id:
            return 0, 0, None

        q = self.db.query(Asset).filter(Asset.immich_id == immich_id)
        if self.user_id:
            q = q.filter(Asset.user_id == self.user_id)
        existing = q.first()
        exif = raw.get("exifInfo") or {}
        tags = [t.get("name") for t in (raw.get("tags") or []) if t.get("name")]
        people = []
        for person in raw.get("people") or []:
            person_id = person.get("id")
            if not person_id:
                continue
            people.append({
                "id": person_id,
                "name": person.get("name") or "Unnamed person",
                "is_hidden": bool(person.get("isHidden", False)),
                "is_favorite": bool(person.get("isFavorite", False)),
            })
        faces = []
        for face in raw.get("_faces") or []:
            face_id = face.get("id")
            box_values = [
                face.get("boundingBoxX1"),
                face.get("boundingBoxY1"),
                face.get("boundingBoxX2"),
                face.get("boundingBoxY2"),
                face.get("imageWidth"),
                face.get("imageHeight"),
            ]
            if not face_id or not all(
                isinstance(value, int) and not isinstance(value, bool)
                for value in box_values
            ):
                continue
            person = face.get("person") or {}
            faces.append({
                "id": face_id,
                "bounding_box_x1": box_values[0],
                "bounding_box_y1": box_values[1],
                "bounding_box_x2": box_values[2],
                "bounding_box_y2": box_values[3],
                "image_width": box_values[4],
                "image_height": box_values[5],
                "source_type": face.get("sourceType"),
                "person_id": person.get("id"),
                "person_name": person.get("name"),
            })
        raw_metadata = {key: value for key, value in raw.items() if key != "_faces"}

        data = {
            "immich_id": immich_id,
            "original_filename": raw.get("originalFileName"),
            "file_created_at": _parse_dt(raw.get("fileCreatedAt")),
            "file_modified_at": _parse_dt(raw.get("fileModifiedAt")),
            "local_date_time": _parse_dt(raw.get("localDateTime")),
            "asset_type": raw.get("type"),
            "mime_type": raw.get("originalMimeType"),
            "duration": raw.get("duration"),
            "is_favorite": raw.get("isFavorite", False),
            "is_archived": raw.get("isArchived", False),
            "is_trashed": raw.get("isTrashed", False),
            "is_external_library": self.immich.is_external_library_asset(raw),
            "city": exif.get("city"),
            "country": exif.get("country"),
            "camera_make": exif.get("make"),
            "camera_model": exif.get("model"),
            "description": raw.get("exifInfo", {}).get("description") if raw.get("exifInfo") else None,
            "tags_json": tags,
            "people_json": people,
            "faces_json": faces,
            "album_ids_json": [a.get("id") for a in (raw.get("albums") or []) if a.get("id")],
            "raw_metadata_json": raw_metadata,
            "synced_at": synced_at,
        }

        if existing:
            for k, v in data.items():
                setattr(existing, k, v)
            return 0, 1, existing.id
        else:
            asset = Asset(id=str(uuid.uuid4()), user_id=self.user_id, **data)
            self.db.add(asset)
            return 1, 0, asset.id
