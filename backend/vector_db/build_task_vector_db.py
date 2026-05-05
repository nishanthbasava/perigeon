"""
build_task_vector_db.py
-----------------------
Reads the Q-Router task profile CSV and builds a persistent ChromaDB
vector database using local sentence-transformer embeddings.

USAGE
-----
    cd backend
    python vector_db/build_task_vector_db.py

FILES
-----
  Input CSV    : backend/database/task_profile.csv
  Vector DB    : backend/vector_db/chroma_task_db/   (created automatically)
  Model        : sentence-transformers/all-MiniLM-L6-v2
                 (downloaded to ~/.cache/huggingface on first run)

REBUILD
-------
  Re-running the script wipes and recreates the collection cleanly.
  Safe to run multiple times.

TEST RETRIEVAL
--------------
  After building, the script runs a test query and prints the top 5
  retrieved tasks with task_id, task_name, task_category, and
  cosine similarity score.
"""

import sys
from pathlib import Path

import pandas as pd
import chromadb
from sentence_transformers import SentenceTransformer

# ── Paths ──────────────────────────────────────────────────────────────────────
# __file__ is  backend/vector_db/build_task_vector_db.py
# .parent      → backend/vector_db/
# .parent.parent → backend/
BACKEND_DIR = Path(__file__).parent.parent
CSV_PATH    = BACKEND_DIR / "database" / "task_profile.csv"
CHROMA_DIR  = BACKEND_DIR / "vector_db" / "chroma_task_db"

COLLECTION_NAME = "task_profiles"
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

EXPECTED_COLUMNS = [
    "task_id",
    "task_name",
    "task_category",
    "computational_step",
    "classical_algorithm",
    "typical_classical_runtime_ms",
    "input_size_bytes",
    "output_size_bytes",
    "latency_budget_ms",
    "deadline_class",
    "classification_level",
    "priority",
    "network_required",
    "quantum_candidate",
    "quantum_algorithm",
    "expected_quantum_speedup",
    "error_tolerance",
]


# ── Document formatting ────────────────────────────────────────────────────────

def row_to_document(row: dict) -> str:
    """Convert a CSV row into a structured text document for embedding."""
    def get(col: str) -> str:
        val = str(row.get(col, "")).strip()
        return val if val and val.lower() not in ("nan", "") else "N/A"

    return (
        f"Task ID: {get('task_id')}\n"
        f"Task Name: {get('task_name')}\n"
        f"Category: {get('task_category')}\n"
        f"Computational Step: {get('computational_step')}\n"
        f"Classical Algorithm: {get('classical_algorithm')}\n"
        f"Typical Classical Runtime: {get('typical_classical_runtime_ms')}\n"
        f"Input Size Bytes: {get('input_size_bytes')}\n"
        f"Output Size Bytes: {get('output_size_bytes')}\n"
        f"Latency Budget MS: {get('latency_budget_ms')}\n"
        f"Deadline Class: {get('deadline_class')}\n"
        f"Classification Level: {get('classification_level')}\n"
        f"Priority: {get('priority')}\n"
        f"Network Required: {get('network_required')}\n"
        f"Quantum Candidate: {get('quantum_candidate')}\n"
        f"Quantum Algorithm: {get('quantum_algorithm')}\n"
        f"Expected Quantum Speedup: {get('expected_quantum_speedup')}\n"
        f"Error Tolerance: {get('error_tolerance')}"
    )


# ── CSV loading ────────────────────────────────────────────────────────────────

def load_csv(path: Path) -> pd.DataFrame:
    """Load, validate, and normalise the task profile CSV."""
    if not path.exists():
        print(f"[ERROR] CSV not found at: {path}")
        print("        Expected location: backend/database/task_profile.csv")
        sys.exit(1)

    df = pd.read_csv(path, dtype=str)
    df.columns = df.columns.str.strip()   # remove accidental whitespace in headers
    df = df.fillna("")                    # replace NaN with empty string

    print(f"[OK]   Loaded {len(df)} rows, {len(df.columns)} columns from {path.name}")

    missing = [c for c in EXPECTED_COLUMNS if c not in df.columns]
    if missing:
        print(f"[WARN] Missing expected columns (will default to empty): {missing}")

    # Ensure every expected column exists, even if absent in the file
    for col in EXPECTED_COLUMNS:
        if col not in df.columns:
            df[col] = ""

    return df


