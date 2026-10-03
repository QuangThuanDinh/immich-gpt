"""
RoutingClassificationOrchestrator

Wraps the existing classification flow but routes results through the
LeafPromptCompiler / RoutingDecisionService / RoutingPlanService stack.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import json
import uuid
from typing import Optional, List, Dict, Any

from sqlalchemy.orm import Session

from ..models.asset import Asset
from ..models.bucket import Bucket
from ..models.prompt_run import PromptRun
from ..models.routing_plan import RoutingPlan, RoutingPlanItem
from ..services.immich_client import ImmichClient
from ..services.image_preparation import ImagePreparationService
from ..services.ai_provider import AIProvider
from ..services.job_progress import JobProgressService
from ..services.routing_tree import RoutingTreeService
from ..services.leaf_prompt_compiler import LeafPromptCompiler
from ..services.routing_decision import RoutingDecisionService
from ..services.routing_plan_service import RoutingPlanService
from ..services.routing_writeback import RoutingWritebackService
from ..services.routing_schemas import AIRoutingResult


GLOBAL_SYSTEM_PROMPT = """You are classifying personal photo library assets into a user-defined routing tree.

You must choose the best enabled leaf path when appropriate.
You may also suggest secondary paths if the asset legitimately belongs in more than one destination.
You must return structured JSON only.

Respect each leaf's description, positive criteria, negative criteria, quality rules, privacy rules, and examples.

