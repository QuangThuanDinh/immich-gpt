"""Asset synchronization reconciliation tests."""
from app.models.asset import Asset
from app.services.asset_sync import AssetSyncService
from tests.conftest import TEST_USER_ID


class _PagedImmich:
    def __init__(self, pages, trashed_pages=None, details=None, faces=None):
        self.pages = pages
        self.trashed_pages = trashed_pages or {}
        self.details = details or {}
        self.faces = faces or {}
        self.trashed_calls = []
        self.detail_calls = []
        self.face_calls = []

    def list_assets(self, page=1, page_size=100, **kwargs):
        return self.pages.get(page, [])

    def list_trashed_assets(self, page=1, page_size=100):
        self.trashed_calls.append((page, page_size))
        return self.trashed_pages.get(page, [])

    def get_asset(self, asset_id):
        self.detail_calls.append(asset_id)
        if asset_id in self.details:
            detail = self.details[asset_id]
            if isinstance(detail, Exception):
                raise detail
            return detail
        for assets in self.pages.values():
            for asset in assets:
                if asset.get("id") == asset_id:
                    return asset
        raise RuntimeError(f"Unknown asset {asset_id}")

    def get_asset_faces(self, asset_id):
        self.face_calls.append(asset_id)
        return self.faces.get(asset_id, [])

    def is_external_library_asset(self, raw):
        return False


def _raw_asset(asset_id, asset_type, **extra):
    return {
        "id": asset_id,
        "type": asset_type,
        "originalFileName": f"{asset_id}.jpg",
        "originalMimeType": (
            "video/quicktime" if asset_type == "VIDEO" else "image/jpeg"
        ),
        **extra,
    }


def test_sync_hydrates_tags_and_people_from_asset_detail(db):
    summary = _raw_asset(
        "photo",
        "IMAGE",
        albums=[{"id": "album-1"}],
    )
    detail = _raw_asset(
        "photo",
        "IMAGE",
        tags=[{"id": "tag-1", "name": "ramen"}],
        people=[{
            "id": "person-1",
            "name": "Kelly",
            "thumbnailPath": "/private/upstream/path.jpg",
            "isHidden": False,
            "isFavorite": True,
        }],
    )
    immich = _PagedImmich(
        {1: [summary]},
        details={"photo": detail},
        faces={
            "photo": [{
                "id": "face-1",
                "boundingBoxX1": 10,
                "boundingBoxY1": 20,
                "boundingBoxX2": 110,
                "boundingBoxY2": 140,
                "imageWidth": 1920,
                "imageHeight": 1440,
                "sourceType": "machine-learning",
                "person": {
                    "id": "person-1",
                    "name": "Kelly",
                    "thumbnailPath": "/private/upstream/path.jpg",
                },
            }],
        },
    )
    service = AssetSyncService(db, immich, user_id=TEST_USER_ID)

    result = service.sync_all(page_size=10)

    asset = db.query(Asset).filter(Asset.immich_id == "photo").one()
    assert result["errors"] == 0
    assert immich.detail_calls == ["photo"]
    assert immich.face_calls == ["photo"]
    assert asset.tags_json == ["ramen"]
    assert asset.people_json == [{
        "id": "person-1",
        "name": "Kelly",
        "is_hidden": False,
        "is_favorite": True,
    }]
    assert asset.faces_json == [{
        "id": "face-1",
        "bounding_box_x1": 10,
        "bounding_box_y1": 20,
        "bounding_box_x2": 110,
        "bounding_box_y2": 140,
        "image_width": 1920,
        "image_height": 1440,
        "source_type": "machine-learning",
        "person_id": "person-1",
        "person_name": "Kelly",
    }]
    assert asset.album_ids_json == ["album-1"]
    assert asset.raw_metadata_json["tags"][0]["name"] == "ramen"
    assert "thumbnailPath" in asset.raw_metadata_json["people"][0]
    assert "_faces" not in asset.raw_metadata_json


def test_sync_reports_asset_detail_failure_without_storing_summary(db):
    immich = _PagedImmich(
        {1: [_raw_asset("photo", "IMAGE")]},
        details={"photo": RuntimeError("detail unavailable")},
    )
    log_lines = []
    service = AssetSyncService(db, immich, user_id=TEST_USER_ID)

    result = service.sync_all(
        page_size=10,
        job_progress_callback=log_lines.append,
    )

    assert result["errors"] == 1
    assert result["synced"] == 0
    assert db.query(Asset).filter(Asset.immich_id == "photo").count() == 0
    assert "Error syncing asset photo: detail unavailable" in log_lines


def test_sync_filters_live_photo_motion_asset_after_all_pages(db):
    immich = _PagedImmich({
        1: [
            _raw_asset("motion", "VIDEO"),
            _raw_asset("standalone-video", "VIDEO"),
        ],
        2: [
            _raw_asset("still", "IMAGE", livePhotoVideoId="motion"),
        ],
    })
    service = AssetSyncService(db, immich, user_id=TEST_USER_ID)

    result = service.sync_all(page_size=2)

    remaining_ids = {
        asset.immich_id
        for asset in db.query(Asset).filter(Asset.user_id == TEST_USER_ID)
    }
    assert remaining_ids == {"still", "standalone-video"}
    assert result == {
        "synced": 2,
        "created": 2,
        "updated": 0,
        "filtered": 1,
        "errors": 0,
    }


