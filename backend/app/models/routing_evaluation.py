from sqlalchemy import Boolean, Column, DateTime, Float, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from ..database import Base


class RoutingEvaluation(Base):
    __tablename__ = "routing_evaluations"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    total_score = Column(Float, nullable=True)
    max_score = Column(Float, nullable=True)
    evaluated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", name="uq_routing_evaluations_user"),
    )


class RoutingEvaluationItem(Base):
    __tablename__ = "routing_evaluation_items"

    id = Column(String, primary_key=True)
    evaluation_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)
    position = Column(Integer, nullable=False)

    immich_id = Column(String, nullable=False)
    expected_tag = Column(String, nullable=True)
    expected_absent_tag = Column(String, nullable=True)
    expected_destination = Column(String, nullable=True)

    result_description = Column(Text, nullable=True)
    result_tags_json = Column(JSON, nullable=True)
    result_destination = Column(String, nullable=True)
    result_disposition = Column(String, nullable=True)
    tag_matched = Column(Boolean, nullable=True)
    absent_tag_matched = Column(Boolean, nullable=True)
    destination_matched = Column(Boolean, nullable=True)
    score = Column(Float, nullable=True)
    max_score = Column(Float, nullable=True)
    error_message = Column(Text, nullable=True)
    evaluated_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
