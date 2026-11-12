"""
Stage a live operations scene for demos and screenshots (development only):
riders online around their home stores, a handful of fresh cash-on-delivery orders in the dispatch
queue, and one delivery already on the road. Orders go through the real HTTP API (quote → place),
so pricing, stock and the state machine are exactly what a shopper would get.

    uv run python manage.py demo_ops            # 4 queued orders + 1 en route
    uv run python manage.py demo_ops --orders 6
"""
from __future__ import annotations

import random
import uuid

from django.core.management.base import BaseCommand, CommandError

from .simulate_rider import Command as Simulator

# Real neighbourhoods around Dar es Salaam stores (lat, lng, area)
DROPS = [
    (-6.7712, 39.2399, "Mikocheni"), (-6.7553, 39.2677, "Mbezi Beach"), (-6.8160, 39.2803, "Upanga"), (-6.7924, 39.2083, "Sinza"),
    (-6.7484, 39.2276, "Mwenge"), (-6.8235, 39.2695, "City Centre"), (-6.7838, 39.2496, "Msasani"), (-6.7680, 39.2190, "Makumbusho"),
]


class Command(BaseCommand):
    help = "Development: put riders online and fill the dispatch queue with real orders."

    def add_arguments(self, p):
        p.add_argument("--api", default="http://localhost:4000")
        p.add_argument("--orders", type=int, default=4)

    def handle(self, *a, **o):
        from django.conf import settings

        from accounts.models import AuthIdentity, User
        from catalog.models import ProductVariant
        from delivery.models import DeliveryJob, Rider
        from delivery.services import dispatch

        if not settings.DEBUG:
            raise CommandError("demo_ops is for development only.")
        sim = Simulator()
        sim.api = o["api"].rstrip("/")
        sim.stdout = self.stdout

        riders = list(Rider.objects.filter(status="ACTIVE").select_related("home_store", "user"))
        if not riders:
            raise CommandError("No active riders — run the seed first.")
        rnd = random.Random(7)
        for r in riders:
            s = r.home_store
            lat, lng = s.location.y + rnd.uniform(-0.006, 0.006), s.location.x + rnd.uniform(-0.006, 0.006)
            if r.presence == "OFFLINE":
                dispatch.go_online(r, lat, lng)
            dispatch.update_location(r, lat=lat, lng=lng, heading=rnd.uniform(0, 360), speed=4.0, accuracy=8)
            self.stdout.write(f"  {r.user.name} online near {s.name}")

        cust, _ = User.objects.get_or_create(phone="+255713000999", defaults={"name": "Neema Kweka"})
        if not cust.phone_verified_at:
            from django.utils import timezone

            cust.phone_verified_at = timezone.now()
            cust.save(update_fields=["phone_verified_at"])
        AuthIdentity.objects.get_or_create(provider="phone", subject=cust.phone, defaults={"user": cust})
        c = sim._session(cust, "demo-ops")
        placed = []
        for i in range(o["orders"] + 1):
            lat, lng, area = DROPS[i % len(DROPS)]
            v = ProductVariant.objects.filter(product__status="PUBLISHED", inventory__on_hand__gt=3).order_by("?").first()
            if not v:
                raise CommandError("No in-stock product — run the seed first.")
            sim._ok(c.post("/v1/cart/items", json={"variantId": str(v.id), "qty": rnd.choice([1, 1, 2])}))
            q = sim._ok(c.post("/v1/checkout/quote", json={"lat": lat, "lng": lng}))
            if not q.get("canPlace"):
                raise CommandError(f"Checkout blocked: {q.get('problems')}")
            order = sim._ok(c.post("/v1/orders", json={"lat": lat, "lng": lng, "deliveryOptionId": q["selectedOptionId"], "expectedTotal": q["cart"]["total"], "paymentMethod": "CASH_ON_DELIVERY", "landmarkNote": f"Gate near {area} junction"},
                                   headers={"Idempotency-Key": str(uuid.uuid4())}))
            # No geocoder without a Maps key in dev — label the drop-off with its neighbourhood.
            from commerce.models import Order

            Order.objects.filter(id=order["id"], destination_area="").update(destination_area=area, destination_label=f"{area}, Dar es Salaam")
            placed.append(order)
            self.stdout.write(f"  order {order['number']} → {area}")

        # The last one is already on the road with the first rider.
        job = DeliveryJob.objects.select_related("order").get(order_id=placed[-1]["id"])
        r = riders[0]
        from accounts.models import AdminUser

        dispatch.manual_assign(job, r, admin=AdminUser.objects.order_by("created_at").first())
        for step in ("AT_STORE", "PICKED_UP", "EN_ROUTE"):
            job.refresh_from_db()
            dispatch.advance(job, step, actor="admin")
        mid = ((job.pickup.y + job.dropoff.y) / 2, (job.pickup.x + job.dropoff.x) / 2)
        dispatch.update_location(r, lat=mid[0], lng=mid[1], heading=dispatch_bearing(job), speed=7.5, accuracy=6)
        self.stdout.write(self.style.SUCCESS(f"Ready: {len(placed) - 1} orders waiting, {placed[-1]['number']} on the way with {r.user.name}."))


def dispatch_bearing(job) -> float:
    import math

    a, b = job.pickup, job.dropoff
    y = math.sin(math.radians(b.x - a.x)) * math.cos(math.radians(b.y))
    x = math.cos(math.radians(a.y)) * math.sin(math.radians(b.y)) - math.sin(math.radians(a.y)) * math.cos(math.radians(b.y)) * math.cos(math.radians(b.x - a.x))
    return (math.degrees(math.atan2(y, x)) + 360) % 360
