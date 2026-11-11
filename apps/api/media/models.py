from __future__ import annotations

from django.db import models

from core.models import UUIDModel


class Media(UUIDModel):
    TYPES = [("IMAGE", "Image"), ("VIDEO", "Video"), ("AUDIO", "Audio")]
    STATUSES = [("UPLOADING", "Uploading"), ("UPLOADED", "Uploaded"), ("PROCESSING", "Processing"), ("READY", "Ready"), ("FAILED", "Failed")]
    PURPOSES = [(p, p) for p in ("product", "avatar", "review", "rider_document", "rider_photo", "proof", "story", "look", "brand", "category", "wholesale_licence", "chat", "branding", "collection")]

    type = models.CharField(max_length=8, choices=TYPES)
    status = models.CharField(max_length=12, choices=STATUSES, default="UPLOADING", db_index=True)
    purpose = models.CharField(max_length=24, choices=PURPOSES, default="product", db_index=True)
    original_key = models.CharField(max_length=300, unique=True)
    original_name = models.CharField(max_length=200, blank=True, default="")
    content_type = models.CharField(max_length=100)
    declared_bytes = models.BigIntegerField(default=0)
    bytes = models.BigIntegerField(default=0)
    sha256 = models.CharField(max_length=64, blank=True, default="", db_index=True)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    variants = models.JSONField(default=list, blank=True)
    blurhash = models.CharField(max_length=120, blank=True, default="")
    thumbhash = models.CharField(max_length=80, blank=True, default="")
    dominant_color = models.CharField(max_length=7, blank=True, default="")
    waveform = models.JSONField(null=True, blank=True)
    alt = models.CharField(max_length=200, blank=True, default="")
    focal_x = models.FloatField(default=0.5)
    focal_y = models.FloatField(default=0.5)
    options = models.JSONField(default=dict, blank=True, help_text="backgroundCleanup, autoEnhance, crop, rotate, trim, posterAtMs")
    quality = models.JSONField(default=dict, blank=True, help_text="hints from the pipeline: sharpness, resolution, aspect")
    multipart_upload_id = models.CharField(max_length=300, blank=True, default="")
    error = models.TextField(blank=True, default="")
    processed_at = models.DateTimeField(null=True, blank=True)
    owner_admin = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    owner_user = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="media")
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["type", "status", "-created_at"]), models.Index(fields=["purpose", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.type} {self.original_name or self.id}"
