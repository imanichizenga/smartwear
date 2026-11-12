from __future__ import annotations

from django.db import connection
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import AdminPerm, IsAdmin

from . import settings_service
from .audit import audit
from .exceptions import ApiError
from .integrations.testers import TESTERS, configured_state
from .models import AuditLog, IntegrationStatus
from .pagination import keyset, page_params
from .settings_schema import INTEGRATIONS, SETTINGS_GROUPS


class HealthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        return Response({"ok": True, "service": "smartwear-api", "time": timezone.now().isoformat()})


class ReadyView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        checks = {}
        try:
            with connection.cursor() as c:
                c.execute("SELECT 1")
            checks["database"] = True
        except Exception:  # noqa: BLE001
            checks["database"] = False
        try:
            checks["redis"] = bool(settings_service.redis_client().ping())
        except Exception:  # noqa: BLE001
            checks["redis"] = False
        ok = all(checks.values())
        return Response({"ok": ok, "checks": checks}, status=200 if ok else 503)


class PublicConfigView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        data = settings_service.public_config()
        from catalog.services.categories import nav_tree_version

        data["catalogVersion"] = nav_tree_version()
        resp = Response(data)
        resp["Cache-Control"] = "public, max-age=60, stale-while-revalidate=600"
        return resp


class SettingsGroupsView(APIView):
    permission_classes = [AdminPerm("settings.view")]

    def get(self, request):
        return Response({"groups": sorted(SETTINGS_GROUPS.keys()), "integrations": [i.model_dump() for i in INTEGRATIONS]})


class SettingsGroupView(APIView):
    def get_permissions(self):
        return [AdminPerm("settings.view")()] if self.request.method == "GET" else [AdminPerm("settings.manage")()]

    def get(self, request, group: str):
        return Response(settings_service.admin_view(group))

    def put(self, request, group: str):
        body = request.data or {}
        value = body.get("value", body)
        if not isinstance(value, dict):
            raise ApiError.bad_request("Body must be an object")
        return Response(settings_service.update(group, value, admin=request.user.admin, request=request, expected_version=body.get("version")))


class SettingsRevealView(APIView):
    permission_classes = [AdminPerm("settings.secrets.reveal")]

    def post(self, request, group: str):
        from accounts.admin_auth import require_recent_reauth

        require_recent_reauth(request._request.admin_session)
        path = request.data.get("path") or ""
        return Response({"path": path, "value": settings_service.reveal(group, path, admin=request.user.admin, request=request)})


class SettingsTestView(APIView):
    permission_classes = [AdminPerm("settings.manage")]

    def post(self, request, group: str):
        tester = TESTERS.get(group)
        if tester is None:
            raise ApiError.not_found("Test for this group")
        params = request.data or {}
        try:
            result = tester(params, admin=request.user.admin) if group == "push" else tester(params)
        except ApiError as e:
            result = {"ok": False, "checks": [{"name": "Connection", "ok": False, "message": e.message}], "message": e.message}
        except Exception as e:  # noqa: BLE001 - surface provider errors to the admin, never a 500
            result = {"ok": False, "checks": [{"name": "Connection", "ok": False, "message": f"{e.__class__.__name__}: {e}"}], "message": str(e)}
        IntegrationStatus.objects.update_or_create(group=group, defaults={"ok": result["ok"], "checks": result["checks"], "message": result["message"][:2000], "tested_by": request.user.admin, "settings_version": settings_service.version_of(group)})
        audit("settings.test", "setting", group, request=request, meta={"ok": result["ok"]})
        return Response({**result, "testedAt": timezone.now().isoformat()})


class IntegrationStatusView(APIView):
    permission_classes = [AdminPerm("settings.view")]

    def get(self, request):
        statuses = {s.group: s for s in IntegrationStatus.objects.all()}
        items = []
        for meta in INTEGRATIONS:
            configured = configured_state(meta.group)
            st = statuses.get(meta.group)
            stale = st is not None and st.settings_version != settings_service.version_of(meta.group)
            if not configured:
                state = "not_configured"
            elif st is None or stale:
                state = "untested"
            else:
                state = "ok" if st.ok else "failing"
            items.append({
                **meta.model_dump(), "configured": configured, "state": state,
                "lastTest": {"ok": st.ok, "message": st.message, "checks": st.checks, "testedAt": st.tested_at.isoformat(), "stale": stale} if st else None,
            })
        return Response({"items": items})


class AuditLogView(APIView):
    permission_classes = [AdminPerm("audit.view")]

    def get(self, request):
        cursor, limit = page_params(request, 50, 200)
        qs = AuditLog.objects.select_related("actor_admin", "actor_user")
        q = request.query_params
        if q.get("entityType"):
            qs = qs.filter(entity_type=q["entityType"])
        if q.get("entityId"):
            qs = qs.filter(entity_id=q["entityId"])
        if q.get("action"):
            qs = qs.filter(action__startswith=q["action"])
        if q.get("adminId"):
            qs = qs.filter(actor_admin_id=q["adminId"])
        rows, nxt = keyset(qs, ["-created_at", "-id"], cursor, limit)
        return Response({"items": [{
            "id": r.id, "action": r.action, "entityType": r.entity_type, "entityId": r.entity_id, "actorType": r.actor_type,
            "actor": (r.actor_admin.name or r.actor_admin.email) if r.actor_admin else (r.actor_user.display_name if r.actor_user else "System"),
            "before": r.before, "after": r.after, "meta": r.meta, "ip": r.ip, "requestId": r.request_id, "createdAt": r.created_at.isoformat(),
        } for r in rows], "nextCursor": nxt})


class AdminMapsConfigView(APIView):
    """Browser map config for every admin screen with a map. The browser key is meant to be HTTP-referrer restricted."""

    permission_classes = [IsAdmin]

    def get(self, request):
        m = settings_service.get("maps.google")
        return Response({"browserApiKey": m.browserApiKey or None, "mapId": m.mapId or None, "regionCode": m.regionCode, "language": m.language})
