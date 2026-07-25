#!/usr/bin/env python3
"""OpenAI-compatible local endpoint for the official MinerU VLM on AMD ROCm."""

import base64
import io
import os
import time
import uuid
from contextlib import asynccontextmanager
from threading import Lock

os.environ.setdefault("HSA_ENABLE_DXG_DETECTION", "1")

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image
from transformers import AutoProcessor, Qwen2VLForConditionalGeneration


MODEL_NAME = os.getenv("MINERU_VL_MODEL_NAME", "opendatalab/MinerU2.5-Pro-2605-1.2B")
MODEL_PATH = os.getenv("MINERU_VL_MODEL_PATH", MODEL_NAME)
model = None
processor = None
generation_lock = Lock()


class ChatRequest(BaseModel):
    model: str
    messages: list[dict]
    max_tokens: int | None = None
    max_completion_tokens: int | None = None


def load_model():
    global model, processor
    if model is not None:
        return
    if not torch.cuda.is_available():
        raise RuntimeError("ROCm GPU is unavailable; check HSA_ENABLE_DXG_DETECTION=1")
    processor = AutoProcessor.from_pretrained(MODEL_PATH, use_fast=True)
    model = Qwen2VLForConditionalGeneration.from_pretrained(
        MODEL_PATH,
        torch_dtype=torch.bfloat16,
        attn_implementation="sdpa",
    ).to("cuda").eval()


def decode_image(url: str) -> Image.Image:
    if not url.startswith("data:image/") or "," not in url:
        raise ValueError("Only data:image URLs are accepted by the local MinerU VLM")
    encoded = url.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB")


def to_model_messages(messages: list[dict]) -> tuple[list[dict], list[Image.Image]]:
    converted = []
    images = []
    for message in messages:
        content = message.get("content", "")
        if isinstance(content, str):
            converted.append({"role": message.get("role", "user"), "content": content})
            continue
        if not isinstance(content, list):
            raise ValueError("Message content must be text or a content list")
        parts = []
        for part in content:
            kind = part.get("type")
            if kind == "text":
                parts.append({"type": "text", "text": str(part.get("text", ""))})
            elif kind == "image_url":
                image = decode_image(str((part.get("image_url") or {}).get("url", "")))
                images.append(image)
                parts.append({"type": "image", "image": image})
            else:
                raise ValueError(f"Unsupported message content type: {kind}")
        converted.append({"role": message.get("role", "user"), "content": parts})
    return converted, images


def generate(request: ChatRequest) -> str:
    if request.model != MODEL_NAME:
        raise ValueError(f"Unknown model: {request.model}")
    messages, images = to_model_messages(request.messages)
    prompt = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(text=[prompt], images=images or None, padding=True, return_tensors="pt")
    inputs = inputs.to(model.device)
    maximum = request.max_completion_tokens or request.max_tokens or 4096
    output_ids = model.generate(**inputs, use_cache=True, do_sample=False, max_new_tokens=min(maximum, 16384))
    generated_ids = [ids[len(input_ids):] for input_ids, ids in zip(inputs.input_ids, output_ids)]
    return processor.batch_decode(generated_ids, skip_special_tokens=False, clean_up_tokenization_spaces=False)[0]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_model()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "healthy", "model": MODEL_NAME, "device": torch.cuda.get_device_name(0)}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": MODEL_NAME, "object": "model"}]}


@app.post("/v1/chat/completions")
def chat_completions(request: ChatRequest):
    try:
        with generation_lock:
            content = generate(request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": MODEL_NAME,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
    }
