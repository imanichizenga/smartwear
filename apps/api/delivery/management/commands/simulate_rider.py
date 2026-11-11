"""
`pnpm simulate:rider` — a test rider that goes online, accepts a job and drives it to the customer.

Everything goes through the public HTTP API (exactly what Rider Mode in the app calls), so the
customer's live map, push notifications, admin Dispatch Control Room and ETA logic all see a real rider.

  --api URL          API base (default http://localhost:4000)
  --phone +255…      which seeded rider to drive (default the first)
  --demo-order       also place a cash-on-delivery order as a demo customer, so there is a job to take
  --speed 3.0        playback speed (1.0 = real time at ~25 km/h)
  --loop             keep taking jobs until Ctrl+C

The route comes from Google Routes when Maps is configured (Admin → Settings → Google Maps); otherwise
the rider follows a gently curved estimate between the points, and says so.

Dev-only: the simulator mints the rider's session directly (no SMS), so it refuses to run unless
NODE_ENV=development or --i-know-this-is-not-production is passed.
"""
from __future__ import annotations

import math
import os
import time
import uuid

import httpx
from django.core.management.base import BaseCommand, CommandError

from core.integrations import google_maps


def decode_polyline(s: str) -> list[tuple[float, float]]:
    """Google encoded polyline → [(lat, lng)]."""
    pts, i, lat, lng = [], 0, 0, 0
    while i < len(s):
        for which in (0, 1):
            shift = result = 0
            while True:
                b = ord(s[i]) - 63
                i += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            d = ~(result >> 1) if result & 1 else result >> 1
            if which == 0:
                lat += d
            else:
                lng += d
        pts.append((lat / 1e5, lng / 1e5))
    return pts


