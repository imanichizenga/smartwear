from __future__ import annotations

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import AdminPerm, IsAppUser
from catalog.models import Collection, Product
from catalog.services.viewer import locale_of, request_user
from core import settings_service
from core.audit import audit
from core.exceptions import ApiError
from core.media_urls import media_out
from core.pagination import keyset, page_params

from .models import SECTION_TYPES, Banner, Campaign, CampaignDelivery, DropSubscription, HomeSection, Look, LookProductTag, LookReaction, Story, StoryItem, StoryView
from .services import banner_out, look_out, render_home, story_out


class HomeView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            from core import settings_service as ss

            ss.redis_client().pfadd(f"sw:metrics:sessions:{timezone.localtime():%Y%m%d}", request.headers.get("X-Device-Id") or (request.META.get("REMOTE_ADDR") or ""))
        except Exception:  # noqa: BLE001
            pass
        resp = Response(render_home(request_user(request), locale_of(request)))
        resp["Cache-Control"] = "private, max-age=30"
        return resp


class LooksFeedView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        if not settings_service.get("features").looksFeed:
            raise ApiError.not_found("Looks")
        cursor, limit = page_params(request, 8, 20)
        # Only looks whose media finished processing — a look without a playable image/video is never shown.
        qs = Look.objects.filter(published=True, media__status="READY", media__deleted_at__isnull=True).select_related("media")
        if request.query_params.get("department"):
            qs = qs.filter(department__in=[request.query_params["department"], ""])
        rows, nxt = keyset(qs, ["-published_at", "-id"], cursor, limit)
        user = request_user(request)
        reactions = set(LookReaction.objects.filter(user=user, look__in=rows).values_list("look_id", "kind")) if user else set()
        return Response({"items": [look_out(lk, user, locale_of(request), reactions=reactions) for lk in rows], "nextCursor": nxt})


class LookReactView(APIView):
    permission_classes = [IsAppUser]

    @transaction.atomic
    def post(self, request, lid, kind: str):
        if kind not in ("like", "save"):
            raise ApiError.bad_request("like or save")
        lk = Look.objects.select_for_update().filter(id=lid, published=True).first()
        if lk is None:
            raise ApiError.not_found("Look")
        field = "likes_count" if kind == "like" else "saves_count"
        on = request.data.get("on", True)
        if on:
            try:
                with transaction.atomic():
                    LookReaction.objects.create(look=lk, user=request.user.user, kind=kind)
                Look.objects.filter(pk=lk.pk).update(**{field: F(field) + 1})
            except IntegrityError:
                pass
            if kind == "save" and request.data.get("saveProducts", True):
                from commerce.views import _default_board
                from commerce.models import WishlistItem

                board = _default_board(request.user.user)
                for t in lk.tags.all():
                    WishlistItem.objects.get_or_create(board=board, product_id=t.product_id)
        else:
            if LookReaction.objects.filter(look=lk, user=request.user.user, kind=kind).delete()[0]:
                Look.objects.filter(pk=lk.pk, **{f"{field}__gt": 0}).update(**{field: F(field) - 1})
        lk.refresh_from_db()
        return Response({"likes": lk.likes_count, "saves": lk.saves_count, "on": bool(on)})


class LookEventView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, lid, event: str):
        field = {"view": "views_count", "share": "shares_count"}.get(event)
        if field is None:
            raise ApiError.bad_request("view or share")
        Look.objects.filter(id=lid).update(**{field: F(field) + 1})
        return Response({"ok": True})


class StoriesView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        from .services import _live

        user = request_user(request)
        seen = set(StoryView.objects.filter(user=user).values_list("story_id", flat=True)) if user else set()
        rows = _live(Story.objects.filter(is_active=True)).select_related("cover", "brand").prefetch_related("items__media").order_by("sort_order")
        return Response({"items": sorted([story_out(s, s.id in seen) for s in rows], key=lambda x: x["seen"])})


