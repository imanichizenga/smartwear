from __future__ import annotations

import base64

import pytest


@pytest.fixture(autouse=True)
def _clean_state(settings):
    """Every test starts with an empty Redis DB 15 and empty settings caches."""
    from core import settings_service

    settings_service.redis_client().flushdb()
    settings_service._local.clear()
    yield
    settings_service._local.clear()


@pytest.fixture
def api():
    from rest_framework.test import APIClient

    return APIClient()


@pytest.fixture
def admin_user(db):
    from accounts.models import AdminUser, Role
    from accounts.rbac import ensure_roles

    ensure_roles()
    return AdminUser.objects.create_user("owner@smartwear.test", "correct horse battery", name="Owner", role=Role.objects.get(key="SUPER_ADMIN"))


def make_admin(role_key: str, email: str | None = None):
    from accounts.models import AdminUser, Role
    from accounts.rbac import ensure_roles

    ensure_roles()
    return AdminUser.objects.create_user(email or f"{role_key.lower()}@smartwear.test", "correct horse battery", name=role_key.title(), role=Role.objects.get(key=role_key))


def admin_client(admin):
    """APIClient authenticated as `admin` with 2FA already passed."""
    from rest_framework.test import APIClient

    from accounts.admin_auth import create_session

    class Req:
        headers = {"User-Agent": "pytest"}
        META = {"REMOTE_ADDR": "127.0.0.1"}

    _s, token = create_session(admin, Req(), mfa_passed=True)
    c = APIClient()
    c.credentials(HTTP_X_ADMIN_SESSION=token)
    return c


@pytest.fixture
def super_client(admin_user):
    return admin_client(admin_user)


@pytest.fixture
def customer(db):
    from accounts.models import AuthIdentity, User

    u = User.objects.create(phone="+255712345678", name="Neema Mushi")
    AuthIdentity.objects.create(user=u, provider="phone", subject=u.phone)
    return u


def user_client(user):
    from rest_framework.test import APIClient

    from accounts.tokens import start_session

    class Req:
        headers = {"User-Agent": "pytest"}
        META = {"REMOTE_ADDR": "127.0.0.1"}
        device_id = "test-device"

    tok = start_session(user, Req(), device_id="test-device")
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {tok['accessToken']}", HTTP_X_DEVICE_ID="test-device")
    return c


@pytest.fixture
def customer_client(customer):
    return user_client(customer)


TEST_KEY = "k1." + base64.b64encode(bytes(range(32))).decode()
