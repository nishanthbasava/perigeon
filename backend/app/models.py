from pydantic import BaseModel
from typing import Any, Optional


class TaskInput(BaseModel):
    task_name: str
    input_size_bytes: int
    latency_budget_ms: int
    typical_classical_runtime_ms: float
    priority: int
    quantum_candidate: bool
    error_tolerance: Optional[str] = None


# ── RAG retrieval models ───────────────────────────────────────────────────────

class RetrieveTasksRequest(BaseModel):
    query: str


class CollisionFeature(BaseModel):
    """A single feature from the collision predictor output."""
    feature_name:  str
    feature_group: str
    value:         Any = None

    model_config = {"extra": "allow"}   # tolerate extra fields from upstream


class RetrieveFromCollisionRequest(BaseModel):
    features: list[CollisionFeature]


class RetrievedTask(BaseModel):
    task_id:          str
    task_name:        str
    task_category:    str
    similarity_score: float
    metadata:         dict


class RetrieveTasksResponse(BaseModel):
    query:   str
    results: list[RetrievedTask]


class RetrieveFromCollisionResponse(BaseModel):
    generated_query: str
    results:         list[RetrievedTask]


class GenerateAgendasRequest(BaseModel):
    features: list[dict]