class StorySeenView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request, sid):
        StoryView.objects.update_or_create(story_id=sid, user=request.user.user)
        return Response({"ok": True})


class DropNotifyView(APIView):
    """'Notify me' for a real upcoming drop."""

    permission_classes = [IsAppUser]

    def post(self, request, cid):
        c = Collection.objects.filter(id=cid, published=True, is_drop=True, launches_at__gt=timezone.now()).first()
        if c is None:
            raise ApiError.bad_request("This drop is already live or doesn't exist")
        DropSubscription.objects.get_or_create(collection=c, user=request.user.user)
        return Response({"subscribed": True})

    def delete(self, request, cid):
        DropSubscription.objects.filter(collection_id=cid, user=request.user.user).delete()
        return Response({"subscribed": False})


# ================================================================ admin
def section_admin_out(s: HomeSection) -> dict:
    return {"id": str(s.id), "type": s.type, "title": s.title, "titleSw": s.title_sw or None, "subtitle": s.subtitle or None, "config": s.config, "sortOrder": s.sort_order, "isActive": s.is_active, "startsAt": s.starts_at.isoformat() if s.starts_at else None, "endsAt": s.ends_at.isoformat() if s.ends_at else None, "segment": s.segment}


class AdminHomeSectionsView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    def get(self, request):
        return Response({"items": [section_admin_out(s) for s in HomeSection.objects.order_by("sort_order")], "types": [{"key": k, "label": v} for k, v in SECTION_TYPES]})

    def post(self, request):
        s = HomeSection(sort_order=(HomeSection.objects.count() + 1) * 10)
        _apply_section(s, request.data or {})
        audit("home.section.create", "home_section", s.id, request=request, after=section_admin_out(s))
        return Response(section_admin_out(s), status=201)


class AdminHomeSectionView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    def patch(self, request, sid):
        s = HomeSection.objects.filter(id=sid).first()
        if s is None:
            raise ApiError.not_found("Section")
        _apply_section(s, request.data or {})
        audit("home.section.update", "home_section", s.id, request=request, after=section_admin_out(s))
        return Response(section_admin_out(s))

    def delete(self, request, sid):
        HomeSection.objects.filter(id=sid).delete()
        return Response({"ok": True})


def _apply_section(s: HomeSection, d: dict) -> None:
    if "type" in d or not s.type:
        if d.get("type") not in dict(SECTION_TYPES):
            raise ApiError.bad_request("Unknown section type")
        s.type = d["type"]
    for k, f in (("title", "title"), ("titleSw", "title_sw"), ("subtitle", "subtitle"), ("config", "config"), ("isActive", "is_active"), ("segment", "segment")):
        if k in d:
            setattr(s, f, d[k] if d[k] is not None else ("" if f in ("title", "title_sw", "subtitle") else {}))
    for k, f in (("startsAt", "starts_at"), ("endsAt", "ends_at")):
        if k in d:
            setattr(s, f, parse_datetime(d[k]) if d[k] else None)
    if s.starts_at and s.ends_at and s.ends_at <= s.starts_at:
        raise ApiError.bad_request("End must be after start")
    s.save()


class AdminHomeReorderView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    def post(self, request):
        for i, sid in enumerate(request.data.get("ids") or []):
            HomeSection.objects.filter(id=sid).update(sort_order=(i + 1) * 10)
        return Response({"ok": True})


class AdminHomePreviewView(APIView):
    """Preview the Home feed as a segment (retail/wholesale, departments, signed in) inside the phone frame."""

    permission_classes = [AdminPerm("marketing.manage")]

    def post(self, request):
        d = request.data or {}
        prof = {"signedIn": bool(d.get("signedIn", True)), "customerType": d.get("customerType", "RETAIL"), "departments": d.get("departments") or []}
        return Response(render_home(None, d.get("locale", "en"), profile=prof))