def curved(a: tuple[float, float], b: tuple[float, float], n: int = 40) -> list[tuple[float, float]]:
    """A soft arc between two points — reads as a road on the map, never as a teleport."""
    (y1, x1), (y2, x2) = a, b
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    dx, dy = x2 - x1, y2 - y1
    cx, cy = mx - dy * 0.18, my + dx * 0.18
    out = []
    for k in range(n + 1):
        t = k / n
        out.append(((1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t**2 * y2, (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t**2 * x2))
    return out


def bearing(a, b) -> float:
    y1, x1, y2, x2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    yv = math.sin(x2 - x1) * math.cos(y2)
    xv = math.cos(y1) * math.sin(y2) - math.sin(y1) * math.cos(y2) * math.cos(x2 - x1)
    return (math.degrees(math.atan2(yv, xv)) + 360) % 360


class Command(BaseCommand):
    help = "Drive a seeded test rider through a real delivery via the API."

    def add_arguments(self, p):
        p.add_argument("--api", default=os.environ.get("SIM_API_URL", "http://localhost:4000"))
        p.add_argument("--phone", default=None)
        p.add_argument("--demo-order", action="store_true")
        p.add_argument("--speed", type=float, default=3.0)
        p.add_argument("--loop", action="store_true")
        p.add_argument("--i-know-this-is-not-production", dest="force", action="store_true")

    # ------------------------------------------------------------------ helpers
    def _session(self, user, device: str) -> httpx.Client:
        from accounts.tokens import start_session

        class Req:
            headers = {"User-Agent": "smartwear-simulator"}
            META = {"REMOTE_ADDR": "127.0.0.1"}
            device_id = device

        tok = start_session(user, Req(), device_id=device)
        return httpx.Client(base_url=self.api, timeout=20, headers={"Authorization": f"Bearer {tok['accessToken']}", "X-Device-Id": device})

    def _ok(self, r: httpx.Response) -> dict:
        if r.status_code >= 400:
            try:
                msg = r.json().get("message")
            except ValueError:
                msg = r.text[:200]
            raise CommandError(f"{r.request.method} {r.request.url.path} → {r.status_code}: {msg}")
        return r.json() if r.content else {}

    def say(self, msg: str) -> None:
        self.stdout.write(f"  {time.strftime('%H:%M:%S')}  {msg}")

    # ------------------------------------------------------------------ entry
    def handle(self, *a, **o):
        from django.conf import settings

        from accounts.models import User
        from catalog.seed.catalog import RIDERS

        if not settings.DEBUG and not o["force"]:
            raise CommandError("The simulator mints sessions without OTP. Run it in development (NODE_ENV=development).")
        self.api, self.speed = o["api"].rstrip("/"), max(0.25, o["speed"])
        phone = o["phone"] or RIDERS[0]["phone"]
        user = User.objects.filter(phone=phone, rider__isnull=False).select_related("rider").first()
        if not user:
            raise CommandError(f"No rider with phone {phone}. Run `pnpm api:seed` first, or register one in Admin → Riders.")
        rider = self._session(user, "sim-rider")
        me = self._ok(rider.get("/v1/rider/me"))
        home = next((s for s in me["stores"] if str(s["id"]) == str(user.rider.home_store_id)), me["stores"][0])
        self.pos = (home["location"]["lat"] + 0.004, home["location"]["lng"] - 0.003)
        self._ok(rider.post("/v1/rider/presence", json={"online": True, "lat": self.pos[0], "lng": self.pos[1]}))
        self.stdout.write(self.style.SUCCESS(f"{user.name} is online near {home['name']} — blue dot at {self.pos[0]:.5f}, {self.pos[1]:.5f}"))
        try:
            while True:
                if o["demo_order"]:
                    self._demo_order(home)
                self._one_job(rider)
                if not o["loop"]:
                    break
        except KeyboardInterrupt:
            pass
        finally:
            try:
                rider.post("/v1/rider/presence", json={"online": False})
                self.say("offline")
            except httpx.HTTPError:
                pass

    def _demo_order(self, store) -> None:
        from accounts.models import AuthIdentity, User
        from catalog.models import ProductVariant

        cust, _ = User.objects.get_or_create(phone="+255713000999", defaults={"name": "Demo Customer"})
        if not cust.phone_verified_at:
            from django.utils import timezone

            cust.phone_verified_at = timezone.now()
            cust.save(update_fields=["phone_verified_at"])
        AuthIdentity.objects.get_or_create(provider="phone", subject=cust.phone, defaults={"user": cust})
        c = self._session(cust, "sim-customer")
        v = ProductVariant.objects.filter(product__status="PUBLISHED", inventory__on_hand__gt=2, inventory__store_id=store["id"]).order_by("?").first()
        if not v:
            raise CommandError("No in-stock product to order — run the seed first.")
        self._ok(c.post("/v1/cart/items", json={"variantId": str(v.id), "qty": 1}))
        drop = (store["location"]["lat"] - 0.018, store["location"]["lng"] - 0.022)
        q = self._ok(c.post("/v1/checkout/quote", json={"lat": drop[0], "lng": drop[1]}))
        if not q.get("canPlace"):
            raise CommandError(f"Checkout blocked: {q.get('problems')}")
        opt = next((x for x in q["options"] if x["kind"] == "standard"), q["options"][0])
        o = self._ok(c.post("/v1/orders", json={"lat": drop[0], "lng": drop[1], "deliveryOptionId": opt["id"], "expectedTotal": q["cart"]["total"] - next(x["fee"] for x in q["options"] if x["id"] == q["selectedOptionId"]) + opt["fee"],
                                                "landmarkNote": "Simulator drop-off"}, headers={"Idempotency-Key": str(uuid.uuid4())}))
        self.say(f"demo order {o['number']} placed for {o['total']:,} {o['currency']} → black dot at {drop[0]:.5f}, {drop[1]:.5f}")

    def _wait_offer(self, rider: httpx.Client) -> dict:
        self.say("waiting for a job offer… (place an order in the app, or pass --demo-order)")
        while True:
            me = self._ok(rider.get("/v1/rider/me"))
            if me.get("activeJob"):
                return {"job": me["activeJob"]}
            if me.get("pendingOffer"):
                return {"offer": me["pendingOffer"]}
            self._ok(rider.post("/v1/rider/location", json={"lat": self.pos[0], "lng": self.pos[1], "battery": 0.8}))
            time.sleep(3)

    def _one_job(self, rider: httpx.Client) -> None:
        from commerce.models import Order
        from commerce.services.orders import reveal_pin

        got = self._wait_offer(rider)
        if "offer" in got:
            off = got["offer"]
            self.say(f"offer #{off['id']} — {off.get('store', {}).get('name', 'store')}, earn {off.get('earning')}")
            time.sleep(min(4, 2 / self.speed))
            job = self._ok(rider.post(f"/v1/rider/offers/{off['id']}/accept", json={}))["job"]
            self.say("accepted")
        else:
            job = got["job"]
            self.say(f"resuming job {job['id']} ({job['status']})")
        jid = job["id"]
        sl, dl = job["store"]["location"], job["dropoff"]["location"]
        pickup, drop = (sl["lat"], sl["lng"]), (dl["lat"], dl["lng"])

        if job["status"] in ("ACCEPTED",):
            self._drive(rider, self.pos, pickup, "to the store")
            job = self._ok(rider.post(f"/v1/rider/jobs/{jid}", json={"step": "AT_STORE", "lat": pickup[0], "lng": pickup[1]}))
            self.say("arrived at store — collecting the order")
            time.sleep(3 / self.speed)
        if job["status"] in ("AT_STORE",):
            job = self._ok(rider.post(f"/v1/rider/jobs/{jid}", json={"step": "PICKED_UP", "scan": f"SWPICK:{job['orderId']}"}))
            self.say("picked up — on the way")
        if job["status"] in ("PICKED_UP", "EN_ROUTE"):
            self._drive(rider, self.pos, drop, "to the customer")
            job = self._ok(rider.post(f"/v1/rider/jobs/{jid}", json={"step": "ARRIVED", "lat": drop[0], "lng": drop[1]}))
            self.say("arrived — asking for the delivery PIN")
            time.sleep(4 / self.speed)
        if job["status"] == "ARRIVED":
            pin = reveal_pin(Order.objects.get(id=job["orderId"]))
            job = self._ok(rider.post(f"/v1/rider/jobs/{jid}", json={"step": "COMPLETED", **({"pin": pin} if pin else {})}))
            self.stdout.write(self.style.SUCCESS(f"  delivered ✓  (PIN {'entered' if pin else 'not required'})"))

    def _drive(self, rider: httpx.Client, a, b, label: str) -> None:
        rt = google_maps.route(a, b)
        path = decode_polyline(rt["polyline"]) if rt.get("polyline") else curved(a, b)
        src = "Google Routes" if rt.get("polyline") else "estimated curve (configure Google Maps for real roads)"
        self.say(f"driving {label}: {rt['distanceMeters'] / 1000:.1f} km via {src}")
        # Resample to ~25 m steps at ~7 m/s (25 km/h) — the app sends every 3–5 s, so does the simulator.
        pts = [path[0]]
        for p0, p1 in zip(path, path[1:], strict=False):
            steps = max(1, math.ceil(google_maps.haversine_m(p0, p1) / 25))
            pts.extend((p0[0] + (p1[0] - p0[0]) * k / steps, p0[1] + (p1[1] - p0[1]) * k / steps) for k in range(1, steps + 1))
        step_s = 25 / 7.0
        for i in range(1, len(pts)):
            hd = bearing(pts[i - 1], pts[i])
            res = self._ok(rider.post("/v1/rider/location", json={"lat": pts[i][0], "lng": pts[i][1], "heading": round(hd, 1), "speed": 7.0, "accuracy": 6, "battery": 0.74}))
            self.pos = pts[i]
            if i % 12 == 0:
                left = google_maps.haversine_m(pts[i], b)
                self.say(f"  {left / 1000:.2f} km to go · next update in {res.get('nextIntervalSeconds', 3)}s")
            time.sleep(step_s / self.speed)