def test_sync_filters_motion_asset_when_still_arrives_first(db):
    immich = _PagedImmich({
        1: [
            _raw_asset("still", "IMAGE", livePhotoVideoId="motion"),
            _raw_asset("standalone-video", "VIDEO"),
        ],
        2: [
            _raw_asset("motion", "VIDEO"),
        ],
    })
    service = AssetSyncService(db, immich, user_id=TEST_USER_ID)

    result = service.sync_all(page_size=2)

    remaining_ids = {
        asset.immich_id
        for asset in db.query(Asset).filter(Asset.user_id == TEST_USER_ID)
    }
    assert remaining_ids == {"still", "standalone-video"}
    assert result["synced"] == 2
    assert result["filtered"] == 1


def test_sync_keeps_non_video_asset_referenced_as_motion(db):
    immich = _PagedImmich({
        1: [
            _raw_asset("still", "IMAGE", livePhotoVideoId="referenced-image"),
            _raw_asset("referenced-image", "IMAGE"),
        ],
    })
    service = AssetSyncService(db, immich, user_id=TEST_USER_ID)

    result = service.sync_all(page_size=10)

    remaining_ids = {
        asset.immich_id
        for asset in db.query(Asset).filter(Asset.user_id == TEST_USER_ID)
    }
    assert remaining_ids == {"still", "referenced-image"}
    assert result["filtered"] == 0


def test_sync_filters_motion_asset_referenced_by_trashed_still(db):
    immich = _PagedImmich(
        {
            1: [
                _raw_asset("motion", "VIDEO"),
                _raw_asset("standalone-video", "VIDEO"),
            ],
        },
        trashed_pages={
            1: [
                _raw_asset("unrelated-trash-1", "IMAGE", isTrashed=True),
                _raw_asset("unrelated-trash-2", "IMAGE", isTrashed=True),
            ],
            2: [
                _raw_asset(
                    "trashed-still",
                    "IMAGE",
                    isTrashed=True,
                    livePhotoVideoId="motion",
                )
            ],
        },
    )
    service = AssetSyncService(db, immich, user_id=TEST_USER_ID)

    result = service.sync_all(page_size=2)

    remaining_ids = {
        asset.immich_id
        for asset in db.query(Asset).filter(Asset.user_id == TEST_USER_ID)
    }
    assert remaining_ids == {"standalone-video"}
    assert "trashed-still" not in remaining_ids
    assert immich.trashed_calls == [(1, 2), (2, 2)]
    assert result == {
        "synced": 1,
        "created": 1,
        "updated": 0,
        "filtered": 1,
        "errors": 0,
    }


def test_sync_does_not_reconcile_after_trashed_asset_fetch_failure(db):
    class _FailedTrashImmich(_PagedImmich):
        def list_trashed_assets(self, page=1, page_size=100):
            raise RuntimeError("trash fetch failed")

    immich = _FailedTrashImmich({
        1: [
            _raw_asset("motion", "VIDEO"),
            _raw_asset("still", "IMAGE", livePhotoVideoId="motion"),
        ],
    })
    log_lines = []
    service = AssetSyncService(db, immich, user_id=TEST_USER_ID)

    result = service.sync_all(
        page_size=10,
        job_progress_callback=log_lines.append,
    )

    remaining_ids = {
        asset.immich_id
        for asset in db.query(Asset).filter(Asset.user_id == TEST_USER_ID)
    }
    assert remaining_ids == {"motion", "still"}
    assert result["filtered"] == 0
    assert result["errors"] == 1
    assert any(
        line == "Error fetching trashed asset relationships: trash fetch failed"
        for line in log_lines
    )


def test_sync_does_not_reconcile_when_stopped_during_trash_lookup(db):
    immich = _PagedImmich(
        {
            1: [
                _raw_asset("motion", "VIDEO"),
                _raw_asset("still", "IMAGE", livePhotoVideoId="motion"),
            ],
        },
        trashed_pages={1: []},
    )
    stop_checks = iter([False, False, True])
    service = AssetSyncService(db, immich, user_id=TEST_USER_ID)

    result = service.sync_all(
        page_size=10,
        should_stop=lambda: next(stop_checks),
    )

    remaining_ids = {
        asset.immich_id
        for asset in db.query(Asset).filter(Asset.user_id == TEST_USER_ID)
    }
    assert remaining_ids == {"motion", "still"}
    assert result["filtered"] == 0
    assert result["errors"] == 0