def _story_admin_out(s: Story) -> dict:
    return story_out(s) | {"brandId": str(s.brand_id) if s.brand_id else None, "isActive": s.is_active, "sortOrder": s.sort_order, "startsAt": s.starts_at.isoformat() if s.starts_at else None, "endsAt": s.ends_at.isoformat() if s.ends_at else None, "views": s.views.count()}


class AdminStoriesView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    def get(self, request):
        return Response({"items": [_story_admin_out(s) for s in Story.objects.select_related("cover", "brand").prefetch_related("items__media").order_by("sort_order")]})

    @transaction.atomic
    def post(self, request):
        s = Story()
        _apply_story(s, request.data or {})
        return Response(_story_admin_out(s), status=201)


class AdminStoryView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    @transaction.atomic
    def patch(self, request, sid):
        s = Story.objects.filter(id=sid).first()
        if s is None:
            raise ApiError.not_found("Story")
        _apply_story(s, request.data or {})
        return Response(_story_admin_out(s))

    def delete(self, request, sid):
        Story.objects.filter(id=sid).delete()
        return Response({"ok": True})


def _apply_story(s: Story, d: dict) -> None:
    if "title" in d or not s.title:
        if not (d.get("title") or "").strip():
            raise ApiError.bad_request("Give the story a short title")
        s.title = d["title"].strip()[:40]
    for k, f in (("kind", "kind"), ("coverMediaId", "cover_id"), ("brandId", "brand_id"), ("isActive", "is_active"), ("sortOrder", "sort_order")):
        if k in d:
            setattr(s, f, d[k])
    for k, f in (("startsAt", "starts_at"), ("endsAt", "ends_at")):
        if k in d:
            setattr(s, f, parse_datetime(d[k]) if d[k] else None)
    if not s.cover_id:
        raise ApiError.bad_request("Choose a cover image")
    s.save()
    if "items" in d:
        StoryItem.objects.filter(story=s).delete()
        StoryItem.objects.bulk_create([StoryItem(story=s, media_id=i["mediaId"], caption=(i.get("caption") or "")[:160], duration_ms=int(i.get("durationMs") or 5000), link=i.get("link") or {}, sort_order=n) for n, i in enumerate(d["items"])])


class AdminBannersView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    def get(self, request):
        return Response({"items": [banner_out(b) | {"isActive": b.is_active, "sortOrder": b.sort_order, "startsAt": b.starts_at.isoformat() if b.starts_at else None, "endsAt": b.ends_at.isoformat() if b.ends_at else None} for b in Banner.objects.select_related("media").order_by("sort_order")]})

    def post(self, request):
        b = Banner()
        _apply_banner(b, request.data or {})
        return Response(banner_out(b), status=201)


class AdminBannerView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    def patch(self, request, bid):
        b = Banner.objects.filter(id=bid).first()
        if b is None:
            raise ApiError.not_found("Banner")
        _apply_banner(b, request.data or {})
        return Response(banner_out(b))

    def delete(self, request, bid):
        Banner.objects.filter(id=bid).delete()
        return Response({"ok": True})


def _apply_banner(b: Banner, d: dict) -> None:
    for k, f in (("title", "title"), ("titleSw", "title_sw"), ("subtitle", "subtitle"), ("eyebrow", "eyebrow"), ("mediaId", "media_id"), ("link", "link"), ("ctaLabel", "cta_label"), ("theme", "theme"), ("isActive", "is_active"), ("sortOrder", "sort_order")):
        if k in d:
            setattr(b, f, d[k] if d[k] is not None else "")
    for k, f in (("startsAt", "starts_at"), ("endsAt", "ends_at")):
        if k in d:
            setattr(b, f, parse_datetime(d[k]) if d[k] else None)
    if not b.title or not b.media_id:
        raise ApiError.bad_request("A banner needs a title and an image or video")
    link = b.link or {}
    if link.get("type") not in ("collection", "category", "product", "brand", "look", "url", "products"):
        raise ApiError.bad_request("Choose where the banner links to")
    b.save()


