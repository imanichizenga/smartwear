from __future__ import annotations

import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.db import models
from django.db.models import Q
from django.utils import timezone

from core.models import TimeStamped, UUIDModel


class Role(TimeStamped):
    key = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=64)
    description = models.CharField(max_length=240, blank=True, default="")
    permissions = models.JSONField(default=list)
    is_system = models.BooleanField(default=False)

    def __str__(self) -> str:
        return self.name


class AdminUserManager(BaseUserManager):
    def create_user(self, email: str, password: str | None = None, **extra):
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password) if password else user.set_unusable_password()
        user.save(using=self._db)
        return user


class AdminUser(AbstractBaseUser):
    """Staff account for the Admin web app. Separate table from customers and riders."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=120, blank=True, default="")
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="admins")
    extra_permissions = models.JSONField(default=list, blank=True)
    is_active = models.BooleanField(default=True)
    totp_secret = models.TextField(blank=True, default="", help_text="AES-GCM ciphertext")
    totp_confirmed_at = models.DateTimeField(null=True, blank=True)
    recovery_codes = models.JSONField(default=list, blank=True, help_text="SHA-256 hashes of unused recovery codes")
    password_changed_at = models.DateTimeField(null=True, blank=True)
    failed_logins = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    push_tokens = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []
    objects = AdminUserManager()

    @property
    def permissions(self) -> set[str]:
        return set(self.role.permissions) | set(self.extra_permissions or [])

    def has_perm_key(self, perm: str) -> bool:
        return self.role.key == "SUPER_ADMIN" or perm in self.permissions

    @property
    def is_super_admin(self) -> bool:
        return self.role.key == "SUPER_ADMIN"

    @property
    def mfa_enabled(self) -> bool:
        return bool(self.totp_secret and self.totp_confirmed_at)


class AdminSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    admin = models.ForeignKey(AdminUser, on_delete=models.CASCADE, related_name="sessions")
    token_hash = models.CharField(max_length=64, unique=True)
    mfa_passed = models.BooleanField(default=False)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    reauth_at = models.DateTimeField(null=True, blank=True, help_text="Last password/2FA re-confirmation (for Reveal)")
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["admin", "-last_seen_at"])]

    @property
    def active(self) -> bool:
        return self.revoked_at is None and self.expires_at > timezone.now()


class AdminInvite(TimeStamped):
    email = models.EmailField()
    name = models.CharField(max_length=120, blank=True, default="")
    role = models.ForeignKey(Role, on_delete=models.CASCADE)
    token_hash = models.CharField(max_length=64, unique=True)
    invited_by = models.ForeignKey(AdminUser, null=True, on_delete=models.SET_NULL, related_name="+")
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)


class User(UUIDModel):
    """A customer or a rider (riders have a related `delivery.Rider` profile)."""

    CUSTOMER_TYPES = [("RETAIL", "Retail"), ("WHOLESALE", "Wholesale")]
    phone = models.CharField(max_length=20, null=True, blank=True)
    phone_verified_at = models.DateTimeField(null=True, blank=True)
    email = models.EmailField(null=True, blank=True)
    name = models.CharField(max_length=120, blank=True, default="")
    avatar = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    cover = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    customer_type = models.CharField(max_length=12, choices=CUSTOMER_TYPES, default="RETAIL")
    wholesale_approved = models.BooleanField(default=False)
    customer_group = models.ForeignKey("catalog.CustomerGroup", null=True, blank=True, on_delete=models.SET_NULL, related_name="members")
    locale = models.CharField(max_length=5, default="en")
    theme = models.CharField(max_length=8, default="system", choices=[("light", "light"), ("dark", "dark"), ("system", "system")])
    style_profile = models.JSONField(default=dict, blank=True)
    notification_prefs = models.JSONField(default=dict, blank=True)
    quiz_completed_at = models.DateTimeField(null=True, blank=True)
    loyalty_points = models.IntegerField(default=0)
    is_blocked = models.BooleanField(default=False)
    blocked_reason = models.CharField(max_length=240, blank=True, default="")
    last_seen_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    merged_into = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["phone"], condition=Q(deleted_at__isnull=True, phone__isnull=False), name="uniq_active_phone")]
        indexes = [models.Index(fields=["email"]), models.Index(fields=["customer_type", "wholesale_approved"])]

    def __str__(self) -> str:
        return self.name or self.phone or str(self.id)

    @property
    def is_rider(self) -> bool:
        return hasattr(self, "rider") and self.rider is not None  # type: ignore[attr-defined]

    @property
    def display_name(self) -> str:
        return self.name or (self.email.split("@")[0] if self.email else "") or "SmartWear member"


class AuthIdentity(TimeStamped):
    PROVIDERS = [("phone", "Phone"), ("google", "Google")]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="identities")
    provider = models.CharField(max_length=12, choices=PROVIDERS)
    subject = models.CharField(max_length=190)
    email = models.EmailField(null=True, blank=True)
    data = models.JSONField(default=dict, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["provider", "subject"], name="uniq_identity"),
            models.UniqueConstraint(fields=["user", "provider"], name="one_identity_per_provider"),
        ]


class OtpChallenge(UUIDModel):
    PURPOSES = [("login", "login"), ("link_phone", "link_phone")]
    phone = models.CharField(max_length=20, db_index=True)
    purpose = models.CharField(max_length=16, choices=PURPOSES, default="login")
    mode = models.CharField(max_length=12, choices=[("beem_sms", "beem_sms"), ("beem_otp", "beem_otp")])
    code_hash = models.CharField(max_length=200, blank=True, default="")
    provider_ref = models.CharField(max_length=80, blank=True, default="")
    attempts = models.PositiveSmallIntegerField(default=0)
    max_attempts = models.PositiveSmallIntegerField(default=5)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    invalidated_at = models.DateTimeField(null=True, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    device_id = models.CharField(max_length=128, blank=True, default="")
    sms_request_id = models.CharField(max_length=80, blank=True, default="")
    for_user = models.ForeignKey(User, null=True, blank=True, on_delete=models.CASCADE, related_name="+")

    class Meta:
        indexes = [models.Index(fields=["phone", "-created_at"]), models.Index(fields=["ip", "-created_at"]), models.Index(fields=["device_id", "-created_at"])]


class BlockedPhone(TimeStamped):
    phone = models.CharField(max_length=20, unique=True)
    reason = models.CharField(max_length=240, blank=True, default="")
    until = models.DateTimeField(null=True, blank=True, help_text="Empty = permanent")
    automatic = models.BooleanField(default=False)


class Session(UUIDModel):
    """Refresh-token session. One per device; refresh tokens rotate on every use."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sessions")
    family = models.UUIDField(default=uuid.uuid4, db_index=True)
    refresh_hash = models.CharField(max_length=64, unique=True)
    previous_hash = models.CharField(max_length=64, blank=True, default="", db_index=True)
    device_id = models.CharField(max_length=128, blank=True, default="")
    platform = models.CharField(max_length=16, blank=True, default="")
    app_version = models.CharField(max_length=24, blank=True, default="")
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True, default="")
    last_used_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoke_reason = models.CharField(max_length=40, blank=True, default="")

    class Meta:
        indexes = [models.Index(fields=["user", "revoked_at"])]

    @property
    def active(self) -> bool:
        return self.revoked_at is None and self.expires_at > timezone.now()
