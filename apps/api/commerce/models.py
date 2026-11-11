from __future__ import annotations

from django.contrib.gis.db import models as gis
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

from core.models import TimeStamped, UUIDModel

ORDER_STATUSES = [(s, s.replace("_", " ").title()) for s in (
    "PENDING_PAYMENT", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "ASSIGNED", "PICKED_UP", "ON_THE_WAY", "ARRIVED", "DELIVERED", "CANCELLED", "REFUNDED", "FAILED",
)]
PAYMENT_METHODS = [("CASH_ON_DELIVERY", "Cash on delivery"), ("MOBILE_MONEY", "Mobile money"), ("CARD", "Card")]
PAYMENT_STATUSES = [(s, s.title()) for s in ("PENDING", "AUTHORIZED", "PAID", "FAILED", "REFUNDED", "CANCELLED")]


class Cart(TimeStamped):
    user = models.OneToOneField("accounts.User", on_delete=models.CASCADE, related_name="cart")
    promo_code = models.CharField(max_length=40, blank=True, default="")

    @staticmethod
    def merge_conflict(obj, keep) -> None:
        target = Cart.objects.get(user=keep)
        for item in obj.items.all():
            existing = target.items.filter(variant=item.variant, saved_for_later=item.saved_for_later).first()
            if existing:
                existing.qty = max(existing.qty, item.qty)
                existing.save(update_fields=["qty"])
            else:
                item.cart = target
                item.save(update_fields=["cart"])
        obj.delete()


class CartItem(models.Model):
    cart = models.ForeignKey(Cart, on_delete=models.CASCADE, related_name="items")
    variant = models.ForeignKey("catalog.ProductVariant", on_delete=models.CASCADE, related_name="+")
    qty = models.PositiveIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(999)])
    saved_for_later = models.BooleanField(default=False)
    added_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-added_at"]
        constraints = [models.UniqueConstraint(fields=["cart", "variant", "saved_for_later"], name="uniq_cart_line")]


class WishlistBoard(UUIDModel):
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="wishlist_boards")
    name = models.CharField(max_length=60)
    is_default = models.BooleanField(default=False)
    share_token = models.CharField(max_length=32, unique=True, null=True, blank=True)
    cover = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["-is_default", "sort_order", "created_at"]
        constraints = [models.UniqueConstraint(fields=["user"], condition=Q(is_default=True), name="one_default_board")]

    @staticmethod
    def merge_conflict(obj, keep) -> None:
        target = WishlistBoard.objects.get(user=keep, is_default=True)
        for item in obj.items.all():
            if not target.items.filter(product=item.product).exists():
                item.board = target
                item.save(update_fields=["board"])
        obj.delete()


class WishlistItem(models.Model):
    board = models.ForeignKey(WishlistBoard, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE, related_name="wishlist_items")
    variant = models.ForeignKey("catalog.ProductVariant", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    price_at_add = models.BigIntegerField(null=True, blank=True, help_text="For honest price-drop alerts")
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-added_at"]
        constraints = [models.UniqueConstraint(fields=["board", "product"], name="uniq_board_product")]


class SavedPlace(UUIDModel):
    KINDS = [("home", "Home"), ("work", "Work"), ("other", "Other"), ("recent", "Recent")]
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="places")
    kind = models.CharField(max_length=8, choices=KINDS, default="other")
    label = models.CharField(max_length=60, blank=True, default="")
    address = models.CharField(max_length=240)
    area = models.CharField(max_length=80, blank=True, default="")
    landmark_note = models.CharField(max_length=120, blank=True, default="")
    location = gis.PointField(geography=True, srid=4326)
    place_id = models.CharField(max_length=300, blank=True, default="")
    plus_code = models.CharField(max_length=32, blank=True, default="")
    last_used_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["kind", "-last_used_at"]
        constraints = [models.UniqueConstraint(fields=["user", "kind"], condition=Q(kind__in=["home", "work"]), name="one_home_one_work")]

    @staticmethod
    def merge_conflict(obj, keep) -> None:
        obj.kind = "other"
        obj.user = keep
        obj.save(update_fields=["kind", "user"])


class SavedPaymentMethod(UUIDModel):
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="payment_methods")
    method = models.CharField(max_length=20, choices=PAYMENT_METHODS)
    provider = models.CharField(max_length=24, blank=True, default="", help_text="e.g. mpesa, tigopesa, airtelmoney")
    label = models.CharField(max_length=60, blank=True, default="")
    msisdn = models.CharField(max_length=20, blank=True, default="", help_text="Mobile money number (E.164)")
    is_default = models.BooleanField(default=False)

    class Meta:
        ordering = ["-is_default", "created_at"]
        constraints = [models.UniqueConstraint(fields=["user"], condition=Q(is_default=True), name="one_default_payment")]

    @staticmethod
    def merge_conflict(obj, keep) -> None:
        obj.is_default = False
        obj.user = keep
        obj.save(update_fields=["is_default", "user"])


