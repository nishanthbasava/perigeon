from fastapi import APIRouter
from app.models import TaskInput

router = APIRouter()


@router.post("/route-task")
def route_task(task: TaskInput):
    score = 0

    if task.quantum_candidate:
        score += 2
    if task.input_size_bytes > 100_000:
        score += 1
    if task.typical_classical_runtime_ms > task.latency_budget_ms:
        score += 2
    if task.priority >= 4:
        score += 1

    decision = "quantum" if score >= 4 else "classical"

    return {
        "task": task.task_name,
        "decision": decision,
        "score": score,
        "reason": (
            "Quantum route selected due to candidate flag, scale, latency pressure, or priority."
            if decision == "quantum"
            else "Classical route selected because the task is fast enough and does not need quantum optimization."
        ),
    }