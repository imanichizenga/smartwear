# SmartWear worker

The worker runs **Celery** from the Django codebase in `apps/api` (see `docs/DECISIONS.md`), so there is no separate source tree here — only process definitions.

| Process | Command | Queues |
|---|---|---|
| Worker | `pnpm worker` → `celery -A smartwear worker -Q celery,media,notifications,dispatch,scheduled,sms` | media pipeline (sharp-equivalent libvips + ffmpeg), push/SMS, dispatch timers |
| Scheduler | `pnpm worker:beat` → `celery -A smartwear beat` (django-celery-beat) | scheduled publish/unpublish, orphan-upload cleanup, document-expiry alerts |

In Docker both use the `apps/api/Dockerfile` image with a different command (see `docker-compose.yml`). Scale the worker horizontally; run exactly **one** beat.
