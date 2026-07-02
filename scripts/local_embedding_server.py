import os
import time
from typing import Any

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer


MODEL_NAME = os.getenv("LOCAL_EMBEDDING_MODEL", "BAAI/bge-m3")
CACHE_DIR = os.getenv("LOCAL_EMBEDDING_CACHE_DIR", "data/models/huggingface")
DIMENSION = int(os.getenv("LOCAL_EMBEDDING_DIMENSION", "1024"))
BATCH_SIZE = int(os.getenv("LOCAL_EMBEDDING_BATCH_SIZE", "8"))
MAX_SEQ_LENGTH = int(os.getenv("LOCAL_EMBEDDING_MAX_SEQ_LENGTH", "8192"))
DEVICE = os.getenv("LOCAL_EMBEDDING_DEVICE", "auto")
QUERY_PROMPT = os.getenv("LOCAL_EMBEDDING_QUERY_PROMPT", "")

app = FastAPI(title="Local BGE-M3 Embedding Server", version="1.0.0")
model: SentenceTransformer | None = None


class EmbeddingRequest(BaseModel):
    model: str | None = None
    input: str | list[str]
    input_type: str | None = None
    dimensions: int | None = None


def resolve_device() -> str:
    if DEVICE and DEVICE != "auto":
        return DEVICE
    return "cuda" if torch.cuda.is_available() else "cpu"


def get_model() -> SentenceTransformer:
    global model
    if model is None:
        os.makedirs(CACHE_DIR, exist_ok=True)
        loaded = SentenceTransformer(
            MODEL_NAME,
            cache_folder=CACHE_DIR,
            trust_remote_code=True,
            device=resolve_device(),
        )
        loaded.max_seq_length = MAX_SEQ_LENGTH
        model = loaded
    return model


def normalize_inputs(value: str | list[str]) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return value
    raise HTTPException(status_code=400, detail="input must be a string or an array of strings")


def fit_dimension(vector: np.ndarray, dimension: int) -> list[float]:
    if dimension <= 0:
        return vector.astype(float).tolist()
    if vector.shape[0] > dimension:
        vector = vector[:dimension]
    elif vector.shape[0] < dimension:
        vector = np.pad(vector, (0, dimension - vector.shape[0]))
    return vector.astype(float).tolist()


def encode_texts(texts: list[str], input_type: str | None, dimension: int) -> list[list[float]]:
    encoder = get_model()
    encode_kwargs: dict[str, Any] = {
        "batch_size": BATCH_SIZE,
        "normalize_embeddings": True,
        "convert_to_numpy": True,
        "show_progress_bar": False,
    }
    if input_type == "query" and QUERY_PROMPT:
        prompted = [f"{QUERY_PROMPT}{text}" for text in texts]
        embeddings = encoder.encode(prompted, **encode_kwargs)
    else:
        embeddings = encoder.encode(texts, **encode_kwargs)
    return [fit_dimension(np.asarray(item), dimension) for item in embeddings]


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "model": MODEL_NAME,
        "dimension": DIMENSION,
        "device": resolve_device(),
        "loaded": model is not None,
    }


@app.post("/v1/embeddings")
def create_embeddings(payload: EmbeddingRequest) -> dict[str, Any]:
    started = time.time()
    texts = normalize_inputs(payload.input)
    if not texts:
        raise HTTPException(status_code=400, detail="input cannot be empty")
    dimension = payload.dimensions or DIMENSION
    embeddings = encode_texts(texts, payload.input_type, dimension)
    return {
        "object": "list",
        "model": payload.model or MODEL_NAME,
        "data": [
            {
                "object": "embedding",
                "index": index,
                "embedding": embedding,
            }
            for index, embedding in enumerate(embeddings)
        ],
        "usage": {
            "prompt_tokens": sum(len(text) for text in texts),
            "total_tokens": sum(len(text) for text in texts),
            "elapsed_ms": int((time.time() - started) * 1000),
        },
    }


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("LOCAL_EMBEDDING_HOST", "127.0.0.1")
    port = int(os.getenv("LOCAL_EMBEDDING_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
