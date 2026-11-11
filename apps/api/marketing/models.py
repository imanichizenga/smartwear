from __future__ import annotations

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from core.models import TimeStamped, UUIDModel

SECTION_TYPES = [
    ("stories", "Stories row"), ("hero", "Hero carousel"), ("new_in", "New in"), ("collections", "Curated collections"), ("for_you", "For you"),
    ("brand_spotlight", "Brand spotlight"), ("beauty_corner", "Beauty corner"), ("recently_viewed", "Recently viewed"), ("drop_countdown", "Upcoming drop"),
    ("category_tiles", "Category tiles"), ("product_rail", "Product rail"), ("banner", "Banner"), ("looks_teaser", "Looks teaser"),
]


class HomeSection(UUIDModel):
    """One block of the Home screen. The mobile app renders whatever this list says, in order."""

    type = models.CharField(max_length=20, choices=SECTION_TYPES)
    title = models.CharField(max_length=80, blank=True, default="")
    title_sw = models.CharField(max_length=80, blank=True, default="")
    subtitle = models.CharField(max_length=160, blank=True, default="")
    config = models.JSONField(default=dict, blank=True, help_text="Type-specific: collectionIds, categoryId, brandId, bannerIds, productIds, limit, rule…")
    sort_order = models.IntegerField(default=0, db_index=True)
    is_active = models.BooleanField(default=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    segment = models.JSONField(default=dict, blank=True, help_text='{"customerTypes": ["WHOLESALE"], "departments": ["women"], "signedIn": true}')

    class Meta:
        ordering = ["sort_order", "created_at"]


class Banner(UUIDModel):
    title = models.CharField(max_length=80)
    title_sw = models.CharField(max_length=80, blank=True, default="")
    subtitle = models.CharField(max_length=160, blank=True, default="")
    eyebrow = models.CharField(max_length=40, blank=True, default="")
    media = models.ForeignKey("media.Media", on_delete=models.PROTECT, related_name="+")
    link = models.JSONField(default=dict, help_text='{"type": "collection|category|product|brand|look|url", "id": "...", "url": "..."}')
    cta_label = models.CharField(max_length=30, blank=True, default="")
    theme = models.CharField(max_length=6, choices=[("light", "Light text"), ("dark", "Dark text")], default="light")
    is_active = models.BooleanField(default=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    sort_order = models.IntegerField(default=0)


class Story(UUIDModel):
    KINDS = [("drop", "New drop"), ("brand", "Brand story"), ("tutorial", "Beauty tutorial"), ("editorial", "Editorial")]
    title = models.CharField(max_length=40)
    kind = models.CharField(max_length=10, choices=KINDS, default="editorial")
    cover = models.ForeignKey("media.Media", on_delete=models.PROTECT, related_name="+")
    brand = models.ForeignKey("catalog.Brand", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    is_active = models.BooleanField(default=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "-created_at"]


class StoryItem(models.Model):
    story = models.ForeignKey(Story, on_delete=models.CASCADE, related_name="items")
    media = models.ForeignKey("media.Media", on_delete=models.PROTECT, related_name="+")
    caption = models.CharField(max_length=160, blank=True, default="")
    duration_ms = models.PositiveIntegerField(default=5000)
    link = models.JSONField(default=dict, blank=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]


class StoryView(models.Model):
    story = models.ForeignKey(Story, on_delete=models.CASCADE, related_name="views")
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="+")
    viewed_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["story", "user"], name="uniq_story_view")]

    @staticmethod
    def merge_conflict(obj, keep) -> None:
        obj.delete()


class Look(UUIDModel):
    """A full-screen shoppable video or image in the Discover feed."""

    media = models.ForeignKey("media.Media", on_delete=models.PROTECT, related_name="+")
    caption = models.CharField(max_length=220, blank=True, default="")
    caption_sw = models.CharField(max_length=220, blank=True, default="")
    credit = models.CharField(max_length=80, blank=True, default="")
    brand = models.ForeignKey("catalog.Brand", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    department = models.CharField(max_length=8, blank=True, default="")
    published = models.BooleanField(default=False, db_index=True)
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)
    sort_order = models.IntegerField(default=0)
    likes_count = models.PositiveIntegerField(default=0)
    saves_count = models.PositiveIntegerField(default=0)
    shares_count = models.PositiveIntegerField(default=0)
    views_count = models.PositiveIntegerField(default=0)


class LookProductTag(models.Model):
    look = models.ForeignKey(Look, on_delete=models.CASCADE, related_name="tags")
    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE, related_name="look_tags")
    x = models.FloatField(validators=[MinValueValidator(0), MaxValueValidator(1)])
    y = models.FloatField(validators=[MinValueValidator(0), MaxValueValidator(1)])
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [models.UniqueConstraint(fields=["look", "product"], name="uniq_look_product")]


class LookReaction(models.Model):
    look = models.ForeignKey(Look, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=6, choices=[("like", "Like"), ("save", "Save")])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["look", "user", "kind"], name="uniq_look_reaction")]

    @staticmethod
    def merge_conflict(obj, keep) -> None:
        obj.delete()


class DropSubscription(models.Model):
    """'Notify me' for an upcoming drop (collection with launches_at)."""

    collection = models.ForeignKey("catalog.Collection", on_delete=models.CASCADE, related_name="subscriptions")
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="+")
    notified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["collection", "user"], name="uniq_drop_subscription")]

    @staticmethod
    def merge_conflict(obj, keep) -> None:
        obj.delete()


class Campaign(UUIDModel):
    CHANNELS = [("push", "Push"), ("sms", "SMS")]
    STATUSES = [(s, s.title()) for s in ("DRAFT", "SCHEDULED", "SENDING", "SENT", "CANCELLED", "FAILED")]
    channel = models.CharField(max_length=4, choices=CHANNELS)
    name = models.CharField(max_length=80)
    title = models.CharField(max_length=80, blank=True, default="")
    body = models.CharField(max_length=480)
    body_sw = models.CharField(max_length=480, blank=True, default="")
    link = models.JSONField(default=dict, blank=True)
    audience = models.JSONField(default=dict, help_text='{"customerTypes": [], "departments": [], "hasOrdered": null, "categoryIds": [], "lastSeenDays": null}')
    scheduled_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUSES, default="DRAFT")
    sent_at = models.DateTimeField(null=True, blank=True)
    stats = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey("accounts.AdminUser", null=True, on_delete=models.SET_NULL, related_name="+")