def test_sync_does_not_reconcile_after_interrupted_fetch(db):
    class _InterruptedImmich(_PagedImmich):
        def list_assets(self, page=1, page_size=100, **kwargs):
            if page == 2:
                raise RuntimeError("fetch failed")
            return self.pages[page]

    immich = _InterruptedImmich({
        1: [
            _raw_asset("motion", "VIDEO"),
            _raw_asset("standalone-video", "VIDEO"),
        ],
    })
    service = AssetSyncService(db, immich, user_id=TEST_USER_ID)

    result = service.sync_all(page_size=2)

    remaining_ids = {
        asset.immich_id
        for asset in db.query(Asset).filter(Asset.user_id == TEST_USER_ID)
    }
    assert remaining_ids == {"motion", "standalone-video"}
    assert result["filtered"] == 0


def test_sync_does_not_reconcile_after_stop_request(db):
    db.add_all([
        Asset(
            id="motion-row",
            user_id=TEST_USER_ID,
            immich_id="motion",
            asset_type="VIDEO",
            raw_metadata_json={},
        ),
        Asset(
            id="still-row",
            user_id=TEST_USER_ID,
            immich_id="still",
            asset_type="IMAGE",
            raw_metadata_json={"livePhotoVideoId": "motion"},
        ),
    ])
    db.commit()
    service = AssetSyncService(
        db,
        _PagedImmich({1: []}),
        user_id=TEST_USER_ID,
    )

    result = service.sync_all(should_stop=lambda: True)

    assert db.query(Asset).filter(Asset.immich_id == "motion").count() == 1
    assert result["filtered"] == 0


def test_existing_motion_cleanup_does_not_reduce_new_retained_count(db):
    db.add(Asset(
        id="motion-row",
        user_id=TEST_USER_ID,
        immich_id="motion",
        asset_type="VIDEO",
        raw_metadata_json={},
    ))
    db.commit()
    service = AssetSyncService(
        db,
        _PagedImmich({
            1: [_raw_asset("still", "IMAGE", livePhotoVideoId="motion")],
        }),
        user_id=TEST_USER_ID,
    )

    result = service.sync_all(page_size=10)

    assert result == {
        "synced": 1,
        "created": 1,
        "updated": 0,
        "filtered": 1,
        "errors": 0,
    }


def test_multiple_albums_reconcile_once_after_all_albums(db):
    class _AlbumImmich:
        def list_album_assets(self, album_id, page=1, page_size=100):
            assets = {
                "still-album": [
                    _raw_asset("still", "IMAGE", livePhotoVideoId="motion"),
                ],
                "motion-album": [_raw_asset("motion", "VIDEO")],
            }
            return assets[album_id] if page == 1 else []

        def list_trashed_assets(self, page=1, page_size=100):
            return []

        def get_asset(self, asset_id):
            return {
                "still": _raw_asset("still", "IMAGE", livePhotoVideoId="motion"),
                "motion": _raw_asset("motion", "VIDEO"),
            }[asset_id]

        def get_asset_faces(self, asset_id):
            return []

        def is_external_library_asset(self, raw):
            return False

    log_lines = []
    service = AssetSyncService(db, _AlbumImmich(), user_id=TEST_USER_ID)

    result = service.sync_albums(
        ["still-album", "motion-album"],
        page_size=10,
        job_progress_callback=log_lines.append,
    )

    assert result["synced"] == 1
    assert result["filtered"] == 1
    assert [
        line for line in log_lines
        if line.startswith("Filtered ")
    ] == ["Filtered 1 linked Live Photo motion asset(s)"]


def test_album_sync_filters_motion_referenced_by_trashed_still(db):
    class _AlbumImmich:
        def list_album_assets(self, album_id, page=1, page_size=100):
            return [_raw_asset("motion", "VIDEO")] if page == 1 else []

        def list_trashed_assets(self, page=1, page_size=100):
            return [
                _raw_asset(
                    "trashed-still",
                    "IMAGE",
                    isTrashed=True,
                    livePhotoVideoId="motion",
                )
            ]

        def get_asset(self, asset_id):
            return _raw_asset(asset_id, "VIDEO")

        def get_asset_faces(self, asset_id):
            return []

        def is_external_library_asset(self, raw):
            return False

    service = AssetSyncService(db, _AlbumImmich(), user_id=TEST_USER_ID)

    result = service.sync_album("motion-album", page_size=10)

    assert db.query(Asset).filter(Asset.user_id == TEST_USER_ID).count() == 0
    assert result == {
        "synced": 0,
        "created": 0,
        "updated": 0,
        "filtered": 1,
        "errors": 0,
    }


def test_live_photo_cleanup_is_scoped_to_current_user(db):
    other_user_asset = Asset(
        id="other-motion-row",
        user_id="other-user",
        immich_id="other-motion",
        asset_type="VIDEO",
        raw_metadata_json={},
    )
    other_user_still = Asset(
        id="other-still-row",
        user_id="other-user",
        immich_id="other-still",
        asset_type="IMAGE",
        raw_metadata_json={"livePhotoVideoId": "other-motion"},
    )
    db.add_all([other_user_asset, other_user_still])
    db.commit()
    service = AssetSyncService(
        db,
        _PagedImmich({1: []}),
        user_id=TEST_USER_ID,
    )

    service.sync_all(page_size=2)

    assert db.query(Asset).filter(
        Asset.user_id == "other-user",
        Asset.immich_id == "other-motion",
    ).count() == 1
