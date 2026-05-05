"""
task_retriever.py
-----------------
Loads the existing ChromaDB task vector database and provides retrieval
functions for use by the FastAPI layer.

Does NOT rebuild the vector DB. If the DB is missing, a clear error is raised.
To build the DB first, run:
    cd backend
    python vector_db/build_task_vector_db.py

USAGE (standalone test)
-----------------------
    cd backend
    python vector_db/task_retriever.py
"""

from pathlib import Path
from typing import Optional

import chromadb
from sentence_transformers import SentenceTransformer

# ── Paths ──────────────────────────────────────────────────────────────────────
BACKEND_DIR     = Path(__file__).parent.parent
CHROMA_DIR      = BACKEND_DIR / "vector_db" / "chroma_task_db"
COLLECTION_NAME = "task_profiles"
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

# ── Module-level singletons (lazy-loaded on first call) ───────────────────────
_model:      Optional[SentenceTransformer] = None
_collection = None


# ── Collection loader ──────────────────────────────────────────────────────────

def load_task_collection():
    """
    Load the ChromaDB collection and embedding model.
    Results are cached at module level — subsequent calls are instant.

    Raises
    ------
    FileNotFoundError
        If backend/vector_db/chroma_task_db/ does not exist.
    ValueError
        If the expected collection is not present in the DB.
    """
    global _model, _collection

    if _collection is not None:
        return _collection, _model

    # Guard: DB directory must exist
    if not CHROMA_DIR.exists():
        raise FileNotFoundError(
            "Vector DB not found. "
            "Run: cd backend && python vector_db/build_task_vector_db.py"
        )

    client = chromadb.PersistentClient(path=str(CHROMA_DIR))

    # Guard: collection must exist inside the DB
    try:
        collection = client.get_collection(COLLECTION_NAME)
    except Exception:
        raise ValueError(
            f"Collection '{COLLECTION_NAME}' not found in the ChromaDB at {CHROMA_DIR}. "
            "Run: cd backend && python vector_db/build_task_vector_db.py"
        )

    model = SentenceTransformer(EMBEDDING_MODEL)

    _collection = collection
    _model = model

    print(
        f"[task_retriever] Loaded collection '{COLLECTION_NAME}' "
        f"({_collection.count()} docs) from {CHROMA_DIR}"
    )
    return _collection, _model


# ── Core retrieval ─────────────────────────────────────────────────────────────

def retrieve_relevant_tasks(query: str, top_k: int = 10) -> list[dict]:
    """
    Embed a query string and return the top-k most similar tasks from ChromaDB.

    Parameters
    ----------
    query  : Natural-language query string.
    top_k  : Number of results to return (default 10).

    Returns
    -------
    List of dicts, each containing:
        task_id, task_name, task_category, computational_step,
        deadline_class, priority, network_required,
        quantum_candidate, quantum_algorithm,
        similarity_score, raw_metadata
    """
    collection, model = load_task_collection()

    # Clamp top_k to number of stored documents
    n = min(top_k, collection.count())
    if n == 0:
        return []

    query_embedding = model.encode([query]).tolist()

    results = collection.query(
        query_embeddings=query_embedding,
        n_results=n,
        include=["metadatas", "distances"],
    )

    tasks = []
    for meta, dist in zip(results["metadatas"][0], results["distances"][0]):
        tasks.append({
            "task_id":           meta.get("task_id", ""),
            "task_name":         meta.get("task_name", ""),
            "task_category":     meta.get("task_category", ""),
            "computational_step": meta.get("computational_step", ""),
            "deadline_class":    meta.get("deadline_class", ""),
            "priority":          meta.get("priority", ""),
            "network_required":  meta.get("network_required", ""),
            "quantum_candidate": meta.get("quantum_candidate", ""),
            "quantum_algorithm": meta.get("quantum_algorithm", ""),
            "similarity_score":  round(1.0 - dist, 4),  # cosine distance → similarity
            "raw_metadata":      meta,
        })

    return tasks


# ── Collision scenario query builder ──────────────────────────────────────────