class PromoCode(UUIDModel):
    TYPES = [("PERCENT", "Percent"), ("FIXED", "Fixed amount"), ("FREE_DELIVERY", "Free delivery")]
    code = models.CharField(max_length=40, unique=True)
    description = models.CharField(max_length=200, blank=True, default="")
    type = models.CharField(max_length=16, choices=TYPES)
    value = models.BigIntegerField(default=0, help_text="bps for PERCENT, minor units for FIXED")
    min_subtotal = models.BigIntegerField(null=True, blank=True)
    max_discount = models.BigIntegerField(null=True, blank=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    usage_limit = models.PositiveIntegerField(null=True, blank=True)
    used_count = models.PositiveIntegerField(default=0)
    per_customer_limit = models.PositiveIntegerField(null=True, blank=True, default=1)
    customer_types = models.JSONField(default=list, blank=True)
    category_ids = models.JSONField(default=list, blank=True, help_text="Restrict to products in these category subtrees")
    first_order_only = models.BooleanField(default=False)
    active = models.BooleanField(default=True)


class Order(UUIDModel):
    number = models.CharField(max_length=20, unique=True)
    user = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="orders")
    status = models.CharField(max_length=20, choices=ORDER_STATUSES, default="CONFIRMED", db_index=True)
    customer_type = models.CharField(max_length=12, default="RETAIL")
    currency = models.CharField(max_length=3, default="TZS")
    subtotal = models.BigIntegerField()
    discount = models.BigIntegerField(default=0)
    delivery_fee = models.BigIntegerField(default=0)
    tax = models.BigIntegerField(default=0)
    total = models.BigIntegerField()
    savings = models.BigIntegerField(default=0)
    promo_code = models.CharField(max_length=40, blank=True, default="")
    fulfilment = models.CharField(max_length=10, choices=[("delivery", "Delivery"), ("pickup", "Pickup")], default="delivery")
    delivery_option = models.JSONField(default=dict, help_text="Snapshot of the chosen option")
    fee_breakdown = models.JSONField(default=dict, blank=True)
    store = models.ForeignKey("inventory.Store", on_delete=models.PROTECT, related_name="orders")
    destination = gis.PointField(geography=True, srid=4326, null=True, blank=True)
    destination_label = models.CharField(max_length=240, blank=True, default="")
    destination_area = models.CharField(max_length=80, blank=True, default="")
    landmark_note = models.CharField(max_length=120, blank=True, default="")
    distance_m = models.PositiveIntegerField(null=True, blank=True)
    contact_name = models.CharField(max_length=120, blank=True, default="")
    contact_phone = models.CharField(max_length=20, blank=True, default="")
    extra_fields = models.JSONField(default=dict, blank=True)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHODS)
    payment_status = models.CharField(max_length=12, choices=PAYMENT_STATUSES, default="PENDING")
    delivery_pin = models.TextField(blank=True, default="", help_text="AES-GCM ciphertext; shown to the customer only")
    eta_min_minutes = models.PositiveIntegerField(null=True, blank=True)
    eta_max_minutes = models.PositiveIntegerField(null=True, blank=True)
    promised_by = models.DateTimeField(null=True, blank=True)
    placed_at = models.DateTimeField(auto_now_add=True, db_index=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    ready_at = models.DateTimeField(null=True, blank=True)
    picked_up_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.CharField(max_length=240, blank=True, default="")
    admin_notes = models.TextField(blank=True, default="")
    share_token = models.CharField(max_length=32, unique=True, null=True, blank=True)
    loyalty_points_earned = models.IntegerField(default=0)
    loyalty_points_redeemed = models.IntegerField(default=0)
    rated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-placed_at"]
        indexes = [models.Index(fields=["user", "-placed_at"]), models.Index(fields=["status", "-placed_at"]), models.Index(fields=["store", "status"])]

    def __str__(self) -> str:
        return self.number


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey("catalog.Product", null=True, on_delete=models.SET_NULL, related_name="+")
    variant = models.ForeignKey("catalog.ProductVariant", null=True, on_delete=models.SET_NULL, related_name="+")
    sku = models.CharField(max_length=64)
    title = models.CharField(max_length=160)
    brand = models.CharField(max_length=80, blank=True, default="")
    options_label = models.CharField(max_length=120, blank=True, default="")
    image = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    qty = models.PositiveIntegerField()
    retail_unit_price = models.BigIntegerField()
    unit_price = models.BigIntegerField()
    price_basis = models.CharField(max_length=12, default="retail")
    tier = models.JSONField(null=True, blank=True)
    line_total = models.BigIntegerField()
    savings = models.BigIntegerField(default=0)
    reviewed = models.BooleanField(default=False)


class OrderEvent(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="events")
    type = models.CharField(max_length=40)
    from_status = models.CharField(max_length=20, blank=True, default="")
    to_status = models.CharField(max_length=20, blank=True, default="")
    actor_type = models.CharField(max_length=10)
    actor_id = models.CharField(max_length=64, blank=True, default="")
    data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]


