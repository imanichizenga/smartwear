"""Test settings: isolated Redis DB, eager Celery, in-memory channel layer, no pub/sub thread."""
from .settings import *  # noqa: F403
from .settings import REDIS_URL as _BASE_REDIS

_base = _BASE_REDIS.rstrip("/").rsplit("/", 1)[0] if _BASE_REDIS.count("/") > 2 else _BASE_REDIS.rstrip("/")
import os as _os

# Each pytest-xdist worker gets its own Redis DB (gw0 → 15, gw1 → 14, …) so per-test flushes never collide.
_worker = _os.environ.get("PYTEST_XDIST_WORKER", "gw0")
REDIS_URL = f"{_base}/{15 - int(_worker[2:] or 0) % 12}"
CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL, "KEY_PREFIX": "swtest"}}
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
SETTINGS_PUBSUB_DISABLED = True
DEBUG = False
LOGGING = {"version": 1, "disable_existing_loggers": False, "root": {"handlers": [], "level": "CRITICAL"}}
MIDDLEWARE = [m for m in MIDDLEWARE if "whitenoise" not in m]  # noqa: F405
RAISE_UNHANDLED = True
