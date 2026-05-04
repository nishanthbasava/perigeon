from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
        "reason": "Low latency and small input size. Quantum not needed."
    }