def build_collision_rag_query(collision_json: dict) -> str:
    """
    Convert a collision predictor JSON (with a "features" list) into a
    natural-language RAG query string.

    Expects feature objects with fields: feature_name, feature_group, value.
    Only rows where feature_group == "llm" are used.

    Parameters
    ----------
    collision_json : dict with a "features" key containing a list of feature dicts.

    Returns
    -------
    A multi-line query string suitable for semantic retrieval.
    """
    features = collision_json.get("features", [])

    # Index all "llm" group features by name → value string
    llm: dict[str, str] = {}
    for f in features:
        if f.get("feature_group") == "llm":
            name  = f.get("feature_name", "")
            value = f.get("value", "unknown")
            if name:
                llm[name] = str(value) if value is not None else "unknown"

    def get(key: str) -> str:
        return llm.get(key, "unknown")

    query = (
        "Satellite collision avoidance scenario.\n"
        f"Risk class: {get('risk_class')}\n"
        f"Collision probability: {get('collision_probability')}\n"
        f"Time to closest approach: {get('time_to_closest_approach')}\n"
        f"Target satellite: {get('target_satellite')}\n"
        f"Hazard object: {get('hazard_object')}\n"
        f"Can maneuver: {get('can_maneuver')}\n"
        f"Delta-v budget: {get('delta_v_budget')}\n"
        f"Fuel remaining: {get('fuel_remaining')}\n"
        f"Thruster status: {get('thruster_status')}\n"
        f"Allowed maneuver types: {get('allowed_maneuver_types')}\n"
        f"Power risk: {get('power_risk')}\n"
        f"Thermal risk: {get('thermal_risk')}\n"
        f"Communication available: {get('communication_available')}\n"
        f"Communication risk: {get('communication_risk')}\n"
        f"Sensor confidence: {get('sensor_confidence')}\n"
        f"Trust level: {get('trust_level')}\n"
        f"Safe autonomous control: {get('safe_autonomous_control')}\n"
        "Retrieve tasks for orbit propagation, collision avoidance maneuver planning, "
        "sensor validation, communications, mission scheduling, human review, "
        "and quantum/classical optimization if relevant."
    )

    return query


# ── Standalone test ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    TEST_QUERY = (
        "high risk satellite collision avoidance maneuver "
        "orbit propagation mission scheduling"
    )

    print("=" * 60)
    print("  Q-Router — Task Retriever Test")
    print("=" * 60)
    print(f'\nQuery: "{TEST_QUERY}"\n')

    try:
        results = retrieve_relevant_tasks(TEST_QUERY, top_k=10)
    except (FileNotFoundError, ValueError) as e:
        print(f"[ERROR] {e}")
        raise SystemExit(1)

    print(f"Top {len(results)} results:\n" + "─" * 60)
    for i, r in enumerate(results, 1):
        print(
            f"  {i:>2}. [{r['task_id']:12s}] {r['task_name']}\n"
            f"       Category   : {r['task_category']}\n"
            f"       Deadline   : {r['deadline_class']}\n"
            f"       Quantum    : {r['quantum_candidate']}  ({r['quantum_algorithm']})\n"
            f"       Similarity : {r['similarity_score']:.4f}\n"
        )
    print("─" * 60)

    # Also test the collision query builder with a sample payload
    print("\nCollision RAG query builder test:")
    print("─" * 60)
    sample_collision = {
        "features": [
            {"feature_name": "risk_class",              "feature_group": "llm", "value": "HIGH"},
            {"feature_name": "collision_probability",   "feature_group": "llm", "value": "0.18"},
            {"feature_name": "time_to_closest_approach","feature_group": "llm", "value": "4.2 hours"},
            {"feature_name": "target_satellite",        "feature_group": "llm", "value": "SAT-01"},
            {"feature_name": "hazard_object",           "feature_group": "llm", "value": "COSMOS 2251 DEB"},
            {"feature_name": "can_maneuver",            "feature_group": "llm", "value": "yes"},
            {"feature_name": "delta_v_budget",          "feature_group": "llm", "value": "2.1 m/s"},
            {"feature_name": "fuel_remaining",          "feature_group": "llm", "value": "38%"},
            {"feature_name": "thruster_status",         "feature_group": "llm", "value": "nominal"},
            {"feature_name": "allowed_maneuver_types",  "feature_group": "llm", "value": "prograde, radial"},
            {"feature_name": "power_risk",              "feature_group": "llm", "value": "low"},
            {"feature_name": "thermal_risk",            "feature_group": "llm", "value": "low"},
            {"feature_name": "communication_available", "feature_group": "llm", "value": "yes"},
            {"feature_name": "communication_risk",      "feature_group": "llm", "value": "low"},
            {"feature_name": "sensor_confidence",       "feature_group": "llm", "value": "0.92"},
            {"feature_name": "trust_level",             "feature_group": "llm", "value": "high"},
            {"feature_name": "safe_autonomous_control", "feature_group": "llm", "value": "yes"},
            # non-llm features are ignored
            {"feature_name": "raw_pc",                  "feature_group": "ml",  "value": "0.18"},
        ]
    }
    generated_query = build_collision_rag_query(sample_collision)
    print(generated_query)
    print("─" * 60)

    print("\n[OK] Retriever test complete.")
