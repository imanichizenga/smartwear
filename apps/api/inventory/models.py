from __future__ import annotations

from django.contrib.gis.db import models as gis
from django.db import models
from django.db.models import F, Q

from core.models import UUIDModel


class Store(UUIDModel):
    """Shop, office or warehouse. Shown as a blue dot with a store glyph on every map."""

    KINDS = [("store", "Store"), ("office", "Office"), ("warehouse", "Warehouse")]
    code = models.SlugField(max_length=24, unique=True)
    name = models.CharField(max_length=80)
    kind = models.CharField(max_length=10, choices=KINDS, default="store")
    address = models.CharField(max_length=240)
    area = models.CharField(max_length=80, blank=True, default="", help_text="Neighbourhood, e.g. Masaki")
    city = models.CharField(max_length=80, default="Dar es Salaam")
    location = gis.PointField(geography=True, srid=4326)
    phone = models.CharField(max_length=20, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    hours = models.JSONField(default=dict, blank=True, help_text='{"mon": [["09:00","19:00"]], ...}')
    timezone = models.CharField(max_length=40, default="Africa/Dar_es_Salaam")
    serviceable_radius_m = models.PositiveIntegerField(default=15000)
    fulfils_delivery = models.BooleanField(default=True)
    allows_pickup = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self) -> str:
        return self.name


class InventoryLevel(models.Model):
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="inventory")
    variant = models.ForeignKey("catalog.ProductVariant", on_delete=models.CASCADE, related_name="inventory")
    on_hand = models.IntegerField(default=0)
    reserved = models.IntegerField(default=0, help_text="Held by placed, not yet picked-up orders")
    low_stock_threshold = models.PositiveIntegerField(default=3)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["store", "variant"], name="uniq_inventory_level"),
            models.CheckConstraint(condition=Q(on_hand__gte=0), name="on_hand_non_negative"),
            models.CheckConstraint(condition=Q(reserved__gte=0) & Q(reserved__lte=F("on_hand")), name="reserved_within_on_hand"),
        ]
        indexes = [models.Index(fields=["variant", "store"])]

    @property
    def available(self) -> int:
        return max(0, self.on_hand - self.reserved)


class StockMovement(models.Model):
    REASONS = [
        ("receive", "Received"), ("adjust", "Adjustment"), ("count", "Stock count"), ("damage", "Damaged"), ("return", "Customer return"),
        ("sale", "Sold"), ("transfer_out", "Transfer out"), ("transfer_in", "Transfer in"), ("reserve", "Reserved"), ("release", "Released"),
    ]
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="movements")
    variant = models.ForeignKey("catalog.ProductVariant", on_delete=models.CASCADE, related_name="movements")
    delta_on_hand = models.IntegerField(default=0)
    delta_reserved = models.IntegerField(default=0)
    reason = models.CharField(max_length=16, choices=REASONS)
    note = models.CharField(max_length=240, blank=True, default="")
    order = models.ForeignKey("commerce.Order", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    transfer = models.ForeignKey("StockTransfer", null=True, blank=True, on_delete=models.SET_NULL, related_name="movements")
    actor = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [models.Index(fields=["variant", "-created_at"]), models.Index(fields=["store", "-created_at"])]


class StockTransfer(UUIDModel):
    STATUSES = [("DRAFT", "Draft"), ("IN_TRANSIT", "In transit"), ("RECEIVED", "Received"), ("CANCELLED", "Cancelled")]
    from_store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name="transfers_out")
    to_store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name="transfers_in")
    status = models.CharField(max_length=12, choices=STATUSES, default="DRAFT")
    lines = models.JSONField(default=list, help_text='[{"variantId": "...", "qty": 3}]')
    note = models.CharField(max_length=240, blank=True, default="")
    created_by = models.ForeignKey("accounts.AdminUser", null=True, on_delete=models.SET_NULL, related_name="+")
    shipped_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=~Q(from_store=F("to_store")), name="transfer_distinct_stores")]
