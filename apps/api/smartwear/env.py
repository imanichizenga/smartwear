"""
The ONLY environment variables the backend reads. Everything else lives in the database (Admin → Settings).
Loads the nearest `.env` walking up from the project directory (the monorepo root holds the single `.env`).
"""
from __future__ import annotations

import os
from pathlib import Path


def _load_dotenv() -> None:
    here = Path(__file__).resolve().parent
    for d in [here, *here.parents][:6]:
        p = d / ".env"
        if p.exists():
            for line in p.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            return


_load_dotenv()


def env(name: str, default: str | None = None, *, required: bool = False) -> str:
    v = os.environ.get(name, default)
    if required and not v:
        raise RuntimeError(f"Missing required environment variable {name}")
    return v or ""


DATABASE_URL = env("DATABASE_URL", required=True)
REDIS_URL = env("REDIS_URL", "redis://localhost:6379")
MASTER_ENCRYPTION_KEY = env("MASTER_ENCRYPTION_KEY", required=True)
NODE_ENV = env("NODE_ENV", "development")
ADMIN_ORIGINS = [o.strip() for o in env("ADMIN_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
PUBLIC_API_URL = env("PUBLIC_API_URL", "http://localhost:4000")
LOG_LEVEL = env("LOG_LEVEL", "INFO").upper()
