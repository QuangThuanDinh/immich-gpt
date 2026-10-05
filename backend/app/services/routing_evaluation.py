from datetime import datetime, timezone
from typing import Iterable
import uuid

from sqlalchemy.orm import Session

from ..models.asset import Asset
from ..models.bucket import Bucket
from ..models.routing_evaluation import RoutingEvaluation, RoutingEvaluationItem
from ..schemas.routing_evaluation import (
    RoutingEvaluationItemInput,
    RoutingEvaluationItemOut,
    RoutingEvaluationOut,
    TRASH_DESTINATION,
)
from .ai_provider import AIProvider
from .image_preparation import ImagePreparationService
from .immich_client import ImmichClient
from .routing_classification import RoutingClassificationOrchestrator
from .routing_schemas import AIRoutingResult
from .routing_tree import RoutingTreeService


class RoutingEvaluationError(ValueError):
    pass


class RoutingEvaluationService:
    def __init__(
        self,
        db: Session,
        user_id: str,
        provider: AIProvider | None = None,
        immich_client: ImmichClient | None = None,
    ):
        self.db = db
        self.user_id = user_id
        self.provider = provider
        self.immich_client = immich_client

    def get_state(self) -> RoutingEvaluationOut:
        evaluation = self._get_or_create_evaluation()
        items = self._list_items(evaluation.id)
        if evaluation.total_score is not None:
            total_score = round(sum(item.score or 0 for item in items), 4)
            max_score = sum(
                1.0 if self._configured_check_count(item) else 0.0
                for item in items
            )
            if (
                evaluation.total_score != total_score
                or evaluation.max_score != max_score
            ):
                evaluation.total_score = total_score
                evaluation.max_score = max_score
                self.db.commit()
        return self._serialize_state(evaluation, items)

    def save_items(
        self,
        inputs: Iterable[RoutingEvaluationItemInput],
    ) -> RoutingEvaluationOut:
        evaluation = self._get_or_create_evaluation()
        items = list(inputs)
        self._validate_inputs(items)

        existing = {
            item.id: item
            for item in self._list_items(evaluation.id)
        }
        retained_ids: set[str] = set()
        changed = False

        for position, data in enumerate(items):
            item = existing.get(data.id) if data.id else None
            if data.id and not item:
                raise RoutingEvaluationError(f"Evaluation item {data.id} was not found")
            if not item:
                item = RoutingEvaluationItem(
                    id=str(uuid.uuid4()),
                    evaluation_id=evaluation.id,
                    user_id=self.user_id,
                    position=position,
                    immich_id=data.immich_id,
                )
                self.db.add(item)
                changed = True

            config_changed = (
                item.immich_id != data.immich_id
                or item.expected_tag != data.expected_tag
                or item.expected_absent_tag != data.expected_absent_tag
                or item.expected_destination != data.expected_destination
            )
            item.position = position
            item.immich_id = data.immich_id
            item.expected_tag = data.expected_tag
            item.expected_absent_tag = data.expected_absent_tag
            item.expected_destination = data.expected_destination
            if config_changed:
                self._clear_result(item)
                changed = True
            retained_ids.add(item.id)

        for item_id, item in existing.items():
            if item_id not in retained_ids:
                self.db.delete(item)
                changed = True

        if changed:
            evaluation.total_score = None
            evaluation.max_score = None
            evaluation.evaluated_at = None

        self.db.commit()
        return self.get_state()

    def evaluate(
        self,
        inputs: Iterable[RoutingEvaluationItemInput],
    ) -> RoutingEvaluationOut:
        state = self.prepare_run(inputs)
        for item in state.items:
            self.evaluate_item(item.id)
        return self.get_state()

    def prepare_run(
        self,
        inputs: Iterable[RoutingEvaluationItemInput],
    ) -> RoutingEvaluationOut:
        self.save_items(inputs)
        evaluation = self._get_or_create_evaluation()
        items = self._list_items(evaluation.id)
        for item in items:
            self._clear_result(item)
        evaluation.total_score = 0.0
        evaluation.max_score = sum(
            1.0 if self._configured_check_count(item) else 0.0
            for item in items
        )
        evaluation.evaluated_at = None
        self.db.commit()
        return self.get_state()

    def evaluate_item(self, item_id: str) -> RoutingEvaluationOut:
        if not self.provider or not self.immich_client:
            raise RoutingEvaluationError("AI provider and Immich connection are required")

        evaluation = self._get_or_create_evaluation()
        item = self.db.query(RoutingEvaluationItem).filter(
            RoutingEvaluationItem.id == item_id,
            RoutingEvaluationItem.evaluation_id == evaluation.id,
            RoutingEvaluationItem.user_id == self.user_id,
        ).first()
        if not item:
            raise RoutingEvaluationError(f"Evaluation item {item_id} was not found")

        leaves = RoutingTreeService(self.db, self.user_id).get_enabled_leaves()
        if not leaves:
            raise RoutingEvaluationError("No enabled routing leaves configured")

        orchestrator = RoutingClassificationOrchestrator(
            self.db,
            self.provider,
            self.user_id,
            immich_client=self.immich_client,
        )
        image_service = ImagePreparationService(self.immich_client)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        self._evaluate_item(item, leaves, orchestrator, image_service, now)

        items = self._list_items(evaluation.id)
        evaluation = self._get_or_create_evaluation()
        evaluation.total_score = round(sum(item.score or 0 for item in items), 4)
        evaluation.max_score = sum(
            1.0 if self._configured_check_count(item) else 0.0
            for item in items
        )
        evaluation.evaluated_at = now
        self.db.commit()
        return self.get_state()

    def _evaluate_item(
        self,
        item: RoutingEvaluationItem,
        leaves: list[Bucket],
        orchestrator: RoutingClassificationOrchestrator,
        image_service: ImagePreparationService,
        now: datetime,
    ) -> None:
        item_id = item.id
        configured_checks = self._configured_check_count(item)
        item_max = 1.0 if configured_checks else 0.0
        try:
            asset = self.db.query(Asset).filter(
                Asset.user_id == self.user_id,
                Asset.immich_id == item.immich_id,
            ).first()
            if not asset:
                raise RoutingEvaluationError(
                    f"Image ID {item.immich_id} is not in the synced asset library"
                )

            messages = orchestrator.assemble_routing_messages(asset, leaves)
            face_annotations = orchestrator._recognized_face_annotations(asset)
            asset_immich_id = asset.immich_id
            self.db.rollback()
            if face_annotations:
                image_payload = image_service.prepare_for_provider(
                    asset_immich_id,
                    face_annotations=face_annotations,
                )
            else:
                image_payload = image_service.prepare_for_provider(asset_immich_id)
            raw = orchestrator._call_provider(
                messages,
                image_payload,
                trusted_names=[
                    annotation["person_name"]
                    for annotation in face_annotations
                ],
            )
            ai_result = AIRoutingResult.model_validate(raw)
            decision = orchestrator.decision_service.resolve_routing(ai_result, leaves)

            result_destination = self._result_destination(decision, leaves)
            result_tags = list(ai_result.metadata.tags or [])
            result_tag_keys = {tag.casefold() for tag in result_tags}
            expected_tags = self._expected_tags(item.expected_tag)
            expected_absent_tags = self._expected_tags(item.expected_absent_tag)
            tag_matched = (
                all(
                    tag.casefold() in result_tag_keys
                    for tag in expected_tags
                )
                if expected_tags
                else None
            )
            absent_tag_matched = (
                all(
                    tag.casefold() not in result_tag_keys
                    for tag in expected_absent_tags
                )
                if expected_absent_tags
                else None
            )
            destination_matched = (
                result_destination == item.expected_destination
                if item.expected_destination
                else None
            )
            matched_checks = (
                sum(tag.casefold() in result_tag_keys for tag in expected_tags)
                + sum(tag.casefold() not in result_tag_keys for tag in expected_absent_tags)
                + int(destination_matched is True)
            )
            score = round(matched_checks / configured_checks, 4) if configured_checks else 0.0

            item.result_description = ai_result.metadata.description
            item.result_tags_json = result_tags
            item.result_destination = result_destination
            item.result_disposition = decision.disposition
            item.tag_matched = tag_matched
            item.absent_tag_matched = absent_tag_matched
            item.destination_matched = destination_matched
            item.score = score
            item.max_score = item_max
            item.error_message = None
            item.evaluated_at = now
            self.db.commit()
        except Exception as exc:
            self.db.rollback()
            item = self.db.query(RoutingEvaluationItem).filter(
                RoutingEvaluationItem.id == item_id,
                RoutingEvaluationItem.user_id == self.user_id,
            ).first()
            if not item:
                return
            item.result_description = None
            item.result_tags_json = []
            item.result_destination = None
            item.result_disposition = None
            item.tag_matched = False if item.expected_tag else None
            item.absent_tag_matched = False if item.expected_absent_tag else None
            item.destination_matched = False if item.expected_destination else None
            item.score = 0
            item.max_score = item_max
            item.error_message = str(exc)[:1000]
            item.evaluated_at = now
            self.db.commit()

    @staticmethod
    def _configured_check_count(item: RoutingEvaluationItem) -> int:
        return (
            len(RoutingEvaluationService._expected_tags(item.expected_tag))
            + len(RoutingEvaluationService._expected_tags(item.expected_absent_tag))
            + int(bool(item.expected_destination))
        )

    @staticmethod
    def _expected_tags(value: str | None) -> list[str]:
        return [tag.strip() for tag in (value or "").split(",") if tag.strip()]

    def _get_or_create_evaluation(self) -> RoutingEvaluation:
        evaluation = self.db.query(RoutingEvaluation).filter(
            RoutingEvaluation.user_id == self.user_id,
        ).first()
        if evaluation:
            return evaluation
        evaluation = RoutingEvaluation(id=str(uuid.uuid4()), user_id=self.user_id)
        self.db.add(evaluation)
        self.db.commit()
        self.db.refresh(evaluation)
        return evaluation

    def _list_items(self, evaluation_id: str) -> list[RoutingEvaluationItem]:
        return self.db.query(RoutingEvaluationItem).filter(
            RoutingEvaluationItem.evaluation_id == evaluation_id,
            RoutingEvaluationItem.user_id == self.user_id,
        ).order_by(RoutingEvaluationItem.position.asc()).all()

    def _validate_inputs(self, items: list[RoutingEvaluationItemInput]) -> None:
        ids = [item.id for item in items if item.id]
        if len(ids) != len(set(ids)):
            raise RoutingEvaluationError("Duplicate evaluation item IDs are not allowed")

        immich_ids = {item.immich_id for item in items}
        known_ids = {
            row[0]
            for row in self.db.query(Asset.immich_id).filter(
                Asset.user_id == self.user_id,
                Asset.immich_id.in_(immich_ids),
            ).all()
        } if immich_ids else set()
        missing_ids = sorted(immich_ids - known_ids)
        if missing_ids:
            raise RoutingEvaluationError(
                f"Image IDs are not in the synced asset library: {', '.join(missing_ids)}"
            )

        allowed_destinations = {
            leaf.path or leaf.name
            for leaf in RoutingTreeService(self.db, self.user_id).get_enabled_leaves()
        }
        allowed_destinations.add(TRASH_DESTINATION)
        invalid_destinations = sorted({
            item.expected_destination
            for item in items
            if item.expected_destination
            and item.expected_destination not in allowed_destinations
        })
        if invalid_destinations:
            raise RoutingEvaluationError(
                f"Invalid evaluation destinations: {', '.join(invalid_destinations)}"
            )

    @staticmethod
    def _clear_result(item: RoutingEvaluationItem) -> None:
        item.result_description = None
        item.result_tags_json = None
        item.result_destination = None
        item.result_disposition = None
        item.tag_matched = None
        item.absent_tag_matched = None
        item.destination_matched = None
        item.score = None
        item.max_score = None
        item.error_message = None
        item.evaluated_at = None

    @staticmethod
    def _result_destination(decision, leaves: list[Bucket]) -> str | None:
        if decision.disposition == "trash_candidate":
            return TRASH_DESTINATION
        if not decision.primary:
            return None
        leaf_by_id = {leaf.id: leaf for leaf in leaves}
        primary_leaf = leaf_by_id.get(decision.primary.bucket_id)
        if primary_leaf and primary_leaf.destination_type == "immich_trash":
            return TRASH_DESTINATION
        return decision.primary.path

    def _serialize_state(
        self,
        evaluation: RoutingEvaluation,
        items: list[RoutingEvaluationItem],
    ) -> RoutingEvaluationOut:
        return RoutingEvaluationOut(
            items=[
                RoutingEvaluationItemOut(
                    id=item.id,
                    immich_id=item.immich_id,
                    expected_tag=item.expected_tag,
                    expected_absent_tag=item.expected_absent_tag,
                    expected_destination=item.expected_destination,
                    result_description=item.result_description,
                    result_tags=list(item.result_tags_json or []),
                    result_destination=item.result_destination,
                    result_disposition=item.result_disposition,
                    tag_matched=item.tag_matched,
                    absent_tag_matched=item.absent_tag_matched,
                    destination_matched=item.destination_matched,
                    score=item.score,
                    max_score=item.max_score,
                    error_message=item.error_message,
                    evaluated_at=item.evaluated_at,
                )
                for item in items
            ],
            total_score=evaluation.total_score,
            max_score=evaluation.max_score,
            evaluated_at=evaluation.evaluated_at,
        )
