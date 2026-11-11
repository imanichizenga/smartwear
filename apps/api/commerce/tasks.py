from __future__ import annotations

from datetime import timedelta

from celery import shared_task
from django.utils import timezone


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
