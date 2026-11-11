from __future__ import annotations

from django.db import models

from core.models import UUIDModel


class PushToken(models.Model):
    user = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.CASCADE, related_name="push_tokens")
    admin = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.CASCADE, related_name="device_push_tokens")
    token = models.CharField(max_length=300, unique=True)
    provider = models.CharField(max_length=8, choices=[("expo", "Expo"), ("fcm", "FCM"), ("apns", "APNs")], default="expo")
    platform = models.CharField(max_length=8, blank=True, default="")
    device_id = models.CharField(max_length=128, blank=True, default="")
    locale = models.CharField(max_length=5, default="en")
    last_seen_at = models.DateTimeField(auto_now=True)
    disabled_at = models.DateTimeField(null=True, blank=True)


class Notification(UUIDModel):
    """Inbox entry (order milestones, drops, wishlist price drops)."""

    TYPES = [("order", "Order"), ("drop", "Drop"), ("price_drop", "Price drop"), ("wholesale", "Wholesale"), ("system", "System"), ("chat", "Chat"), ("rider", "Rider")]
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="notifications")
    type = models.CharField(max_length=12, choices=TYPES)
    title = models.CharField(max_length=120)
    body = models.CharField(max_length=480)
    data = models.JSONField(default=dict, blank=True)
    image = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    read_at = models.DateTimeField(null=True, blank=True)
    pushed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "-created_at"]), models.Index(fields=["user", "read_at"])]


class ChatThread(UUIDModel):
    KINDS = [("support", "Support"), ("order", "Order (customer ↔ rider)")]
    kind = models.CharField(max_length=8, choices=KINDS, default="support")
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="chat_threads")
    order = models.ForeignKey("commerce.Order", null=True, blank=True, on_delete=models.CASCADE, related_name="chat_threads")
    rider = models.ForeignKey("delivery.Rider", null=True, blank=True, on_delete=models.SET_NULL, related_name="chat_threads")
    status = models.CharField(max_length=8, choices=[("open", "Open"), ("pending", "Pending"), ("closed", "Closed")], default="open", db_index=True)
    subject = models.CharField(max_length=120, blank=True, default="")
    assigned_to = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)
    unread_for_user = models.PositiveIntegerField(default=0)
    unread_for_staff = models.PositiveIntegerField(default=0)
    unread_for_rider = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["order"], condition=models.Q(kind="order"), name="one_order_chat")]


class ChatMessage(models.Model):
    SENDERS = [("customer", "Customer"), ("rider", "Rider"), ("staff", "Staff"), ("system", "System")]
    thread = models.ForeignKey(ChatThread, on_delete=models.CASCADE, related_name="messages")
    sender_type = models.CharField(max_length=8, choices=SENDERS)
    sender_user = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    sender_admin = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    body = models.TextField(max_length=4000, blank=True, default="")
    media = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]
