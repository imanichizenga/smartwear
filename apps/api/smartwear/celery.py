import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "smartwear.settings")
app = Celery("smartwear")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

app.conf.beat_schedule = {
    "dispatch-watchdog": {"task": "delivery.tasks.dispatch_watchdog", "schedule": 30.0},
    "publish-scheduled": {"task": "catalog.tasks.publish_scheduled", "schedule": 60.0},
    "apply-scheduled-prices": {"task": "catalog.tasks.apply_scheduled_prices", "schedule": 60.0},
    "drops-live": {"task": "marketing.tasks.notify_live_drops", "schedule": 60.0},
    "wishlist-price-drops": {"task": "marketing.tasks.wishlist_price_drops", "schedule": crontab(minute=15, hour="*/3")},
    "media-orphans": {"task": "media.tasks.cleanup_orphans", "schedule": crontab(minute=40, hour="*/6")},
    "category-counts": {"task": "catalog.tasks.refresh_category_counts", "schedule": crontab(minute="*/15")},
    "prune-pings": {"task": "delivery.tasks.prune_location_pings", "schedule": crontab(minute=5, hour=3)},
    "abandoned-payments": {"task": "commerce.tasks.expire_unpaid_orders", "schedule": 300.0},
}
