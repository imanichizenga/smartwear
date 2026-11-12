from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger("smartwear.tasks")

@shared_task
def expire_unpaid_orders(minutes: int = 30) -> int:
    """Mobile-money orders never paid release their stock after `minutes`."""
    from .models import Order
    from .services.orders import transition

    n = 0
    for o in Order.objects.filter(status="PENDING_PAYMENT", placed_at__lt=timezone.now() - timedelta(minutes=minutes)):
        transition(o, "CANCELLED", actor="system", reason="Payment not completed in time")
        n += 1
    return n


@shared_task
def reconcile_snippe_payments() -> int:
    """Pending Snippe payments (≤4h, Snippe's expiry) are re-checked in case a webhook was missed."""
    from .models import Payment
    from .services.payments import sync_snippe

    n = 0
    for p in Payment.objects.filter(provider="snippe", status="PENDING", created_at__gt=timezone.now() - timedelta(hours=4, minutes=10), created_at__lt=timezone.now() - timedelta(minutes=2)).select_related("order")[:100]:
        try:
            sync_snippe(p)
            n += 1
        except Exception:  # noqa: BLE001 - one bad payment must not stop the sweep
            continue
    return n


@shared_task(ignore_result=True)
def reconcile_snippe_payouts() -> int:
    """Pending rider payouts older than 2 minutes are re-checked in case a webhook was missed."""
    from datetime import timedelta

    from delivery.models import RiderPayout
    from delivery.services.payouts import sync

    n = 0
    for p in RiderPayout.objects.filter(method="snippe", status="PENDING", created_at__lt=timezone.now() - timedelta(minutes=2), created_at__gt=timezone.now() - timedelta(days=3)).exclude(provider_ref="")[:100]:
        try:
            sync(p)
            n += 1
        except Exception:  # noqa: BLE001
            logger.exception("payout reconcile failed for %s", p.id)
    return n