def _look_admin_out(lk: Look) -> dict:
    return {"id": str(lk.id), "media": media_out(lk.media), "caption": lk.caption, "captionSw": lk.caption_sw or None, "credit": lk.credit or None, "department": lk.department or None, "published": lk.published, "publishedAt": lk.published_at.isoformat() if lk.published_at else None,
            "stats": {"likes": lk.likes_count, "saves": lk.saves_count, "shares": lk.shares_count, "views": lk.views_count},
            "tags": [{"productId": str(t.product_id), "title": t.product.title, "x": t.x, "y": t.y} for t in lk.tags.select_related("product")]}


class AdminLooksView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    def get(self, request):
        return Response({"items": [_look_admin_out(lk) for lk in Look.objects.select_related("media").order_by("-created_at")[:300]]})

    @transaction.atomic
    def post(self, request):
        lk = Look()
        _apply_look(lk, request.data or {})
        return Response(_look_admin_out(lk), status=201)


class AdminLookView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    @transaction.atomic
    def patch(self, request, lid):
        lk = Look.objects.filter(id=lid).first()
        if lk is None:
            raise ApiError.not_found("Look")
        _apply_look(lk, request.data or {})
        return Response(_look_admin_out(lk))

    def delete(self, request, lid):
        Look.objects.filter(id=lid).delete()
        return Response({"ok": True})


def _apply_look(lk: Look, d: dict) -> None:
    for k, f in (("mediaId", "media_id"), ("caption", "caption"), ("captionSw", "caption_sw"), ("credit", "credit"), ("department", "department"), ("brandId", "brand_id")):
        if k in d:
            setattr(lk, f, d[k] if d[k] is not None else "")
    if "published" in d:
        lk.published = bool(d["published"])
        if lk.published and not lk.published_at:
            lk.published_at = timezone.now()
    if not lk.media_id:
        raise ApiError.bad_request("Choose a video or image")
    lk.save()
    if "tags" in d:
        LookProductTag.objects.filter(look=lk).delete()
        valid = set(str(x) for x in Product.objects.filter(id__in=[t["productId"] for t in d["tags"]]).values_list("id", flat=True))
        LookProductTag.objects.bulk_create([LookProductTag(look=lk, product_id=t["productId"], x=min(1, max(0, float(t["x"]))), y=min(1, max(0, float(t["y"]))), sort_order=i) for i, t in enumerate(d["tags"]) if str(t["productId"]) in valid])
    if lk.published and not lk.tags.exists():
        raise ApiError.bad_request("Tag at least one product so the look is shoppable")


def _link_route(link: dict | None) -> str | None:
    if not link:
        return None
    ident = link.get("slug") or link.get("id")
    t = link.get("type")
    if not ident:
        return link.get("url")
    return {"product": f"/p/{ident}", "collection": f"/collection/{ident}", "category": f"/c/{ident}", "brand": f"/c/all?brand={ident}", "look": f"/discover?look={ident}"}.get(t)


def campaign_route(c: Campaign) -> str:
    """Where a tap on the push (or its inbox entry) lands in the app."""
    ids = c.product_ids or []
    if len(ids) == 1:
        p = Product.objects.filter(id=ids[0]).only("slug").first()
        if p:
            return f"/p/{p.slug}"
    if len(ids) > 1:
        return f"/campaign/{c.id}"
    return _link_route(c.link) or f"/campaign/{c.id}"


def _campaign_media(c: Campaign):
    if c.image_id:
        return c.image
    from catalog.models import ProductMedia

    if not c.product_ids:
        return None
    pm = ProductMedia.objects.filter(product_id=c.product_ids[0], role="gallery", media__type="IMAGE", media__status="READY").select_related("media").order_by("sort_order", "id").first()
    return pm.media if pm else None


