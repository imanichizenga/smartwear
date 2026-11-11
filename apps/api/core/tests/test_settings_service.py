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
