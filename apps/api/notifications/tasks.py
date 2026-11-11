from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger("smartwear.notify")


@shared_task(bind=True, max_retries=3, default_retry_delay=20, acks_late=True)
def deliver_push(self, user_id: str, title: str, body: str, data: dict, notification_id: str | None = None, channel: str = "default") -> dict:
    from accounts.models import User

    from .models import Notification
    from .push import send_to_user

    user = User.objects.filter(id=user_id).first()
    if user is None:
        return {"sent": 0}
    try:
        res = send_to_user(user, title, body, data, channel=channel, sound="job.wav" if channel == "jobs" else "default")
    except Exception as e:  # noqa: BLE001
        raise self.retry(exc=e) from e
    if notification_id and res.get("ok"):
        Notification.objects.filter(id=notification_id).update(pushed_at=timezone.now())
    return res


@shared_task(bind=True, max_retries=3, default_retry_delay=30, acks_late=True)
def deliver_sms(self, phone: str, text: str) -> dict:
    from core.exceptions import ApiError
    from core.integrations.beem import BeemClient

    client = BeemClient()
    if not client.configured:
        logger.info("SMS skipped: Beem not configured")
        return {"ok": False, "reason": "not_configured"}
    try:
        r = client.send_sms([phone], text)
    except ApiError as e:
        if e.code == "upstream_error":
            raise self.retry(exc=e) from e
        return {"ok": False, "reason": e.message}
    return {"ok": r.ok, "requestId": r.request_id}
