"""Lazy env config. Nothing is asserted at import — the API and tests run
without real credentials (QUEUE_BACKEND=memory, BLOB_BACKEND=fs)."""
from __future__ import annotations

import os
from functools import lru_cache


class Settings:
    @property
    def service_token(self) -> str:
        return os.environ.get("WORKER_SERVICE_TOKEN", "")

    @property
    def webhook_hmac_key(self) -> str:
        return os.environ.get("WEBHOOK_HMAC_KEY", "")

    @property
    def database_url(self) -> str:
        return os.environ.get("DATABASE_URL", "")

    @property
    def blob_token(self) -> str:
        return os.environ.get("BLOB_READ_WRITE_TOKEN", "")

    @property
    def queue_backend(self) -> str:
        # memory | postgres
        return os.environ.get("QUEUE_BACKEND", "memory")

    @property
    def blob_backend(self) -> str:
        # fs | vercel
        return os.environ.get("BLOB_BACKEND", "fs")

    @property
    def artifacts_dir(self) -> str:
        return os.environ.get("ARTIFACTS_DIR", ".artifacts")

    @property
    def max_pages(self) -> int:
        return int(os.environ.get("MAX_PAGES", "250"))


@lru_cache
def settings() -> Settings:
    return Settings()
