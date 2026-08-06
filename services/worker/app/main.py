"""FastAPI extraction service. Bearer-authed service-to-service API plus a
background worker loop that drains the job queue. Docling is imported only
inside the worker loop, so the API surface (and tests) load without it."""
from __future__ import annotations

import hashlib
import json
import threading
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .blob import fetch_source, put_private
from .config import settings
from .jobs import Job, now_iso, queue
from .webhook import send_webhook

_worker_thread: Optional[threading.Thread] = None
_stop = threading.Event()
_models_warm = False


def require_token(request: Request) -> None:
    expected = settings().service_token
    if not expected:
        return  # dev: no token configured => open (never in production)
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="unauthorized")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _worker_thread
    _stop.clear()
    _worker_thread = threading.Thread(target=_worker_loop, daemon=True)
    _worker_thread.start()
    yield
    _stop.set()


app = FastAPI(title="Results Studio — Extraction Worker", lifespan=lifespan)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "models_warm": _models_warm, "queue": settings().queue_backend}


@app.post("/v1/extractions", status_code=202)
def submit_extraction(submit: dict, _auth: None = Depends(require_token)) -> dict:
    job_id = submit.get("job_id")
    if not job_id:
        raise HTTPException(status_code=400, detail="job_id required")
    job = queue().submit(job_id, submit)
    return {"job_id": job.job_id, "status": job.status}


@app.get("/v1/extractions/{job_id}")
def get_extraction(job_id: str, _auth: None = Depends(require_token)) -> dict:
    job = queue().get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="not found")
    return {
        "schema_version": "1.0",
        "job_id": job.job_id,
        "status": job.status,
        "progress": job.progress,
        "ocr_applied": job.ocr_applied,
        "timings_ms": job.timings_ms,
        "error": job.error,
    }


@app.get("/v1/extractions/{job_id}/result")
def get_result(job_id: str, _auth: None = Depends(require_token)) -> dict:
    job = queue().get(job_id)
    if not job or not job.result_pointer:
        raise HTTPException(status_code=404, detail="no result")
    return job.result_pointer


@app.delete("/v1/extractions/{job_id}")
def cancel_extraction(job_id: str, _auth: None = Depends(require_token)) -> dict:
    return {"cancelled": queue().cancel(job_id)}


# Step-3 endpoints land in a later phase; the surface is stable now.
@app.post("/probe")
def probe(_auth: None = Depends(require_token)) -> JSONResponse:
    return JSONResponse({"detail": "design-DNA probe not implemented"}, status_code=501)


@app.post("/render")
def render(_auth: None = Depends(require_token)) -> JSONResponse:
    return JSONResponse({"detail": "prototype render not implemented"}, status_code=501)


def _worker_loop() -> None:
    """Drain the queue. One job at a time keeps memory bounded; scale via
    multiple worker processes, not threads (Docling is CPU-heavy)."""
    while not _stop.is_set():
        q = queue()
        q.sweep_orphans()
        job = q.claim_next()
        if job is None:
            time.sleep(1.0)
            continue
        try:
            _process(job)
        except Exception as exc:  # noqa: BLE001
            job.status = "failed"
            job.error = {"code": "EXTRACTION_FAILED", "message": str(exc)}
            q.update(job)
            _notify(job)


def _process(job: Job) -> None:
    global _models_warm
    q = queue()
    submit = job.submit
    t0 = time.time()

    job.status = "fetching"
    q.update(job)
    pdf_bytes = fetch_source(submit["source"]["signed_url"])

    # Checksum guard.
    digest = hashlib.sha256(pdf_bytes).hexdigest()
    if digest != submit["source"]["sha256"]:
        job.status = "failed"
        job.error = {"code": "CHECKSUM_MISMATCH", "message": "source hash mismatch"}
        q.update(job)
        _notify(job)
        return

    job.status = "converting"
    q.update(job)

    from .extract import extract_document  # lazy: pulls docling/torch

    _models_warm = True
    prefix = submit["output_prefix"]
    source_meta = {
        "blob_path": submit["source"]["blob_path"],
        "sha256": digest,
        "size_bytes": submit["source"]["size_bytes"],
        "page_count": 0,
        "pdf_meta": {"title": "", "producer": "", "created": "", "modified": ""},
    }

    def on_progress(done: int, total: int) -> None:
        job.progress = {"pages_done": done, "total_pages": total}
        q.update(job)

    result = extract_document(
        pdf_bytes=pdf_bytes,
        extraction_id=submit["job_id"],
        org_id=submit["org_id"],
        project_id=submit["project_id"],
        output_prefix=prefix,
        source_meta=source_meta,
        put_asset=put_private,
        force_ocr=submit.get("options", {}).get("ocr") == "force",
        on_progress=on_progress,
    )
    result["source"]["page_count"] = len(result["pages"])
    job.ocr_applied = result["engine"]["ocr_applied"]

    job.status = "uploading_assets"
    q.update(job)
    extraction_body = json.dumps(result).encode()
    extraction_path = f"{prefix}extraction.json"
    put_private(extraction_path, extraction_body, "application/json")
    manifest = {"extraction_json_bytes": len(extraction_body), "sha256": hashlib.sha256(extraction_body).hexdigest()}
    manifest_path = f"{prefix}manifest.json"
    put_private(manifest_path, json.dumps(manifest).encode(), "application/json")

    job.result_pointer = {
        "schema_version": "1.0",
        "job_id": job.job_id,
        "extraction_json_path": extraction_path,
        "manifest_path": manifest_path,
        "stats": {
            "pages": len(result["pages"]),
            "tables": len(result["tables"]),
            "figures": len(result["figures"]),
            "blocks": len(result["body"]),
            "extraction_json_bytes": len(extraction_body),
            "warnings": len(result["warnings"]),
        },
    }
    job.status = "succeeded"
    job.timings_ms["total"] = int((time.time() - t0) * 1000)
    q.update(job)
    _notify(job)


def _notify(job: Job) -> None:
    hook = job.submit.get("webhook") if job.submit else None
    if not hook or not hook.get("url"):
        return
    send_webhook(
        hook["url"],
        {
            "schema_version": "1.0",
            "job_id": job.job_id,
            "status": "succeeded" if job.status == "succeeded" else "failed",
            "result_pointer": job.result_pointer,
            "error": job.error,
            "attempt": job.attempts,
            "sent_at": now_iso(),
        },
    )
