import base64

import pytest
from pydantic import ValidationError

from app.models.asset import Asset
from app.models.routing_evaluation import RoutingEvaluation, RoutingEvaluationItem
from app.schemas.routing_evaluation import (
    RoutingEvaluationItemInput,
    TRASH_DESTINATION,
)
from app.services.routing_evaluation import RoutingEvaluationService
from tests.conftest import TEST_USER_ID


_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "YAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


class _FakeImmichClient:
    def __init__(self):
        self.thumbnail_calls = []

    def get_thumbnail(self, _asset_id, size="thumbnail"):
        self.thumbnail_calls.append((_asset_id, size))
        return _PNG


class _FakeProvider:
    provider_name = "fake"
    model = "fake-model"

    def __init__(self):
        self.last_messages = None
        self.last_image_payload = None

    def health_check(self):
        return True

    def classify_routing(self, _messages, _image_payload):
        self.last_messages = _messages
        self.last_image_payload = _image_payload
        combined_text = " ".join(
            str(message.get("content", ""))
            for message in _messages
        )
        description = (
            "Kelly reviews a scanned tax document."
            if "Face 1 = Kelly" in combined_text
            else "A scanned tax document."
        )
        return {
            "disposition": "keep",
            "primary_path": "Documents",
            "primary_confidence": 0.98,
            "review_required": False,
            "metadata": {
                "description": description,
                "tags": ["Tax", "document"],
                "location": None,
                "caption": None,
            },
        }


def _add_asset(db, immich_id="immich-eval-1"):
    db.add(Asset(
        id="asset-eval-1",
        user_id=TEST_USER_ID,
        immich_id=immich_id,
        original_filename="tax.png",
        asset_type="IMAGE",
    ))
    db.commit()


def test_expected_tags_accept_commas_and_reject_spaces_within_tags():
    item = RoutingEvaluationItemInput(
        immich_id="image-1",
        expected_tag="tax, document",
        expected_absent_tag="private, personal",
    )
    assert item.expected_tag == "tax,document"
    assert item.expected_absent_tag == "private,personal"

    with pytest.raises(ValidationError):
        RoutingEvaluationItemInput(
            immich_id="image-1",
            expected_tag="tax document",
        )
    with pytest.raises(ValidationError):
        RoutingEvaluationItemInput(
            immich_id="image-1",
            expected_tag="tax,,document",
        )
    with pytest.raises(ValidationError):
        RoutingEvaluationItemInput(
            immich_id="image-1",
            expected_absent_tag="private document",
        )


def test_save_and_reload_evaluation_items(db):
    _add_asset(db)
    service = RoutingEvaluationService(db, TEST_USER_ID)

    saved = service.save_items([
        RoutingEvaluationItemInput(
            immich_id="immich-eval-1",
            expected_tag="tax,document",
            expected_absent_tag="private,personal",
            expected_destination="Documents",
        ),
    ])

    assert len(saved.items) == 1
    assert saved.items[0].expected_tag == "tax,document"
    assert saved.items[0].expected_absent_tag == "private,personal"
    assert saved.items[0].expected_destination == "Documents"
    assert service.get_state().items[0].id == saved.items[0].id


def test_evaluate_scores_tag_and_destination_and_persists_latest(db):
    _add_asset(db)
    service = RoutingEvaluationService(
        db,
        TEST_USER_ID,
        provider=_FakeProvider(),
        immich_client=_FakeImmichClient(),
    )

    result = service.evaluate([
        RoutingEvaluationItemInput(
            immich_id="immich-eval-1",
            expected_tag="tax",
            expected_destination="Documents",
        ),
    ])

    assert result.total_score == 1
    assert result.max_score == 1
    assert result.evaluated_at is not None
    assert result.items[0].result_description == "A scanned tax document."
    assert result.items[0].result_tags == ["Tax", "document"]
    assert result.items[0].result_destination == "Documents"
    assert result.items[0].tag_matched is True
    assert result.items[0].destination_matched is True
    assert result.items[0].score == 1
    assert result.items[0].max_score == 1
    assert service.get_state().total_score == 1


def test_evaluation_uses_recognized_face_annotations(db):
    _add_asset(db)
    asset = db.query(Asset).filter(Asset.immich_id == "immich-eval-1").one()
    asset.faces_json = [{
        "id": "face-1",
        "bounding_box_x1": 0,
        "bounding_box_y1": 0,
        "bounding_box_x2": 1,
        "bounding_box_y2": 1,
        "image_width": 1,
        "image_height": 1,
        "source_type": "machine-learning",
        "person_id": "person-1",
        "person_name": "Kelly",
    }]
    db.commit()
    provider = _FakeProvider()
    immich = _FakeImmichClient()
    service = RoutingEvaluationService(
        db,
        TEST_USER_ID,
        provider=provider,
        immich_client=immich,
    )

    service.evaluate([
        RoutingEvaluationItemInput(
            immich_id="immich-eval-1",
            expected_tag="tax",
        ),
    ])

    assert immich.thumbnail_calls == [("immich-eval-1", "preview")]
    assert provider.last_image_payload["detail"] == "high"
    assert provider.last_image_payload["annotated_faces"] == 1
    assert "Face 1 = Kelly" in provider.last_messages[1]["content"]


