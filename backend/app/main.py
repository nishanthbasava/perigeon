from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.models import (
    RetrieveTasksRequest,
    RetrieveTasksResponse,
    RetrieveFromCollisionRequest,
    RetrieveFromCollisionResponse,
    RetrievedTask,
)
from vector_db.task_retriever import (
    retrieve_relevant_tasks,
    build_collision_rag_query,
)

app = FastAPI(title="Q-Router API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "Q-Router backend running"}


@app.post("/route-task")
def route_task(task: dict):
    return {
        "task": task,
        "decision": "classical",
        "reason": "Low latency and small input size. Quantum not needed.",
    }


# ── RAG retrieval endpoints ────────────────────────────────────────────────────

@app.post("/retrieve-tasks", response_model=RetrieveTasksResponse)
def retrieve_tasks(req: RetrieveTasksRequest):
    """
    Embed the query and return the top 10 most relevant tasks from the
    vector DB.

    Requires the vector DB to be built first:
        cd backend && python vector_db/build_task_vector_db.py
    """
    try:
        raw = retrieve_relevant_tasks(req.query, top_k=10)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=503, detail=str(e))

    return RetrieveTasksResponse(
        query=req.query,
        results=[
            RetrievedTask(
                task_id=r["task_id"],
                task_name=r["task_name"],
                task_category=r["task_category"],
                similarity_score=r["similarity_score"],
                metadata=r["raw_metadata"],
            )
            for r in raw
        ],
    )


@app.post("/retrieve-tasks-from-collision", response_model=RetrieveFromCollisionResponse)
def retrieve_tasks_from_collision(req: RetrieveFromCollisionRequest):
    """
    Convert a collision predictor feature payload into a RAG query, then
    retrieve the top 10 most relevant tasks.

    Only features with feature_group == "llm" are used to build the query.
    """
    try:
        features_dicts = [f.model_dump() for f in req.features]
        query = build_collision_rag_query({"features": features_dicts})
        raw   = retrieve_relevant_tasks(query, top_k=10)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=503, detail=str(e))

    return RetrieveFromCollisionResponse(
        generated_query=query,
        results=[
            RetrievedTask(
                task_id=r["task_id"],
                task_name=r["task_name"],
                task_category=r["task_category"],
                similarity_score=r["similarity_score"],
                metadata=r["raw_metadata"],
            )
            for r in raw
        ],
    )

