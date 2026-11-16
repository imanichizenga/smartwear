from __future__ import annotations

import pytest

from conftest import admin_client, make_admin
from core import settings_service
from core.models import AuditLog, Setting

pytestmark = pytest.mark.django_db


def test_secrets_encrypted_at_rest_masked_in_admin_and_kept_on_placeholder(admin_user):
    settings_service.update("sms.beem", {"apiKey": "beem-key-1234", "secretKey": "beem-secret-3fA9", "senderId": "SMARTWEAR"}, admin=admin_user)
    row = Setting.objects.get(group="sms.beem")
    assert row.value["secretKey"].startswith("enc:v1:k1:") and "3fA9" not in row.value["secretKey"]
    assert settings_service.get("sms.beem").secretKey == "beem-secret-3fA9"
    view = settings_service.admin_view("sms.beem")
    assert view["value"]["secretKey"] == "••••••••3fA9" and view["secrets"]["secretKey"]["set"] is True
    # Saving the form back with the masked value keeps the stored secret
    settings_service.update("sms.beem", {**view["value"], "senderId": "SWEAR"}, admin=admin_user)
    assert settings_service.get("sms.beem").secretKey == "beem-secret-3fA9" and settings_service.get("sms.beem").senderId == "SWEAR"
    log = AuditLog.objects.filter(action="settings.update").order_by("-id").first()
    assert log.after["secretKey"] == "[redacted]" and "beem-secret" not in str(log.before) + str(log.after)


def test_validation_and_version_conflict(admin_user):
    from core.exceptions import ApiError

    with pytest.raises(ApiError) as e:
        settings_service.update("sms.beem", {"senderId": "THIS-IS-WAY-TOO-LONG"}, admin=admin_user)
    assert e.value.status_code == 400
    v = settings_service.update("checkout", {"slideToConfirm": True}, admin=admin_user)["version"]
    with pytest.raises(ApiError) as e:
        settings_service.update("checkout", {"slideToConfirm": False}, admin=admin_user, expected_version=v - 1)
    assert e.value.code == "stale_settings"


def test_first_save_of_unsaved_group_with_version_zero(admin_user):
    """The admin UI sends version 0 for a group that was never saved; that first save must succeed."""
    assert settings_service.admin_view("payments")["version"] == 0
    out = settings_service.update("payments", settings_service.admin_view("payments")["value"], admin=admin_user, expected_version=0)
    assert out["version"] == 1
    out = settings_service.update("payments", out["value"], admin=admin_user, expected_version=1)
    assert out["version"] == 2


def test_cache_invalidation_without_restart(admin_user):
    assert settings_service.get("features").looksFeed is True
    settings_service.update("features", {"looksFeed": False}, admin=admin_user)
    settings_service.invalidate("features")  # on_commit doesn't fire inside the test transaction
    assert settings_service.get("features").looksFeed is False


def test_public_config_has_no_secrets(api, admin_user):
    settings_service.update("maps.google", {"serverApiKey": "AIza-secret"}, admin=admin_user)
    settings_service.update("auth", {"googleWebClientId": "1-a.apps.googleusercontent.com"}, admin=admin_user)
    settings_service.invalidate()
    cfg = api.get("/v1/config/public").json()
    flat = str(cfg)
    assert "AIza-secret" not in flat and "jwtSecret" not in flat
    assert cfg["auth"]["googleWebClientId"] == "1-a.apps.googleusercontent.com"
    assert cfg["localization"]["currency"] == "TZS" and "mapStyleLight" in cfg["maps_google"]


def test_reveal_requires_permission_and_recent_reauth(admin_user):
    settings_service.update("storage.s3", {"bucket": "b", "accessKeyId": "AKIA", "secretAccessKey": "s3-secret-xyz"}, admin=admin_user)
    manager = admin_client(make_admin("MANAGER"))
    assert manager.post("/v1/admin/settings/storage.s3/reveal", {"path": "secretAccessKey"}, format="json").status_code == 403
    c = admin_client(admin_user)
    from accounts.models import AdminSession

    AdminSession.objects.update(reauth_at=None)
    assert c.post("/v1/admin/settings/storage.s3/reveal", {"path": "secretAccessKey"}, format="json").json()["code"] == "reauth_required"
    assert c.post("/v1/admin/auth/reauth", {"password": "correct horse battery"}, format="json").status_code == 200
    r = c.post("/v1/admin/settings/storage.s3/reveal", {"path": "secretAccessKey"}, format="json")
    assert r.json()["value"] == "s3-secret-xyz"
    assert AuditLog.objects.filter(action="settings.secret.reveal").exists()