def campaign_image_url(c: Campaign) -> str | None:
    """Rich-notification picture: a ~1 MB-safe JPEG rendition (FCM/APNs fetch it when the push arrives)."""
    m = _campaign_media(c)
    if m is None:
        return None
    from media.storage import public_url

    jpegs = sorted([v for v in m.variants or [] if v.get("format") == "jpeg" and v.get("label") != "master"], key=lambda v: v.get("width") or 0)
    pick = next((v for v in jpegs if (v.get("width") or 0) >= 640), jpegs[-1] if jpegs else None)
    return public_url(pick["key"]) if pick else None


def campaign_stats(c: Campaign) -> dict:
    s = dict(c.stats or {})
    if c.channel == "push" and c.status in ("SENDING", "SENT"):
        from django.db.models import Count, Q, Sum

        agg = CampaignDelivery.objects.filter(campaign=c).aggregate(recipients=Count("id"), delivered=Count("id", filter=Q(delivered=True)), opened=Count("id", filter=Q(opened_at__isnull=False)), fromPush=Count("id", filter=Q(open_source="push")), fromInbox=Count("id", filter=Q(open_source="inbox")), totalOpens=Sum("opens"))
        delivered = agg["delivered"] or 0
        s.update({"recipients": agg["recipients"], "delivered": delivered, "failed": (agg["recipients"] or 0) - delivered, "opened": agg["opened"], "openedFromPush": agg["fromPush"], "openedFromInbox": agg["fromInbox"], "totalOpens": agg["totalOpens"] or 0,
                  "openRate": round(100 * agg["opened"] / delivered, 1) if delivered else 0.0, "anonymousOpens": int(s.get("anonymousOpens", 0))})
    return s


def campaign_out(c: Campaign, *, products: bool = False) -> dict:
    out = {"id": str(c.id), "channel": c.channel, "name": c.name, "title": c.title or None, "body": c.body, "bodySw": c.body_sw or None, "link": c.link, "audience": c.audience,
           "scheduledAt": c.scheduled_at.isoformat() if c.scheduled_at else None, "status": c.status, "sentAt": c.sent_at.isoformat() if c.sent_at else None, "createdAt": c.created_at.isoformat(),
           "stats": campaign_stats(c), "productIds": [str(x) for x in c.product_ids or []], "image": media_out(c.image) if c.image_id else None, "route": campaign_route(c) if c.channel == "push" else None}
    if products and c.product_ids:
        rows = {str(p.id): p for p in Product.objects.filter(id__in=c.product_ids)}
        from catalog.models import ProductMedia

        covers = {}
        for pm in ProductMedia.objects.filter(product_id__in=c.product_ids, role="gallery", media__type="IMAGE").select_related("media").order_by("sort_order", "id"):
            covers.setdefault(str(pm.product_id), pm.media)
        out["products"] = [{"id": i, "title": rows[i].title, "slug": rows[i].slug, "status": rows[i].status, "cover": media_out(covers.get(i))} for i in out["productIds"] if i in rows]
    return out


def _clean_product_ids(raw) -> list[str]:
    import uuid as _uuid

    ids: list[str] = []
    for x in (raw or [])[:50]:
        try:
            ids.append(str(_uuid.UUID(str(x))))
        except ValueError:
            continue
    found = set(str(i) for i in Product.objects.filter(id__in=ids, deleted_at__isnull=True).values_list("id", flat=True))
    return [i for i in dict.fromkeys(ids) if i in found]


