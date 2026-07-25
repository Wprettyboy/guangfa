"""Local BGE-M3 dense/sparse embedding and reranker service for AMD ROCm."""

from __future__ import annotations

import math
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


EMBEDDING_MODEL_PATH = os.getenv("RETRIEVAL_EMBEDDING_MODEL_PATH", "/opt/guangfa-retrieval/models/bge-m3")
RERANKER_MODEL_PATH = os.getenv("RETRIEVAL_RERANKER_MODEL_PATH", "/opt/guangfa-retrieval/models/bge-reranker-v2-m3")
EMBEDDING_MODEL_NAME = os.getenv("RETRIEVAL_EMBEDDING_MODEL", "BAAI/bge-m3")
RERANKER_MODEL_NAME = os.getenv("RETRIEVAL_RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
EMBEDDING_BATCH_SIZE = int(os.getenv("RETRIEVAL_EMBEDDING_BATCH_SIZE", "8"))
RERANK_BATCH_SIZE = int(os.getenv("RETRIEVAL_RERANK_BATCH_SIZE", "4"))
MAX_SEQ_LENGTH = int(os.getenv("RETRIEVAL_MAX_SEQ_LENGTH", "8192"))
RERANK_MAX_LENGTH = int(os.getenv("RETRIEVAL_RERANK_MAX_LENGTH", "2048"))
SPARSE_MIN_WEIGHT = float(os.getenv("RETRIEVAL_SPARSE_MIN_WEIGHT", "0.01"))
SPARSE_MAX_TERMS = int(os.getenv("RETRIEVAL_SPARSE_MAX_TERMS", "192"))
EMPTY_CACHE_THRESHOLD_BYTES = int(os.getenv("RETRIEVAL_EMPTY_CACHE_THRESHOLD_BYTES", str(2 * 1024**3)))

inference_lock = threading.Lock()
embedding_model: Any = None
reranker_model: Any = None
started_at = time.time()
metrics = {
    "encode_requests": 0,
    "rerank_requests": 0,
    "queue_timeouts": 0,
    "oom_count": 0,
    "empty_cache_count": 0,
}


class EmbeddingRequest(BaseModel):
    model: str | None = None
    input: str | list[str]
    dimensions: int | None = None
    deadline_ms: int = Field(default=60_000, ge=100, le=300_000)


class RetrievalEncodeRequest(BaseModel):
    input: str | list[str]
    deadline_ms: int = Field(default=60_000, ge=100, le=300_000)


class RerankRequest(BaseModel):
    query: str
    documents: list[str]
    deadline_ms: int = Field(default=5_000, ge=100, le=30_000)


def load_models() -> None:
    global embedding_model, reranker_model
    from FlagEmbedding import BGEM3FlagModel, FlagReranker

    embedding_model = BGEM3FlagModel(EMBEDDING_MODEL_PATH, use_fp16=True, devices=["cuda:0"])
    reranker_model = FlagReranker(RERANKER_MODEL_PATH, use_fp16=True, devices=["cuda:0"])


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not torch.cuda.is_available():
        raise RuntimeError("AMD ROCm GPU is not available")
    load_models()
    encode_dense_sparse(["检索服务预热"])
    compute_rerank("预热", ["检索服务预热"])
    yield


app = FastAPI(title="Guangfa Retrieval Model Service", version="4.0.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    memory = read_gpu_memory()
    return {
        "status": "healthy" if embedding_model is not None and reranker_model is not None else "starting",
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "embedding_model": EMBEDDING_MODEL_NAME,
        "reranker_model": RERANKER_MODEL_NAME,
        "embedding_loaded": embedding_model is not None,
        "reranker_loaded": reranker_model is not None,
        "sparse_min_weight": SPARSE_MIN_WEIGHT,
        "sparse_max_terms": SPARSE_MAX_TERMS,
        "uptime_seconds": int(time.time() - started_at),
        "memory": memory,
        "metrics": dict(metrics),
    }


@app.post("/v1/embeddings")
def create_embeddings(payload: EmbeddingRequest) -> dict[str, Any]:
    texts = normalize_inputs(payload.input)
    with acquired_inference_lock(payload.deadline_ms):
        started = time.time()
        metrics["encode_requests"] += 1
        dense = run_gpu_operation(lambda: encode_dense(texts))
    dimension = payload.dimensions or 0
    rows = [fit_dimension(vector, dimension) for vector in dense]
    return {
        "object": "list",
        "model": payload.model or EMBEDDING_MODEL_NAME,
        "data": [{"object": "embedding", "index": index, "embedding": row} for index, row in enumerate(rows)],
        "usage": {"prompt_tokens": sum(len(text) for text in texts), "total_tokens": sum(len(text) for text in texts), "elapsed_ms": int((time.time() - started) * 1000)},
    }


@app.post("/v1/retrieval/encode")
def retrieval_encode(payload: RetrievalEncodeRequest) -> dict[str, Any]:
    texts = normalize_inputs(payload.input)
    with acquired_inference_lock(payload.deadline_ms):
        started = time.time()
        metrics["encode_requests"] += 1
        dense, sparse = run_gpu_operation(lambda: encode_dense_sparse(texts))
    return {
        "model": EMBEDDING_MODEL_NAME,
        "data": [
            {
                "index": index,
                "dense_embedding": dense[index],
                "sparse_embedding": sparse[index],
            }
            for index in range(len(texts))
        ],
        "sparse_min_weight": SPARSE_MIN_WEIGHT,
        "sparse_max_terms": SPARSE_MAX_TERMS,
        "elapsed_ms": int((time.time() - started) * 1000),
    }


@app.post("/v1/rerank")
def rerank(payload: RerankRequest) -> dict[str, Any]:
    query = payload.query.strip()
    documents = [item.strip() for item in payload.documents]
    if not query:
        raise HTTPException(status_code=400, detail="query cannot be empty")
    if not documents or len(documents) > 20 or any(not item for item in documents):
        raise HTTPException(status_code=400, detail="documents must contain 1 to 20 non-empty strings")
    with acquired_inference_lock(payload.deadline_ms):
        started = time.time()
        metrics["rerank_requests"] += 1
        scores = run_gpu_operation(lambda: compute_rerank(query, documents))
    return {
        "model": RERANKER_MODEL_NAME,
        "data": [{"index": index, "score": score} for index, score in enumerate(scores)],
        "elapsed_ms": int((time.time() - started) * 1000),
    }


class acquired_inference_lock:
    def __init__(self, deadline_ms: int):
        self.timeout = max(0.1, deadline_ms / 1000)
        self.acquired = False

    def __enter__(self):
        self.acquired = inference_lock.acquire(timeout=self.timeout)
        if not self.acquired:
            metrics["queue_timeouts"] += 1
            raise HTTPException(status_code=503, detail="retrieval inference queue deadline exceeded")
        return self

    def __exit__(self, *_: Any):
        if self.acquired:
            inference_lock.release()


def encode_dense(texts: list[str]) -> list[list[float]]:
    output = embedding_model.encode(
        texts,
        batch_size=min(EMBEDDING_BATCH_SIZE, len(texts)),
        max_length=MAX_SEQ_LENGTH,
        return_dense=True,
        return_sparse=False,
        return_colbert_vecs=False,
    )
    return [np.asarray(vector, dtype=np.float32).astype(float).tolist() for vector in output["dense_vecs"]]


def encode_dense_sparse(texts: list[str]) -> tuple[list[list[float]], list[dict[str, float]]]:
    output = embedding_model.encode(
        texts,
        batch_size=min(EMBEDDING_BATCH_SIZE, len(texts)),
        max_length=MAX_SEQ_LENGTH,
        return_dense=True,
        return_sparse=True,
        return_colbert_vecs=False,
    )
    dense = [np.asarray(vector, dtype=np.float32).astype(float).tolist() for vector in output["dense_vecs"]]
    sparse = [truncate_sparse_vector(vector) for vector in output["lexical_weights"]]
    return dense, sparse


def truncate_sparse_vector(value: dict[Any, Any]) -> dict[str, float]:
    rows = []
    for raw_token_id, raw_weight in (value or {}).items():
        token_id = int(raw_token_id)
        weight = float(raw_weight)
        if token_id < 0 or not math.isfinite(weight) or weight < SPARSE_MIN_WEIGHT:
            continue
        rows.append((token_id, weight))
    rows.sort(key=lambda item: (-item[1], item[0]))
    return {str(token_id): weight for token_id, weight in rows[:SPARSE_MAX_TERMS]}


def compute_rerank(query: str, documents: list[str]) -> list[float]:
    scores: list[float] = []
    for start in range(0, len(documents), RERANK_BATCH_SIZE):
        batch = documents[start:start + RERANK_BATCH_SIZE]
        raw = reranker_model.compute_score(
            [[query, document] for document in batch],
            batch_size=min(RERANK_BATCH_SIZE, len(batch)),
            max_length=RERANK_MAX_LENGTH,
            normalize=True,
        )
        values = raw if isinstance(raw, list) else [raw]
        scores.extend(float(value) for value in values)
    return scores


def run_gpu_operation(callback):
    try:
        with torch.inference_mode():
            return callback()
    except RuntimeError as error:
        if "out of memory" in str(error).lower():
            metrics["oom_count"] += 1
            torch.cuda.empty_cache()
            metrics["empty_cache_count"] += 1
            raise HTTPException(status_code=503, detail="retrieval GPU out of memory") from error
        raise
    finally:
        maybe_empty_cache()


def maybe_empty_cache() -> None:
    if not torch.cuda.is_available():
        return
    reserved = int(torch.cuda.memory_reserved())
    allocated = int(torch.cuda.memory_allocated())
    if reserved - allocated > EMPTY_CACHE_THRESHOLD_BYTES:
        torch.cuda.empty_cache()
        metrics["empty_cache_count"] += 1


def read_gpu_memory() -> dict[str, int]:
    if not torch.cuda.is_available():
        return {"allocated": 0, "reserved": 0, "peak_allocated": 0, "free": 0, "total": 0}
    free, total = torch.cuda.mem_get_info()
    return {
        "allocated": int(torch.cuda.memory_allocated()),
        "reserved": int(torch.cuda.memory_reserved()),
        "peak_allocated": int(torch.cuda.max_memory_allocated()),
        "free": int(free),
        "total": int(total),
    }


def normalize_inputs(value: str | list[str]) -> list[str]:
    rows = [value] if isinstance(value, str) else value
    if not isinstance(rows, list) or not rows or len(rows) > 64 or any(not isinstance(item, str) or not item.strip() for item in rows):
        raise HTTPException(status_code=400, detail="input must contain 1 to 64 non-empty strings")
    return [item.strip() for item in rows]


def fit_dimension(vector: list[float], dimension: int) -> list[float]:
    if dimension <= 0 or len(vector) == dimension:
        return vector
    if len(vector) > dimension:
        return vector[:dimension]
    return vector + [0.0] * (dimension - len(vector))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.getenv("RETRIEVAL_HOST", "0.0.0.0"), port=int(os.getenv("RETRIEVAL_PORT", "8000")))
