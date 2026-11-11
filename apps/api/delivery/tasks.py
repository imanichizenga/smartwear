from __future__ import annotations

from celery import shared_task


@shared_task(acks_late=True)
def run_dispatch_round(job_id: str) -> dict:
    from .services.dispatch import run_round

    return run_round(job_id)


@shared_task(acks_late=True)
def expire_offers(job_id: str, offer_ids: list[int]) -> None:
    from .services.dispatch import expire

    expire(job_id, offer_ids)


@shared_task
def dispatch_waiting_jobs() -> int:
    from .models import DeliveryJob
    from .services.dispatch import run_round

    n = 0
    for jid in DeliveryJob.objects.filter(status="SEARCHING").values_list("id", flat=True)[:50]:
        run_round(str(jid))
        n += 1
    return n


@shared_task
def dispatch_watchdog() -> dict:
    from .services.dispatch import watchdog

    return watchdog()


@shared_task
def prune_location_pings(days: int = 90) -> int:
    from datetime import timedelta

    from django.utils import timezone

    from .models import RiderLocationPing

    return RiderLocationPing.objects.filter(recorded_at__lt=timezone.now() - timedelta(days=days), job__isnull=True).delete()[0]