class AdminCampaignsView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    def get(self, request):
        return Response({"items": [campaign_out(c, products=True) for c in Campaign.objects.order_by("-created_at")[:200]]})

    def post(self, request):
        from .campaigns import audience_queryset

        d = request.data or {}
        if d.get("channel") not in ("push", "sms"):
            raise ApiError.bad_request("channel must be push or sms")
        if not (d.get("body") or "").strip():
            raise ApiError.bad_request("Write the message")
        if d["channel"] == "sms" and len(d["body"]) > 459:
            raise ApiError.bad_request("SMS campaigns are limited to 3 messages (459 characters)")
        product_ids = _clean_product_ids(d.get("productIds")) if d["channel"] == "push" else []
        if d.get("productIds") and d["channel"] == "push" and not product_ids:
            raise ApiError.bad_request("Those products were not found", field="productIds")
        image_id = d.get("imageMediaId") or None
        if image_id:
            from media.models import Media

            if not Media.objects.filter(id=image_id, type="IMAGE", deleted_at__isnull=True).exists():
                raise ApiError.bad_request("Picture not found", field="imageMediaId")
        c = Campaign.objects.create(channel=d["channel"], name=(d.get("name") or "Campaign")[:80], title=(d.get("title") or "")[:80], body=d["body"][:480], body_sw=(d.get("bodySw") or "")[:480], link=d.get("link") or {}, audience=d.get("audience") or {}, scheduled_at=parse_datetime(d["scheduledAt"]) if d.get("scheduledAt") else None, created_by=request.user.admin, product_ids=product_ids, image_id=image_id)
        c.stats = {"audience": audience_queryset(c.audience, c.channel).count()}
        c.save(update_fields=["stats"])
        return Response(campaign_out(c, products=True), status=201)


class AdminCampaignEstimateView(APIView):
    """Live reach for the composer: how many people the audience matches right now (opt-outs excluded)."""

    permission_classes = [AdminPerm("marketing.manage")]

    def post(self, request):
        from .campaigns import audience_queryset

        d = request.data or {}
        channel = d.get("channel") if d.get("channel") in ("push", "sms") else "push"
        return Response({"audience": audience_queryset(d.get("audience") or {}, channel).count()})


class AdminCampaignView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    def post(self, request, cid, action: str):
        from .campaigns import audience_queryset
        from .tasks import send_campaign

        c = Campaign.objects.filter(id=cid).first()
        if c is None:
            raise ApiError.not_found("Campaign")
        if action == "estimate":
            return Response({"audience": audience_queryset(c.audience, c.channel).count()})
        if action == "test":
            # Sends the push to one customer (by phone) without counting it — check text, picture and the tap.
            from accounts.models import User
            from notifications.models import PushToken
            from notifications.push import send

            phone = (request.data or {}).get("phone") or ""
            digits = "".join(ch for ch in phone if ch.isdigit())
            u = User.objects.filter(phone__endswith=digits[-9:]).first() if len(digits) >= 9 else None
            if u is None:
                raise ApiError.bad_request("No customer with that phone number", field="phone")
            tokens = list(PushToken.objects.filter(user=u, disabled_at__isnull=True))
            if not tokens:
                raise ApiError.bad_request("That customer has no device registered for notifications (they need the app, signed in, notifications allowed)", field="phone")
            res = send(tokens, c.title or "SmartWear", c.body_sw if u.locale == "sw" and c.body_sw else c.body, {"type": "campaign", "campaignId": str(c.id), "route": campaign_route(c), "test": "1"}, channel="marketing", image=campaign_image_url(c))
            return Response({"devices": len(tokens), "delivered": res["ok"], "errors": res["errors"]})
        if action == "send":
            if c.status not in ("DRAFT", "SCHEDULED"):
                raise ApiError.conflict("sent", "This campaign was already sent")
            if c.scheduled_at and c.scheduled_at > timezone.now():
                c.status = "SCHEDULED"
                c.save(update_fields=["status"])
                send_campaign.apply_async((str(c.id),), eta=c.scheduled_at)
            else:
                c.status = "SENDING"
                c.save(update_fields=["status"])
                send_campaign.delay(str(c.id))
            audit("campaign.send", "campaign", c.id, request=request, meta={"channel": c.channel})
            return Response(campaign_out(c, products=True))
        if action == "cancel" and c.status in ("DRAFT", "SCHEDULED"):
            c.status = "CANCELLED"
            c.save(update_fields=["status"])
            return Response(campaign_out(c))
        raise ApiError.bad_request("Unknown action")


