"""Re-transcode existing videos into the streaming ladder (360p/540p/+720p/1080p, 2 s GOP, adaptive HLS).

    python manage.py reprocess_videos            # videos that don't have the HLS ladder yet (queued on `media`)
    python manage.py reprocess_videos --all      # every READY video
    python manage.py reprocess_videos --now      # run here, one by one, instead of queueing
"""
from django.core.management.base import BaseCommand

from media.models import Media


class Command(BaseCommand):
    help = "Re-transcode videos into the adaptive streaming ladder"

    def add_arguments(self, p):
        p.add_argument("--all", action="store_true")
        p.add_argument("--now", action="store_true")

    def handle(self, *args, **o):
        from media.tasks import process_media

        qs = Media.objects.filter(type="VIDEO", status="READY", deleted_at__isnull=True).order_by("created_at")
        todo = [m for m in qs if o["all"] or not any(str(v.get("label", "")).startswith("hls-") for v in m.variants or [])]
        self.stdout.write(f"{len(todo)} video(s) to transcode")
        for m in todo:
            if o["now"]:
                from media.pipeline import process

                try:
                    process(str(m.id))
                    self.stdout.write(f"  ✓ {m.id}")
                except Exception as e:  # noqa: BLE001
                    self.stdout.write(f"  ✗ {m.id}: {e}")
            else:
                process_media.delay(str(m.id))
        if not o["now"]:
            self.stdout.write("queued on the media worker")
