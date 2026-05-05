from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.models import (
    RetrieveTasksRequest,
    RetrieveTasksResponse,
    RetrieveFromCollisionRequest,
    RetrieveFromCollisionResponse,
    RetrievedTask,
    GenerateAgendasRequest,
)
from vector_db.task_retriever import (
    retrieve_relevant_tasks,
    build_collision_rag_query,
)
from app.agenda_maker import generate_agendas_from_collision
from app.sim_adapter import (
    run_simulation, get_events, clear_cache,
    get_sim_state, start_sim, stop_sim, execute_sim_maneuver,
)

app = FastAPI(title="Q-Router API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "Q-Router backend running"}


# ── Orbital simulation endpoints ───────────────────────────────────────────────

@app.get("/simulation/frames")
def simulation_frames():
    """
    Return pre-computed animation frames (positions in km) + orbit rings + metadata.
    Cached after first call.
    """
    try:
        result = run_simulation()
        print(f"[/simulation/frames] returning {result['metadata']['numFrames']} frames, "
              f"{result['metadata']['numObjects']} objects")
        return result
    except Exception as exc:
        print(f"[/simulation/frames] ERROR: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/simulation/events")
def simulation_events():
    """Return conjunction / collision events detected by the simulation."""
    try:
        result = get_events()
        print(f"[/simulation/events] returning {len(result['events'])} event(s)")
        return result
    except Exception as exc:
        print(f"[/simulation/events] ERROR: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/simulation/run")
def simulation_run():
    """Clear cached simulation and recompute."""
    try:
        clear_cache()
        result = run_simulation()
        return {
            "status": "recomputed",
            "numFrames": result["metadata"]["numFrames"],
            "numObjects": result["metadata"]["numObjects"],
        }
    except Exception as exc:
        print(f"[/simulation/run] ERROR: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/simulation/state")
def simulation_state():
    """Return current live simulation state; advances one frame if running."""
    try:
        return get_sim_state()
    except Exception as exc:
        print(f"[/simulation/state] ERROR: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/simulation/start")
def simulation_start():
    """Start / resume the simulation loop."""
    return start_sim()


@app.post("/simulation/stop")
def simulation_stop():
    """Pause the simulation loop."""
    return stop_sim()


@app.post("/simulation/execute-maneuver")
def simulation_execute_maneuver(body: dict):
    """Apply an avoidance maneuver to the primary asset and recompute frames."""
    try:
        primary      = body.get("primaryAsset", "SAT-01")
        maneuver_type = body.get("maneuverType", "prograde")
        return execute_sim_maneuver(primary, maneuver_type)
    except Exception as exc:
        print(f"[/simulation/execute-maneuver] ERROR: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


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


@app.post("/generate-agendas-from-collision")
def generate_agendas(req: GenerateAgendasRequest):
    """
    Full pipeline: collision features → RAG retrieval → deterministic scoring →
    3 ranked agenda options with reasoning steps.
    """
    try:
        result = generate_agendas_from_collision({"features": req.features})
        return result
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=503, detail=str(e))


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

