from __future__ import annotations

import uuid

from django.db import models


class TimeStamped(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class UUIDModel(TimeStamped):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class Setting(models.Model):
    """One row per settings group. Secret fields inside `value` are stored as AES-256-GCM ciphertext."""

    group = models.CharField(max_length=64, primary_key=True)
    value = models.JSONField(default=dict)
    secret_paths = models.JSONField(default=list, help_text="Dotted paths inside value that are encrypted")
    version = models.PositiveIntegerField(default=1)
    updated_by = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def is_secret(self) -> bool:
        return bool(self.secret_paths)


class IntegrationStatus(models.Model):
    """Result of the last Test connection per integration (drives the status overview)."""

    group = models.CharField(max_length=64, primary_key=True)
    ok = models.BooleanField(default=False)
    checks = models.JSONField(default=list)
    message = models.TextField(blank=True, default="")
    tested_at = models.DateTimeField(auto_now=True)
    tested_by = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    settings_version = models.PositiveIntegerField(default=0)


class AuditLog(models.Model):
    id = models.BigAutoField(primary_key=True)
    actor_type = models.CharField(max_length=16, choices=[("admin", "admin"), ("customer", "customer"), ("rider", "rider"), ("system", "system")])
    actor_admin = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    actor_user = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=80, db_index=True)
    entity_type = models.CharField(max_length=64, db_index=True)
    entity_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    request_id = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["entity_type", "entity_id", "-created_at"])]


class IdempotencyKey(models.Model):
    key = models.CharField(max_length=128)
    scope = models.CharField(max_length=64)
    owner = models.CharField(max_length=64)
    request_hash = models.CharField(max_length=64)
    status_code = models.PositiveSmallIntegerField(null=True)
    response = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["scope", "owner", "key"], name="uniq_idempotency")]
