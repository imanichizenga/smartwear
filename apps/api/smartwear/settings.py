from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

from . import env as E

BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = E.NODE_ENV == "development"
# Django's SECRET_KEY is only used for signing framework internals (not our tokens); derive it from the master key.
SECRET_KEY = "sw-" + E.MASTER_ENCRYPTION_KEY.split(",")[0]
ALLOWED_HOSTS = ["*"]
CSRF_TRUSTED_ORIGINS = E.ADMIN_ORIGINS

INSTALLED_APPS = [
    "daphne",
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.gis",
    "django.contrib.postgres",
    "rest_framework",
    "drf_spectacular",
    "corsheaders",
    "django_filters",
    "django_celery_beat",
    "channels",
    "core",
    "accounts",
    "catalog",
    "inventory",
    "media",
    "commerce",
    "delivery",
    "marketing",
    "notifications",
]

MIDDLEWARE = [
    "core.middleware.RequestIdMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
    "core.middleware.LocaleMiddleware",
]

ROOT_URLCONF = "smartwear.urls"
ASGI_APPLICATION = "smartwear.asgi.application"
WSGI_APPLICATION = "smartwear.wsgi.application"
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "DIRS": [BASE_DIR / "templates"], "APP_DIRS": True, "OPTIONS": {"context_processors": []}}]

_db = urlparse(E.DATABASE_URL)
DATABASES = {
    "default": {
        "ENGINE": "django.contrib.gis.db.backends.postgis",
        "NAME": _db.path.lstrip("/"),
        "USER": _db.username,
        "PASSWORD": _db.password,
        "HOST": _db.hostname,
        "PORT": _db.port or 5432,
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": {"options": "-c search_path=public"},
    }
}
# GDAL 3.8 on Ubuntu 24.04; we never parse untrusted spatial references (points come from validated floats).
SILENCED_SYSTEM_CHECKS = ["gis.W001"]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.AdminUser"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.Argon2PasswordHasher"]
AUTH_PASSWORD_VALIDATORS = [{"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}}]

CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": E.REDIS_URL, "KEY_PREFIX": "sw"}}
CHANNEL_LAYERS = {"default": {"BACKEND": "channels_redis.core.RedisChannelLayer", "CONFIG": {"hosts": [E.REDIS_URL], "prefix": "sw:ch"}}}

CELERY_BROKER_URL = E.REDIS_URL
CELERY_RESULT_BACKEND = E.REDIS_URL
CELERY_TASK_DEFAULT_QUEUE = "scheduled"
CELERY_TASK_ROUTES = {
    "media.tasks.*": {"queue": "media"},
    "notifications.tasks.*": {"queue": "notifications"},
    "delivery.tasks.*": {"queue": "dispatch"},
    "core.tasks.sms_*": {"queue": "sms"},
}
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_TIME_LIMIT = 15 * 60
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"
CELERY_TIMEZONE = "UTC"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["accounts.authentication.BearerJWTAuthentication", "accounts.authentication.AdminCookieAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "EXCEPTION_HANDLER": "core.exceptions.exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
}
SPECTACULAR_SETTINGS = {"TITLE": "SmartWear API", "DESCRIPTION": "Fashion & beauty commerce — customers, riders, admin.", "VERSION": "1.0.0", "SERVE_INCLUDE_SCHEMA": False, "COMPONENT_SPLIT_REQUEST": True}

CORS_ALLOWED_ORIGINS = E.ADMIN_ORIGINS
CORS_ALLOWED_ORIGIN_REGEXES = [r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$"]
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = ["content-type", "authorization", "x-device-id", "x-requested-with", "x-request-id", "if-none-match", "idempotency-key", "accept-language"]
CORS_EXPOSE_HEADERS = ["ETag", "X-Request-Id"]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

LANGUAGE_CODE = "en"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {"staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"}}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"()": "core.logging.JsonFormatter"}, "pretty": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s", "datefmt": "%H:%M:%S"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "pretty" if DEBUG else "json"}},
    "root": {"handlers": ["console"], "level": E.LOG_LEVEL},
    "loggers": {"django.request": {"level": "WARNING"}, "django.db.backends": {"level": "WARNING"}},
}

PUBLIC_API_URL = E.PUBLIC_API_URL
ADMIN_ORIGINS = E.ADMIN_ORIGINS
MASTER_ENCRYPTION_KEY = E.MASTER_ENCRYPTION_KEY
REDIS_URL = E.REDIS_URL