def test_status_overview_states(admin_user):
    c = admin_client(admin_user)
    items = {i["group"]: i for i in c.get("/v1/admin/settings/status").json()["items"]}
    assert items["sms.beem"]["state"] == "not_configured" and items["payments"]["state"] == "untested"


def test_s3_test_connection_against_local_store(admin_user):
    """Runs the real S3 checks against the docker-compose RustFS (skipped if it isn't running)."""
    import socket

    try:
        socket.create_connection(("localhost", 9000), timeout=1).close()
    except OSError:
        pytest.skip("local S3 not running")
    import boto3

    s3 = boto3.client("s3", endpoint_url="http://localhost:9000", aws_access_key_id="smartwear", aws_secret_access_key="smartwear-secret", region_name="us-east-1")
    try:
        s3.create_bucket(Bucket="smartwear-test")
    except s3.exceptions.BucketAlreadyOwnedByYou:
        pass
    except Exception:  # noqa: BLE001
        pass
    s3.put_bucket_cors(Bucket="smartwear-test", CORSConfiguration={"CORSRules": [{"AllowedMethods": ["GET", "PUT", "POST"], "AllowedOrigins": ["*"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"]}]})
    settings_service.update("storage.s3", {"provider": "s3_compatible", "bucket": "smartwear-test", "region": "us-east-1", "accessKeyId": "smartwear", "secretAccessKey": "smartwear-secret", "endpoint": "http://localhost:9000", "forcePathStyle": True}, admin=admin_user)
    settings_service.invalidate()
    r = admin_client(admin_user).post("/v1/admin/settings/storage.s3/test", {}, format="json").json()
    names = {c["name"]: c["ok"] for c in r["checks"]}
    assert names["Put object"] and names["Get object"] and names["Delete object"], r
    assert r["ok"] is True, r


def test_empty_map_styles_fall_back_to_brand_silver(db):
    from core.settings_schema import MapsGoogle

    m = MapsGoogle(mapStyleLight=[], mapStyleDark=[])
    assert m.mapStyleLight[0] == {"elementType": "geometry", "stylers": [{"color": "#f3f1ec"}]}
    assert m.mapStyleDark and m.mapStyleDark != m.mapStyleLight
    custom = [{"elementType": "geometry", "stylers": [{"color": "#000000"}]}]
    assert MapsGoogle(mapStyleLight=custom).mapStyleLight == custom


@pytest.mark.parametrize("group", sorted(settings_service.SETTINGS_GROUPS))
def test_admin_ui_round_trip_saves_every_group(admin_user, group):
    """Exactly what the admin UI does: GET the group, PUT it back with the version it was shown, then save again."""
    c = admin_client(admin_user)
    shown = c.get(f"/v1/admin/settings/{group}").json()
    r = c.put(f"/v1/admin/settings/{group}", {"value": shown["value"], "version": shown["version"]}, format="json")
    assert r.status_code == 200, r.json()
    first = r.json()
    assert first["version"] == shown["version"] + 1 and first["updatedAt"]
    r = c.put(f"/v1/admin/settings/{group}", {"value": first["value"], "version": first["version"]}, format="json")
    assert r.status_code == 200, r.json()
    assert c.get(f"/v1/admin/settings/{group}").json()["version"] == first["version"] + 1


def test_admin_ui_saves_keys_and_masked_resave_keeps_them(admin_user):
    c = admin_client(admin_user)
    shown = c.get("/v1/admin/settings/payments").json()
    value = shown["value"] | {"snippeApiKey": "snp_live_key_9X7Q", "cashOnDeliveryEnabled": False}
    saved = c.put("/v1/admin/settings/payments", {"value": value, "version": shown["version"]}, format="json").json()
    assert saved["secrets"]["snippeApiKey"]["set"] is True and saved["value"]["snippeApiKey"].endswith("9X7Q")
    assert "snp_live" not in str(Setting.objects.get(group="payments").value)
    # Re-saving the form as displayed (masked key) must not wipe the stored key.
    c.put("/v1/admin/settings/payments", {"value": saved["value"], "version": saved["version"]}, format="json")
    assert settings_service.get("payments").snippeApiKey == "snp_live_key_9X7Q"
    # The mobile app sees the non-secret change and never the key.
    public = c.get("/v1/config/public").json()
    assert public["payments"]["cashOnDeliveryEnabled"] is False and "snp_live" not in str(public)