def test_get_state_repairs_stale_aggregate_score(db):
    _add_asset(db)
    service = RoutingEvaluationService(db, TEST_USER_ID)
    saved = service.save_items([
        RoutingEvaluationItemInput(
            immich_id="immich-eval-1",
            expected_tag="tax",
        ),
    ])
    item = db.query(RoutingEvaluationItem).filter(
        RoutingEvaluationItem.id == saved.items[0].id,
    ).one()
    item.score = 1
    item.max_score = 1
    evaluation = db.query(RoutingEvaluation).filter(
        RoutingEvaluation.user_id == TEST_USER_ID,
    ).one()
    evaluation.total_score = 0
    evaluation.max_score = 1
    db.commit()

    state = service.get_state()

    assert state.total_score == 1
    assert db.query(RoutingEvaluation).filter(
        RoutingEvaluation.user_id == TEST_USER_ID,
    ).one().total_score == 1


def test_evaluate_splits_item_score_across_configured_checks(db):
    _add_asset(db)
    service = RoutingEvaluationService(
        db,
        TEST_USER_ID,
        provider=_FakeProvider(),
        immich_client=_FakeImmichClient(),
    )

    result = service.evaluate([
        RoutingEvaluationItemInput(
            immich_id="immich-eval-1",
            expected_tag="tax,document",
            expected_absent_tag="private,personal",
            expected_destination="Personal",
        ),
    ])

    assert result.total_score == 0.8
    assert result.max_score == 1
    assert result.items[0].tag_matched is True
    assert result.items[0].absent_tag_matched is True
    assert result.items[0].destination_matched is False
    assert result.items[0].score == 0.8
    assert result.items[0].max_score == 1


def test_evaluate_weights_each_tag_and_destination_equally(db):
    _add_asset(db)
    service = RoutingEvaluationService(
        db,
        TEST_USER_ID,
        provider=_FakeProvider(),
        immich_client=_FakeImmichClient(),
    )

    result = service.evaluate([
        RoutingEvaluationItemInput(
            immich_id="immich-eval-1",
            expected_tag="tax,missing",
            expected_absent_tag="private,document,personal",
            expected_destination="Documents",
        ),
    ])

    assert result.items[0].tag_matched is False
    assert result.items[0].absent_tag_matched is False
    assert result.items[0].destination_matched is True
    assert result.items[0].score == 0.6667
    assert result.items[0].max_score == 1
    assert result.total_score == 0.6667


def test_evaluate_scores_each_absent_tag_independently(db):
    _add_asset(db)
    service = RoutingEvaluationService(
        db,
        TEST_USER_ID,
        provider=_FakeProvider(),
        immich_client=_FakeImmichClient(),
    )

    result = service.evaluate([
        RoutingEvaluationItemInput(
            immich_id="immich-eval-1",
            expected_absent_tag="tax,private",
        ),
    ])

    assert result.total_score == 0.5
    assert result.items[0].absent_tag_matched is False
    assert result.items[0].score == 0.5
    assert result.items[0].max_score == 1


def test_evaluate_trash_destination(db):
    _add_asset(db)
    provider = _FakeProvider()
    provider.classify_routing = lambda _messages, _image_payload: {
        "disposition": "trash_candidate",
        "primary_path": "Trash",
        "primary_confidence": 0.99,
        "review_required": False,
        "metadata": {"description": "A disposable image.", "tags": []},
    }
    service = RoutingEvaluationService(
        db,
        TEST_USER_ID,
        provider=provider,
        immich_client=_FakeImmichClient(),
    )

    result = service.evaluate([
        RoutingEvaluationItemInput(
            immich_id="immich-eval-1",
            expected_destination=TRASH_DESTINATION,
        ),
    ])

    assert result.total_score == 1
    assert result.items[0].result_destination == TRASH_DESTINATION
    assert result.items[0].destination_matched is True


def test_evaluation_api_saves_and_loads(client, db):
    _add_asset(db)
    response = client.put("/api/routing/evaluation", json={
        "items": [{
            "immich_id": "immich-eval-1",
            "expected_tag": "tax",
            "expected_destination": "Documents",
        }],
    })
    assert response.status_code == 200
    item_id = response.json()["items"][0]["id"]

    loaded = client.get("/api/routing/evaluation")
    assert loaded.status_code == 200
    assert loaded.json()["items"][0]["id"] == item_id