class AdminCampaignReportView(APIView):
    """`GET /admin/campaigns/<id>/report` — delivery funnel, opens over time and the latest people who opened."""

    permission_classes = [AdminPerm("marketing.manage")]

    def get(self, request, cid):
        from django.db.models import Count
        from django.db.models.functions import TruncHour

        c = Campaign.objects.filter(id=cid).first()
        if c is None:
            raise ApiError.not_found("Campaign")
        qs = CampaignDelivery.objects.filter(campaign=c)
        timeline = [{"at": r["h"].isoformat(), "opens": r["n"]} for r in qs.filter(opened_at__isnull=False).annotate(h=TruncHour("opened_at")).values("h").annotate(n=Count("id")).order_by("h")]
        latest = [{"name": d.user.display_name or d.user.name or "", "phone": d.user.phone, "openedAt": d.opened_at.isoformat(), "source": d.open_source, "platform": d.open_platform, "opens": d.opens}
                  for d in qs.filter(opened_at__isnull=False).select_related("user").order_by("-opened_at")[:50]]
        errors = list(qs.filter(delivered=False).exclude(error="").values("error").annotate(n=Count("id")).order_by("-n")[:5])
        return Response({"campaign": campaign_out(c, products=True), "timeline": timeline, "latestOpens": latest, "deliveryErrors": [{"error": e["error"], "count": e["n"]} for e in errors]})


class CampaignPublicView(APIView):
    """`GET /v1/campaigns/<id>` — the in-app campaign page (message + featured products)."""

    permission_classes = [AllowAny]

    def get(self, request, cid):
        from catalog.services.products import card_queryset, cards
        from catalog.services.viewer import context_for_user

        c = Campaign.objects.filter(id=cid, channel="push", status__in=("SENDING", "SENT")).first()
        if c is None:
            raise ApiError.not_found("Campaign")
        user = request_user(request)
        loc = locale_of(request)
        order = {pid: i for i, pid in enumerate(c.product_ids or [])}
        prods = sorted(card_queryset(Product.objects.filter(id__in=c.product_ids or [], status="PUBLISHED", deleted_at__isnull=True)), key=lambda p: order.get(str(p.id), 999))
        m = _campaign_media(c)
        return Response({"id": str(c.id), "title": c.title or "SmartWear", "body": c.body_sw if loc == "sw" and c.body_sw else c.body, "image": media_out(m) if m else None, "sentAt": c.sent_at.isoformat() if c.sent_at else None,
                         "products": cards(prods, context_for_user(user), user=user, locale=loc)})


class CampaignOpenedView(APIView):
    """`POST /v1/campaigns/<id>/opened {source: push|inbox, platform}` — counts an open (unique per person + total)."""

    permission_classes = [AllowAny]

    def post(self, request, cid):
        d = request.data or {}
        source = d.get("source") if d.get("source") in ("push", "inbox") else "push"
        platform = (d.get("platform") or "")[:8]
        user = request_user(request)
        c = Campaign.objects.filter(id=cid).only("id", "stats").first()
        if c is None:
            raise ApiError.not_found("Campaign")
        if user is None:
            # Signed out since it was sent: still an open, just not attributable to a person.
            Campaign.objects.filter(id=c.id).update(stats={**(c.stats or {}), "anonymousOpens": int((c.stats or {}).get("anonymousOpens", 0)) + 1})
            return Response({"ok": True})
        now = timezone.now()
        n = CampaignDelivery.objects.filter(campaign_id=c.id, user=user, opened_at__isnull=True).update(opened_at=now, open_source=source, open_platform=platform, opens=F("opens") + 1)
        if not n:
            CampaignDelivery.objects.filter(campaign_id=c.id, user=user).update(opens=F("opens") + 1)
        try:
            from notifications.realtime import broadcast

            broadcast("admin.campaigns", {"type": "campaign.opened", "campaignId": str(c.id)})
        except Exception:  # noqa: BLE001
            pass
        return Response({"ok": True})
