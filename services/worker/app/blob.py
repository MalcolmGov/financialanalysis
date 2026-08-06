"""Blob I/O. fs backend (dev/tests) writes under ARTIFACTS_DIR; vercel backend
uploads to the private Blob REST API. The worker only ever receives single-use
short-TTL signed URLs for source PDFs — never a store-wide token for reads."""
from __future__ import annotations

import os
from pathlib import Path

import httpx

from .config import settings


def _fs_path(blob_path: str) -> Path:
    root = Path(settings().artifacts_dir)
    return root / blob_path


def put_private(blob_path: str, body: bytes, content_type: str) -> dict:
    if settings().blob_backend == "fs":
        dest = _fs_path(blob_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
        return {"blob_path": blob_path, "bytes": len(body)}
    # Vercel Blob REST upload (private store).
    token = settings().blob_token
    resp = httpx.put(
        f"https://blob.vercel-storage.com/{blob_path}",
        content=body,
        headers={
            "authorization": f"Bearer {token}",
            "x-content-type": content_type,
            "x-add-random-suffix": "0",
        },
        timeout=60,
    )
    resp.raise_for_status()
    return {"blob_path": blob_path, "bytes": len(body)}


def fetch_source(signed_url: str) -> bytes:
    """Download the source PDF from a single-use signed URL (or file:// in dev)."""
    if signed_url.startswith("file://"):
        return Path(signed_url[len("file://") :]).read_bytes()
    resp = httpx.get(signed_url, timeout=120, follow_redirects=True)
    resp.raise_for_status()
    return resp.content
