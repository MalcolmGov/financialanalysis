"""API surface tests via TestClient. QUEUE_BACKEND=memory + BLOB_BACKEND=fs, no
docling required (extraction runs in a background thread and we only assert the
submit/status/auth contract, not a full conversion)."""
import os

os.environ.setdefault("QUEUE_BACKEND", "memory")
os.environ.setdefault("BLOB_BACKEND", "fs")
# Tests that omit a bearer token rely on the explicit local-dev escape hatch.
os.environ.setdefault("ALLOW_INSECURE_WORKER", "1")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def test_healthz_ok():
    with TestClient(app) as client:
        r = client.get("/healthz")
        assert r.status_code == 200
        assert r.json()["ok"] is True


def test_submit_requires_bearer_when_token_set(monkeypatch):
    monkeypatch.setenv("WORKER_SERVICE_TOKEN", "secret")
    # config is cached; clear it so the token takes effect.
    from app.config import settings

    settings.cache_clear()
    try:
        with TestClient(app) as client:
            r = client.post("/v1/extractions", json={"job_id": "x"})
            assert r.status_code == 401
            r2 = client.post(
                "/v1/extractions",
                json={"job_id": "x", "org_id": "o", "project_id": "p"},
                headers={"authorization": "Bearer secret"},
            )
            assert r2.status_code == 202
    finally:
        settings.cache_clear()


def test_submit_is_idempotent_and_status_reflects_lifecycle():
    with TestClient(app) as client:
        job = {"job_id": "job-abc", "org_id": "o", "project_id": "p"}
        r1 = client.post("/v1/extractions", json=job)
        assert r1.status_code == 202
        r2 = client.post("/v1/extractions", json=job)  # idempotent
        assert r2.status_code == 202
        s = client.get("/v1/extractions/job-abc")
        assert s.status_code == 200
        assert s.json()["job_id"] == "job-abc"


def test_missing_job_id_rejected():
    with TestClient(app) as client:
        r = client.post("/v1/extractions", json={"org_id": "o"})
        assert r.status_code == 400


def test_probe_wired_validates_input_and_render_still_stubbed():
    with TestClient(app) as client:
        # /probe is implemented — rejects a body with no source URL (400),
        # rather than the old 501.
        assert client.post("/probe", json={}).status_code == 400
        # /render lands in a later phase.
        assert client.post("/render").status_code == 501


def test_unknown_job_404():
    with TestClient(app) as client:
        assert client.get("/v1/extractions/nope").status_code == 404
