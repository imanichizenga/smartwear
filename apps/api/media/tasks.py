from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger("smartwear.media")


@shared_task(bind=True, autoretry_for=(ConnectionError,), retry_backoff=True, max_retries=3, acks_late=True)
def process_media(self, media_id: str) -> str:
    from .pipeline import PipelineError, process

    try:
        m = process(media_id)
        return m.status
    except PipelineError as e:
        return f"FAILED: {e}"


@shared_task
def purge_media(media_id: str) -> int:
    from . import storage
    from .models import Media

    m = Media.objects.filter(id=media_id).first()
    if m is None:
        return 0
    keys = [m.original_key] + [v["key"] for v in m.variants or []]
    try:
        storage.delete(keys)
    except Exception as e:  # noqa: BLE001
        logger.warning("purge %s failed: %s", media_id, e)
        return 0
    m.delete()
    return len(keys)


@shared_task
def cleanup_orphans() -> dict:
    """Uploads that never completed, and unused media deleted by admins, after `media.orphanCleanupHours`."""
    from core import settings_service

    from . import storage
    from .models import Media

    hours = settings_service.get("media").orphanCleanupHours
    cutoff = timezone.now() - timedelta(hours=hours)
    stale = list(Media.objects.filter(status="UPLOADING", created_at__lt=cutoff)[:500])
    for m in stale:
        if m.multipart_upload_id:
            storage.abort_multipart(m.original_key, m.multipart_upload_id)
        try:
            storage.delete([m.original_key])
        except Exception:  # noqa: BLE001
            pass
        m.delete()
    deleted = 0
    for m in Media.objects.filter(deleted_at__lt=cutoff)[:500]:
        deleted += purge_media(str(m.id))
    return {"abandoned": len(stale), "purgedKeys": deleted}
