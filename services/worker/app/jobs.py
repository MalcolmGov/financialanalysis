"""Durable job queue. Postgres backend uses FOR UPDATE SKIP LOCKED with a
heartbeat + orphan sweeper; memory backend runs the same lifecycle in-process
for dev/tests without a database."""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from .config import settings


@dataclass
class Job:
    job_id: str
    submit: dict
    status: str = "queued"
    progress: dict = field(default_factory=lambda: {"pages_done": 0, "total_pages": None})
    result_pointer: Optional[dict] = None
    error: Optional[dict] = None
    attempts: int = 0
    heartbeat_at: Optional[float] = None
    ocr_applied: Optional[bool] = None
    timings_ms: dict = field(default_factory=dict)


class MemoryQueue:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def submit(self, job_id: str, submit: dict) -> Job:
        with self._lock:
            existing = self._jobs.get(job_id)
            if existing:
                return existing  # idempotent on job_id
            job = Job(job_id=job_id, submit=submit)
            self._jobs[job_id] = job
            return job

    def get(self, job_id: str) -> Optional[Job]:
        return self._jobs.get(job_id)

    def claim_next(self) -> Optional[Job]:
        with self._lock:
            for job in self._jobs.values():
                if job.status == "queued":
                    job.status = "fetching"
                    job.attempts += 1
                    job.heartbeat_at = time.time()
                    return job
        return None

    def update(self, job: Job) -> None:
        job.heartbeat_at = time.time()

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job and job.status in ("queued", "fetching", "converting"):
                job.status = "cancelled"
                return True
        return False

    def sweep_orphans(self, stale_seconds: int = 300) -> int:
        now = time.time()
        requeued = 0
        with self._lock:
            for job in self._jobs.values():
                running = job.status in ("fetching", "converting", "postprocessing", "uploading_assets")
                if running and job.heartbeat_at and now - job.heartbeat_at > stale_seconds:
                    job.status = "queued"
                    requeued += 1
        return requeued


class PostgresQueue:
    """Shared extraction_jobs table with SKIP LOCKED. Imported lazily so psycopg
    is only required when QUEUE_BACKEND=postgres."""

    def __init__(self, dsn: str) -> None:
        import psycopg  # noqa: F401

        self.dsn = dsn

    def _conn(self):
        import psycopg

        return psycopg.connect(self.dsn, autocommit=True)

    def submit(self, job_id: str, submit: dict) -> Job:
        import json

        with self._conn() as conn:
            conn.execute(
                """INSERT INTO extraction_jobs (job_id, org_id, project_id, submit, status)
                   VALUES (%s, %s, %s, %s, 'queued')
                   ON CONFLICT (job_id) DO NOTHING""",
                (job_id, submit["org_id"], submit["project_id"], json.dumps(submit)),
            )
        return Job(job_id=job_id, submit=submit)

    def get(self, job_id: str) -> Optional[Job]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT status, progress, result_pointer, error, attempts FROM extraction_jobs WHERE job_id=%s",
                (job_id,),
            ).fetchone()
        if not row:
            return None
        j = Job(job_id=job_id, submit={})
        j.status, j.progress, j.result_pointer, j.error, j.attempts = (
            row[0],
            row[1] or j.progress,
            row[2],
            row[3],
            row[4] or 0,
        )
        return j

    def claim_next(self) -> Optional[Job]:
        with self._conn() as conn:
            row = conn.execute(
                """UPDATE extraction_jobs SET status='fetching',
                       attempts=attempts+1, heartbeat_at=now(), updated_at=now()
                   WHERE job_id = (
                     SELECT job_id FROM extraction_jobs WHERE status='queued'
                     ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
                   RETURNING job_id, submit""",
            ).fetchone()
        if not row:
            return None
        return Job(job_id=row[0], submit=row[1], status="fetching")

    def update(self, job: Job) -> None:
        import json

        with self._conn() as conn:
            conn.execute(
                """UPDATE extraction_jobs SET status=%s, progress=%s, result_pointer=%s,
                       error=%s, heartbeat_at=now(), updated_at=now() WHERE job_id=%s""",
                (
                    job.status,
                    json.dumps(job.progress),
                    json.dumps(job.result_pointer) if job.result_pointer else None,
                    json.dumps(job.error) if job.error else None,
                    job.job_id,
                ),
            )

    def cancel(self, job_id: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE extraction_jobs SET status='cancelled', updated_at=now() "
                "WHERE job_id=%s AND status IN ('queued','fetching','converting') RETURNING job_id",
                (job_id,),
            )
            return cur.fetchone() is not None

    def sweep_orphans(self, stale_seconds: int = 300) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                """UPDATE extraction_jobs SET status='queued', updated_at=now()
                   WHERE status IN ('fetching','converting','postprocessing','uploading_assets')
                     AND heartbeat_at < now() - (%s || ' seconds')::interval RETURNING job_id""",
                (str(stale_seconds),),
            )
            return len(cur.fetchall())


_queue: Any = None


def queue() -> Any:
    global _queue
    if _queue is None:
        if settings().queue_backend == "postgres":
            _queue = PostgresQueue(settings().database_url)
        else:
            _queue = MemoryQueue()
    return _queue


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