# ── Vector DB build ────────────────────────────────────────────────────────────

def build_db(df: pd.DataFrame) -> tuple:
    """
    Build the ChromaDB collection from the dataframe.
    Returns (collection, model) so the caller can reuse them for queries.
    """
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)

    # Load embedding model
    print(f"[...] Loading embedding model: {EMBEDDING_MODEL}")
    print("      (model will be downloaded to ~/.cache/huggingface on first run)")
    model = SentenceTransformer(EMBEDDING_MODEL)
    print("[OK]  Model ready\n")

    # Build document strings, stable IDs, and metadata dicts
    documents: list[str] = []
    ids:       list[str] = []
    metadatas: list[dict] = []

    for i, row in df.iterrows():
        row_dict = row.to_dict()

        task_id = str(row_dict.get("task_id", "")).strip()
        doc_id  = task_id if task_id else f"row_{i}"

        documents.append(row_to_document(row_dict))
        ids.append(doc_id)
        # ChromaDB requires metadata values to be str / int / float / bool
        metadatas.append({k: str(v) for k, v in row_dict.items()})

    # Generate embeddings (local, no network call)
    print(f"[...] Generating embeddings for {len(documents)} documents...")
    embeddings = model.encode(documents, show_progress_bar=True, batch_size=32)
    print("[OK]  Embeddings generated\n")

    # Write to ChromaDB
    print(f"[...] Writing to ChromaDB at:\n      {CHROMA_DIR}")
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))

    # Wipe existing collection for a clean rebuild
    try:
        client.delete_collection(COLLECTION_NAME)
        print(f"[OK]  Deleted existing collection '{COLLECTION_NAME}' (clean rebuild)")
    except Exception:
        pass  # did not exist yet

    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},  # use cosine similarity
    )

    collection.add(
        ids=ids,
        documents=documents,
        embeddings=embeddings.tolist(),
        metadatas=metadatas,
    )

    count = collection.count()
    print(f"[OK]  Stored {count} documents in collection '{COLLECTION_NAME}'")
    print(f"      Persistent path: {CHROMA_DIR}\n")

    return collection, model


# ── Retrieval verification ─────────────────────────────────────────────────────

def verify_retrieval(collection, model: SentenceTransformer) -> None:
    """Run a test query and print the top 5 results."""
    query = "collision avoidance maneuver orbit propagation scheduling"

    print("── Verification Query " + "─" * 39)
    print(f'   "{query}"')
    print("─" * 60)

    query_embedding = model.encode([query]).tolist()

    results = collection.query(
        query_embeddings=query_embedding,
        n_results=5,
        include=["metadatas", "distances"],
    )

    metadatas_list = results["metadatas"][0]
    distances      = results["distances"][0]

    for rank, (meta, dist) in enumerate(zip(metadatas_list, distances), start=1):
        similarity = 1.0 - dist   # cosine distance → similarity
        print(
            f"  {rank}. [{meta.get('task_id', '?'):12s}] "
            f"{meta.get('task_name', '?')}\n"
            f"     Category  : {meta.get('task_category', '?')}\n"
            f"     Similarity: {similarity:.4f}\n"
        )

    print("─" * 60)
    print("[OK]  Verification complete")


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Q-Router — Task Vector DB Builder")
    print("=" * 60 + "\n")

    df = load_csv(CSV_PATH)
    collection, model = build_db(df)
    verify_retrieval(collection, model)

    print("\n[DONE] Vector DB is ready.")
    print(f"       Location: {CHROMA_DIR}")


if __name__ == "__main__":
    main()
