from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import require_active_user
from ..schemas.routing_evaluation import RoutingEvaluationOut, RoutingEvaluationSaveRequest
from ..services.provider_resolver import resolve_user_provider
from ..services.routing_evaluation import RoutingEvaluationError, RoutingEvaluationService
from .routing import _get_user_immich_client


router = APIRouter(prefix="/api/routing/evaluation", tags=["routing-evaluation"])


@router.get("", response_model=RoutingEvaluationOut)
def get_evaluation(
    db: Session = Depends(get_db),
    current_user=Depends(require_active_user),
):
    return RoutingEvaluationService(db, current_user.id).get_state()


@router.put("", response_model=RoutingEvaluationOut)
def save_evaluation(
    body: RoutingEvaluationSaveRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_active_user),
):
    try:
        return RoutingEvaluationService(db, current_user.id).save_items(body.items)
    except RoutingEvaluationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/run", response_model=RoutingEvaluationOut)
def run_evaluation(
    body: RoutingEvaluationSaveRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_active_user),
):
    try:
        provider = resolve_user_provider(db, current_user.id)
        immich_client = _get_user_immich_client(db, current_user.id)
        with immich_client:
            return RoutingEvaluationService(
                db,
                current_user.id,
                provider=provider,
                immich_client=immich_client,
            ).evaluate(body.items)
    except RoutingEvaluationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/run/start", response_model=RoutingEvaluationOut)
def start_evaluation(
    body: RoutingEvaluationSaveRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_active_user),
):
    try:
        return RoutingEvaluationService(db, current_user.id).prepare_run(body.items)
    except RoutingEvaluationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/items/{item_id}/run", response_model=RoutingEvaluationOut)
def run_evaluation_item(
    item_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_active_user),
):
    try:
        provider = resolve_user_provider(db, current_user.id)
        immich_client = _get_user_immich_client(db, current_user.id)
        with immich_client:
            return RoutingEvaluationService(
                db,
                current_user.id,
                provider=provider,
                immich_client=immich_client,
            ).evaluate_item(item_id)
    except RoutingEvaluationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
