"""
Tests for /api/assets router.

Covers: list (pagination, filtering), count, get by id / not found.
"""
import uuid
from datetime import datetime

import pytest

from app.models.asset import Asset


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_asset(db, immich_id=None, asset_type="IMAGE") -> Asset:
    from tests.conftest import TEST_USER_ID
    a = Asset(
        id=str(uuid.uuid4()),
        user_id=TEST_USER_ID,
        immich_id=immich_id or str(uuid.uuid4()),
        original_filename="photo.jpg",
        file_created_at=datetime(2024, 1, 1),
        asset_type=asset_type,
        mime_type="image/jpeg",
        is_favorite=False,
        is_archived=False,
        is_external_library=False,
        tags_json=[],
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


def _make_named_asset(db, filename: str, created_at: datetime) -> Asset:
    asset = _make_asset(db)
    asset.original_filename = filename
    asset.file_created_at = created_at
    db.commit()
    db.refresh(asset)
    return asset


# ---------------------------------------------------------------------------
# GET /api/assets
# ---------------------------------------------------------------------------

def test_list_assets_empty(client):
    r = client.get("/api/assets")
    assert r.status_code == 200
    assert r.json() == []


def test_list_assets_returns_items(client, db):
    _make_asset(db)
    _make_asset(db)
    r = client.get("/api/assets")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_list_assets_pagination(client, db):
    for _ in range(5):
        _make_asset(db)
    r = client.get("/api/assets?page=1&page_size=2")
    assert r.status_code == 200
    assert len(r.json()) == 2
    r2 = client.get("/api/assets?page=2&page_size=2")
    assert r2.status_code == 200
    assert len(r2.json()) == 2
    r3 = client.get("/api/assets?page=3&page_size=2")
    assert r3.status_code == 200
    assert len(r3.json()) == 1


def test_list_assets_filter_by_type(client, db):
    _make_asset(db, asset_type="IMAGE")
    _make_asset(db, asset_type="VIDEO")
    r = client.get("/api/assets?asset_type=IMAGE")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["asset_type"] == "IMAGE"


def test_asset_filters_support_immich_id(client, db):
    matching = _make_asset(db, immich_id="de1dd085-a858-4ed4-89ad-f51027cbcca0")
    _make_asset(db, immich_id="different-immich-id")
    query = "a858-4ed4"

    listed = client.get("/api/assets", params={"q": query})
    counted = client.get("/api/assets/count", params={"q": query})
    ids = client.get("/api/assets/ids", params={"q": query})

    assert listed.status_code == 200
    assert [asset["id"] for asset in listed.json()] == [matching.id]
    assert counted.json() == {"count": 1}
    assert ids.json() == {"ids": [matching.id]}


def test_list_assets_server_side_sort_filename(client, db):
    _make_named_asset(db, "bravo.jpg", datetime(2024, 1, 1))
    _make_named_asset(db, "alpha.jpg", datetime(2024, 1, 2))

    r = client.get("/api/assets?sort=filename&dir=asc")
    assert r.status_code == 200
    assert [a["original_filename"] for a in r.json()] == ["alpha.jpg", "bravo.jpg"]


def test_list_assets_response_shape(client, db):
    a = _make_asset(db)
    data = client.get("/api/assets").json()[0]
    for field in ("id", "immich_id", "original_filename", "asset_type",
                  "is_favorite", "is_archived", "created_at"):
        assert field in data
    assert data["immich_id"] == a.immich_id


# ---------------------------------------------------------------------------
# GET /api/assets/count
# ---------------------------------------------------------------------------

def test_count_assets_zero(client):
    r = client.get("/api/assets/count")
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_count_assets(client, db):
    _make_asset(db)
    _make_asset(db)
    r = client.get("/api/assets/count")
    assert r.status_code == 200
    assert r.json()["count"] == 2


# ---------------------------------------------------------------------------
# GET /api/assets/{asset_id}
# ---------------------------------------------------------------------------

def test_get_asset(client, db):
    a = _make_asset(db)
    r = client.get(f"/api/assets/{a.id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == a.id
    assert data["immich_id"] == a.immich_id


def test_get_asset_not_found(client):
    r = client.get("/api/assets/nonexistent-id")
    assert r.status_code == 404


def test_get_asset_optional_fields(client, db):
    a = _make_asset(db)
    a.city = "Berlin"
    a.country = "Germany"
    a.camera_make = "Canon"
    a.description = "A test photo"
    a.tags_json = ["nature", "landscape"]
    a.people_json = [{
        "id": "person-1",
        "name": "Kelly",
        "is_hidden": False,
        "is_favorite": True,
    }]
    a.faces_json = [{
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
    db.commit()

    data = client.get(f"/api/assets/{a.id}").json()
    assert data["city"] == "Berlin"
    assert data["country"] == "Germany"
    assert data["camera_make"] == "Canon"
    assert data["description"] == "A test photo"
    assert data["tags"] == ["nature", "landscape"]
    assert data["people"] == [{
        "id": "person-1",
        "name": "Kelly",
        "is_hidden": False,
        "is_favorite": True,
    }]
    assert data["faces"][0]["person_name"] == "Kelly"
    assert data["faces"][0]["bounding_box_x1"] == 10


def test_refresh_asset_metadata_from_immich(client, db, monkeypatch):
    asset = _make_asset(db, immich_id="immich-photo")
    asset.people_json = None
    asset.faces_json = None
    asset.raw_metadata_json = {"id": "immich-photo", "updatedAt": "2026-01-01T00:00:00Z"}
    db.commit()

    class FakeImmichClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def get_asset(self, asset_id):
            assert asset_id == "immich-photo"
            return {
                "id": asset_id,
                "type": "IMAGE",
                "originalFileName": "photo.jpg",
                "originalMimeType": "image/jpeg",
                "updatedAt": "2026-10-07T12:00:00Z",
                "tags": [{"name": "family"}],
                "people": [{
                    "id": "person-1",
                    "name": "Kelly",
                    "isHidden": False,
                    "isFavorite": True,
                }],
            }

        def get_asset_faces(self, asset_id):
            assert asset_id == "immich-photo"
            return [{
                "id": "face-1",
                "boundingBoxX1": 10,
                "boundingBoxY1": 20,
                "boundingBoxX2": 110,
                "boundingBoxY2": 140,
                "imageWidth": 1920,
                "imageHeight": 1440,
                "sourceType": "machine-learning",
                "person": {"id": "person-1", "name": "Kelly"},
            }]

        def is_external_library_asset(self, raw):
            return False

    monkeypatch.setattr(
        "app.routers.assets._get_user_immich_client",
        lambda *args: FakeImmichClient(),
    )

    response = client.post(f"/api/assets/{asset.id}/refresh")

    assert response.status_code == 200
    data = response.json()
    assert data["tags"] == ["family"]
    assert data["people"][0]["name"] == "Kelly"
    assert data["faces"][0]["person_name"] == "Kelly"
    assert data["synced_at"] is not None

    db.refresh(asset)
    assert asset.raw_metadata_json["updatedAt"] == "2026-10-07T12:00:00Z"
    assert asset.people_json[0]["name"] == "Kelly"
    assert asset.faces_json[0]["person_name"] == "Kelly"


def test_refresh_asset_metadata_not_found(client):
    response = client.post("/api/assets/nonexistent-id/refresh")

    assert response.status_code == 404