class Payment(UUIDModel):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="payments")
    method = models.CharField(max_length=20, choices=PAYMENT_METHODS)
    provider = models.CharField(max_length=24, default="cash")
    status = models.CharField(max_length=12, choices=PAYMENT_STATUSES, default="PENDING")
    amount = models.BigIntegerField()
    currency = models.CharField(max_length=3)
    reference = models.CharField(max_length=60, unique=True)
    provider_ref = models.CharField(max_length=120, blank=True, default="", db_index=True)
    checkout_url = models.URLField(max_length=1000, blank=True, default="")
    msisdn = models.CharField(max_length=20, blank=True, default="")
    raw = models.JSONField(default=dict, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    refunded_amount = models.BigIntegerField(default=0)


class WebhookEvent(models.Model):
    """Inbound webhook de-duplication."""

    provider = models.CharField(max_length=24)
    event_id = models.CharField(max_length=160)
    payload = models.JSONField()
    processed_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["provider", "event_id"], name="uniq_webhook_event")]


class PromoRedemption(models.Model):
    promo = models.ForeignKey(PromoCode, on_delete=models.CASCADE, related_name="redemptions")
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="+")
    order = models.OneToOneField(Order, on_delete=models.CASCADE, related_name="promo_redemption")
    discount = models.BigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class Review(UUIDModel):
    STATUSES = [("PENDING", "Pending"), ("PUBLISHED", "Published"), ("REJECTED", "Rejected")]
    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE, related_name="reviews")
    variant = models.ForeignKey("catalog.ProductVariant", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="reviews")
    order = models.ForeignKey(Order, null=True, blank=True, on_delete=models.SET_NULL, related_name="reviews")
    rating = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    title = models.CharField(max_length=100, blank=True, default="")
    body = models.TextField(blank=True, default="", max_length=2000)
    tags = models.JSONField(default=list, blank=True)
    media = models.ManyToManyField("media.Media", blank=True, related_name="+")
    status = models.CharField(max_length=10, choices=STATUSES, default="PENDING", db_index=True)
    verified = models.BooleanField(default=False)
    helpful_count = models.PositiveIntegerField(default=0)
    moderation_note = models.CharField(max_length=240, blank=True, default="")
    moderated_by = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["product", "user"], name="one_review_per_product")]
        indexes = [models.Index(fields=["product", "status", "-created_at"])]


class ReturnRequest(UUIDModel):
    STATUSES = [(s, s.title()) for s in ("REQUESTED", "APPROVED", "REJECTED", "RECEIVED", "REFUNDED", "EXCHANGED", "CANCELLED")]
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="returns")
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="returns")
    kind = models.CharField(max_length=10, choices=[("return", "Return"), ("exchange", "Exchange")], default="return")
    items = models.JSONField(default=list, help_text='[{"orderItemId": 1, "qty": 1, "exchangeVariantId": null}]')
    reason = models.CharField(max_length=40)
    comment = models.TextField(blank=True, default="")
    media = models.ManyToManyField("media.Media", blank=True, related_name="+")
    status = models.CharField(max_length=10, choices=STATUSES, default="REQUESTED", db_index=True)
    resolution_note = models.TextField(blank=True, default="")
    refund_amount = models.BigIntegerField(null=True, blank=True)
    handled_by = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")


class WholesaleApplication(UUIDModel):
    STATUSES = [("PENDING", "Pending"), ("APPROVED", "Approved"), ("REJECTED", "Rejected")]
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="wholesale_applications")
    business_name = models.CharField(max_length=120)
    tin = models.CharField(max_length=20)
    business_type = models.CharField(max_length=60, blank=True, default="")
    address = models.CharField(max_length=240, blank=True, default="")
    licence = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    expected_monthly_volume = models.CharField(max_length=40, blank=True, default="")
    status = models.CharField(max_length=10, choices=STATUSES, default="PENDING", db_index=True)
    review_note = models.TextField(blank=True, default="")
    reviewed_by = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)


class LoyaltyLedger(models.Model):
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="loyalty_entries")
    delta = models.IntegerField()
    reason = models.CharField(max_length=40)
    order = models.ForeignKey(Order, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    note = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