Do not invent paths.
If no path fits, return review_required=true and primary_path=null.
If an asset appears unsafe for a destination because of privacy or quality rules, set review_required=true or choose another destination.
"""


@dataclass(frozen=True)
class PreparedRoutingAsset:
    asset_id: str
    immich_id: str
    prompt_run_id: str
    messages: List[Dict[str, Any]]


class RoutingClassificationOrchestrator:
    def __init__(
        self,
        db: Session,
        provider: AIProvider,
        user_id: str,
        immich_client: Optional[ImmichClient] = None,
        processing_concurrency: int = 1,
    ):
        self.db = db
        self.provider = provider
        self.user_id = user_id
        self.immich = immich_client or ImmichClient()
        self.image_service = ImagePreparationService(self.immich)
        self.tree_service = RoutingTreeService(db, user_id)
        self.compiler = LeafPromptCompiler(db, user_id)
        self.decision_service = RoutingDecisionService(db, user_id)
        self.plan_service = RoutingPlanService(db, user_id)
        self.writeback_service = RoutingWritebackService(db, user_id, self.immich)
        self.job_service = JobProgressService(db)
        self.processing_concurrency = max(1, min(10, processing_concurrency))

    # ------------------------------------------------------------------
    # Job entry point
    # ------------------------------------------------------------------

    def run_classification_job(
        self,
        job_id: str,
        asset_ids: Optional[List[str]] = None,
        limit: Optional[int] = None,
        force: bool = False,
        plan_id: Optional[str] = None,
    ) -> Optional[str]:
        self.job_service.start_job(job_id)
        self.job_service.update_progress(
            job_id,
            status="syncing_assets",
            current_step="Loading assets",
            log_line="Starting routing classification job",
        )

        leaves = self.tree_service.get_enabled_leaves()
        if not leaves:
            self.job_service.fail_job(job_id, "No enabled routing leaves configured")
            return None

        plan: RoutingPlan
        if plan_id:
            existing = self.plan_service.get_plan(plan_id)
            if not existing:
                self.job_service.fail_job(job_id, f"Plan {plan_id} not found")
                return None
            plan = existing
        else:
            plan = self.plan_service.create_plan(
                job_id=job_id,
                scope={"asset_ids": asset_ids, "limit": limit, "force": force},
                status="draft",
            )

        assets = self._load_assets(asset_ids, limit, force=force, plan_id=plan.id)
        total = len(assets)
        self.job_service.update_progress(job_id, total=total,
                                         log_line=f"Found {total} assets to process")

        if self.processing_concurrency == 1:
            stopped = self._process_assets_sequentially(
                assets, leaves, plan, job_id, total,
            )
        else:
            stopped = self._process_assets_in_parallel(
                assets, leaves, plan, job_id, total,
            )
        if stopped:
            return plan.id

        plan.status = "ready"
        self.db.commit()

        # Auto-apply approved items immediately
        self._apply_auto_apply_items(plan.id)

        self.job_service.complete_job(job_id, message=f"Routed {total} assets")
        return plan.id

    def _process_assets_sequentially(
        self,
        assets: List[Asset],
        leaves: List[Bucket],
        plan: RoutingPlan,
        job_id: str,
        total: int,
    ) -> bool:
        with self.job_service.defer_commits():
            for idx, asset in enumerate(assets):
                asset_immich_id = asset.immich_id
                current = self.job_service.get_job(job_id)
                if current and current.status == "paused":
                    self.job_service.update_progress(
                        job_id,
                        log_line=f"Job paused at asset {idx + 1}/{total}",
                    )
                    self.job_service.flush()
                    return True
                if current and current.status == "cancelled":
                    self.job_service.flush()
                    return True

                self.job_service.update_progress(
                    job_id,
                    status="classifying_ai",
                    processed=idx,
                    log_line=f"Routing asset {idx + 1}/{total}: {asset_immich_id}",
                )
                try:
                    self._process_asset(asset, leaves, plan, job_id)
                    self.job_service.update_progress(
                        job_id, processed=idx + 1, success_delta=1,
                        log_line=f"\u2713 Asset {asset_immich_id} routed",
                    )
                except Exception as e:  # pragma: no cover - defensive
                    error_message = str(e)[:200]
                    self.db.rollback()
                    self.job_service.update_progress(
                        job_id, processed=idx + 1, error_delta=1,
                        log_line=f"\u2717 Routing error for {asset_immich_id}: {error_message}",
                    )
        return False

    def _process_assets_in_parallel(
        self,
        assets: List[Asset],
        leaves: List[Bucket],
        plan: RoutingPlan,
        job_id: str,
        total: int,
    ) -> bool:
        with ThreadPoolExecutor(max_workers=self.processing_concurrency) as executor:
            for batch_start in range(0, total, self.processing_concurrency):
                current = self.job_service.get_job(job_id)
                if current and current.status == "paused":
                    self.job_service.update_progress(
                        job_id,
                        log_line=f"Job paused at asset {batch_start + 1}/{total}",
                    )
                    self.job_service.flush()
                    return True
                if current and current.status == "cancelled":
                    self.job_service.flush()
                    return True

                batch = assets[
                    batch_start:batch_start + self.processing_concurrency
                ]
                prepared: list[PreparedRoutingAsset] = []
                for offset, asset in enumerate(batch):
                    index = batch_start + offset
                    self.job_service.update_progress(
                        job_id,
                        status="classifying_ai",
                        processed=index,
                        log_line=(
                            f"Routing asset {index + 1}/{total}: {asset.immich_id}"
                        ),
                    )
                    prepared.append(
                        self._prepare_asset(asset, leaves, job_id)
                    )

                futures = [
                    executor.submit(self._classify_prepared_asset, request)
                    for request in prepared
                ]
                for offset, (request, future) in enumerate(zip(prepared, futures)):
                    index = batch_start + offset
                    try:
                        raw, ai_result = future.result()
                        self._save_prepared_result(
                            request, raw, ai_result, leaves, plan,
                        )
                        self.job_service.update_progress(
                            job_id,
                            processed=index + 1,
                            success_delta=1,
                            log_line=f"\u2713 Asset {request.immich_id} routed",
                        )
                    except Exception as exc:  # pragma: no cover - defensive
                        self.db.rollback()
                        self._save_prepared_error(request, exc)
                        self.job_service.update_progress(
                            job_id,
                            processed=index + 1,
                            error_delta=1,
                            log_line=(
                                f"\u2717 Routing error for {request.immich_id}: "
                                f"{str(exc)[:200]}"
                            ),
                        )
        return False

    # ------------------------------------------------------------------
    # Per-asset
    # ------------------------------------------------------------------

    def _process_asset(
        self,
        asset: Asset,
        leaves: List[Bucket],
        plan: RoutingPlan,
        job_id: str,
    ) -> None:
        request = self._prepare_asset(asset, leaves, job_id)
        try:
            raw, ai_result = self._classify_prepared_asset(request)
        except Exception as exc:
            self._save_prepared_error(request, exc)
            raise
        self._save_prepared_result(request, raw, ai_result, leaves, plan)

    def _prepare_asset(
        self,
        asset: Asset,
        leaves: List[Bucket],
        job_id: str,
    ) -> PreparedRoutingAsset:
        asset_id = asset.id
        asset_immich_id = asset.immich_id
        messages = self.assemble_routing_messages(asset, leaves)

        prompt_run = PromptRun(
            id=str(uuid.uuid4()),
            asset_id=asset_id,
            job_run_id=job_id,
            provider_name=self.provider.provider_name,
            model_name=getattr(self.provider, "model", None) or getattr(self.provider, "_model", None),
            assembled_prompt_json={
                "messages": messages,
                "leaf_paths": [l.path or l.name for l in leaves],
            },
            status="pending",
        )
        prompt_run_id = prompt_run.id
        self.db.add(prompt_run)
        self.db.commit()
        return PreparedRoutingAsset(
            asset_id=asset_id,
            immich_id=asset_immich_id,
            prompt_run_id=prompt_run_id,
            messages=messages,
        )

    def _classify_prepared_asset(
        self,
        request: PreparedRoutingAsset,
    ) -> tuple[Dict[str, Any], AIRoutingResult]:
        image_payload = self.image_service.prepare_for_provider(request.immich_id)
        raw = self._call_provider(request.messages, image_payload)
        return raw, AIRoutingResult.model_validate(raw)

    def _save_prepared_result(
        self,
        request: PreparedRoutingAsset,
        raw: Dict[str, Any],
        ai_result: AIRoutingResult,
        leaves: List[Bucket],
        plan: RoutingPlan,
    ) -> None:
        prompt_run = self.db.query(PromptRun).filter(
            PromptRun.id == request.prompt_run_id,
        ).one()
        prompt_run.raw_response = json.dumps(raw)
        prompt_run.parsed_response_json = ai_result.model_dump()
        prompt_run.status = "success"
        decision = self.decision_service.resolve_routing(ai_result, leaves)
        self.plan_service.add_item(
            plan,
            asset_id=request.asset_id,
            decision=decision,
            ai_metadata=ai_result.metadata.model_dump(),
            raw_ai_response=ai_result.model_dump(),
        )

    def _save_prepared_error(
        self,
        request: PreparedRoutingAsset,
        exc: Exception,
    ) -> None:
        prompt_run = self.db.query(PromptRun).filter(
            PromptRun.id == request.prompt_run_id,
        ).one_or_none()
        if prompt_run:
            prompt_run.status = "failed"
            prompt_run.error_message = str(exc)
            self.db.commit()

    # ------------------------------------------------------------------
    # Prompt assembly
    # ------------------------------------------------------------------

    def assemble_routing_messages(
        self, asset: Asset, leaves: List[Bucket],
    ) -> List[Dict[str, Any]]:
        leaf_block = self.compiler.compile_global(leaves)
        leaf_paths = ", ".join(f'"{l.path or l.name}"' for l in leaves if l.is_leaf and l.enabled)

        system_content = (
            f"{GLOBAL_SYSTEM_PROMPT}\n\n"
            f"## Available Routing Leaves (use exact path strings)\n"
            f"Allowed paths: {leaf_paths}\n\n"
            f"{leaf_block}\n\n"
            f"## Output Schema\n"
            f"{ROUTING_OUTPUT_SCHEMA_INSTRUCTIONS}"
        )

        metadata_summary = self._asset_metadata_summary(asset)
        user_content = (
            "Classify this asset into the best routing leaf.\n\n"
            f"## Asset Metadata\n{metadata_summary}\n\n"
            "The asset image is attached. Return JSON only."
        )
        return [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]

    def _asset_metadata_summary(self, asset: Asset) -> str:
        parts = []
        if asset.original_filename:
            parts.append(f"Filename: {asset.original_filename}")
        if asset.file_created_at:
            parts.append(f"Date: {asset.file_created_at}")
        if asset.asset_type:
            parts.append(f"Type: {asset.asset_type}")
        if asset.city or asset.country:
            loc = ", ".join(filter(None, [asset.city, asset.country]))
            parts.append(f"Location: {loc}")
        if asset.camera_make or asset.camera_model:
            cam = " ".join(filter(None, [asset.camera_make, asset.camera_model]))
            parts.append(f"Camera: {cam}")
        if asset.description:
            parts.append(f"Current description: {asset.description}")
        if asset.tags_json:
            parts.append(f"Current tags: {', '.join(asset.tags_json)}")
        return "\n".join(parts) or "No metadata available."

    # ------------------------------------------------------------------
    # Provider call
    # ------------------------------------------------------------------

    def _call_provider(
        self, messages: List[Dict[str, Any]], image_payload: Optional[dict],
    ) -> Dict[str, Any]:
        """Ask the provider to return a routing JSON object."""
        return self.provider.classify_routing(messages, image_payload)

    # ------------------------------------------------------------------
    # Auto-apply
    # ------------------------------------------------------------------

    def _apply_auto_apply_items(self, plan_id: str) -> None:
        items = self.plan_service.list_items(plan_id)
        for item in items:
            if not item.auto_apply or item.status != "approved":
                continue
            try:
                result = self.writeback_service.apply_item(item)
                if result.errors:
                    item.status = "failed"
                    item.error_message = "; ".join(result.errors)[:500]
                else:
                    item.status = "applied"
                self.db.commit()
            except Exception as e:  # pragma: no cover
                item.status = "failed"
                item.error_message = str(e)[:500]
                self.db.commit()
        self.plan_service.mark_plan_applied(plan_id)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _load_assets(
        self,
        asset_ids: Optional[List[str]],
        limit: Optional[int],
        force: bool = False,
        plan_id: Optional[str] = None,
    ) -> List[Asset]:
        q = self.db.query(Asset).filter(Asset.user_id == self.user_id)
        if asset_ids:
            q = q.filter(Asset.id.in_(asset_ids))
        if plan_id:
            q = q.filter(
                ~Asset.id.in_(
                    self.db.query(RoutingPlanItem.asset_id).filter(
                        RoutingPlanItem.user_id == self.user_id,
                        RoutingPlanItem.plan_id == plan_id,
                    )
                )
            )
        if not force:
            q = q.filter(
                ~Asset.id.in_(
                    self.db.query(RoutingPlanItem.asset_id).filter(
                        RoutingPlanItem.user_id == self.user_id,
                    )
                )
            )
        q = q.order_by(Asset.created_at.asc(), Asset.id.asc())
        if limit:
            q = q.limit(limit)
        return q.all()


ROUTING_OUTPUT_SCHEMA_INSTRUCTIONS = """Return ONLY a JSON object with these exact fields:
{
  "disposition": "keep" | "review" | "trash_candidate",
  "primary_path": "<one of the allowed paths>" or null,
  "primary_confidence": 0.0-1.0 or null,
  "secondary_paths": [{"path": "<path>", "confidence": 0.0-1.0}],
  "review_required": boolean,
  "review_reasons": ["<short snake_case codes>"],
  "reason_codes": ["<reason codes>"],
  "safety_flags": {
    "faces_visible": bool,
    "children_visible": bool,
    "address_visible": bool,
    "documents_visible": bool,
    "license_plate_visible": bool,
    "private_info_visible": bool
  },
  "quality_flags": {
    "blurry": bool,
    "dark": bool,
    "screenshot": bool,
    "duplicate_candidate": bool,
    "low_quality": bool
  },
  "metadata": {
    "description": "string or null",
    "tags": ["string"],
    "location": null or { "latitude": float, "longitude": float, "place_name": "string" },
    "caption": "string or null"
  }
}

Only use exact path strings from the allowed list. Do not invent paths.
"""
