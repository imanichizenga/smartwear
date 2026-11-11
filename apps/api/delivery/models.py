from __future__ import annotations

from django.contrib.gis.db import models as gis
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

from core.models import TimeStamped, UUIDModel

VEHICLE_TYPES = [("MOTORBIKE", "Motorbike"), ("BICYCLE", "Bicycle"), ("CAR", "Car"), ("ON_FOOT", "On foot")]
JOB_STATUSES = [(s, s.replace("_", " ").title()) for s in ("SEARCHING", "OFFERED", "ACCEPTED", "AT_STORE", "PICKED_UP", "EN_ROUTE", "ARRIVED", "COMPLETED", "CANCELLED", "NO_RIDER")]


class DeliveryZone(UUIDModel):
    name = models.CharField(max_length=80)
    polygon = gis.PolygonField(geography=True, srid=4326)
    flat_fee = models.BigIntegerField(null=True, blank=True, help_text="Overrides the distance formula")
    surcharge = models.BigIntegerField(default=0)
    serviceable = models.BooleanField(default=True)
    priority = models.IntegerField(default=0)
    color = models.CharField(max_length=7, default="#B8955A")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-priority", "name"]


class Rider(UUIDModel):
    STATUSES = [("PENDING", "Pending approval"), ("ACTIVE", "Active"), ("SUSPENDED", "Suspended"), ("OFFBOARDED", "Offboarded")]
    PRESENCE = [("OFFLINE", "Offline"), ("IDLE", "Online · idle"), ("ASSIGNED", "Assigned"), ("EN_ROUTE", "En route")]
    user = models.OneToOneField("accounts.User", on_delete=models.CASCADE, related_name="rider")
    status = models.CharField(max_length=12, choices=STATUSES, default="PENDING", db_index=True)
    presence = models.CharField(max_length=10, choices=PRESENCE, default="OFFLINE", db_index=True)
    photo = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    national_id = models.TextField(blank=True, default="", help_text="NIDA number — AES-GCM ciphertext")
    national_id_last4 = models.CharField(max_length=4, blank=True, default="")
    licence_number = models.CharField(max_length=40, blank=True, default="")
    zone = models.ForeignKey(DeliveryZone, null=True, blank=True, on_delete=models.SET_NULL, related_name="riders")
    home_store = models.ForeignKey("inventory.Store", null=True, blank=True, on_delete=models.SET_NULL, related_name="riders")
    payout_method = models.CharField(max_length=20, blank=True, default="", help_text="mobile_money | bank")
    payout_details = models.TextField(blank=True, default="", help_text="AES-GCM ciphertext JSON")
    rating_avg = models.FloatField(default=5.0)
    rating_count = models.PositiveIntegerField(default=0)
    deliveries_count = models.PositiveIntegerField(default=0)
    last_location = gis.PointField(geography=True, srid=4326, null=True, blank=True)
    last_heading = models.FloatField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    online_since = models.DateTimeField(null=True, blank=True)
    invited_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    suspended_reason = models.CharField(max_length=240, blank=True, default="")
    notes = models.TextField(blank=True, default="")

    def __str__(self) -> str:
        return self.user.name or self.user.phone or str(self.id)


class Vehicle(TimeStamped):
    rider = models.ForeignKey(Rider, on_delete=models.CASCADE, related_name="vehicles")
    type = models.CharField(max_length=10, choices=VEHICLE_TYPES)
    plate = models.CharField(max_length=16, blank=True, default="")
    color = models.CharField(max_length=24, blank=True, default="")
    make = models.CharField(max_length=40, blank=True, default="")
    is_primary = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["rider"], condition=Q(is_primary=True), name="one_primary_vehicle")]


class RiderDocument(TimeStamped):
    KINDS = [("national_id", "National ID (NIDA)"), ("licence", "Driving licence"), ("insurance", "Insurance"), ("vehicle_registration", "Vehicle registration"), ("other", "Other")]
    rider = models.ForeignKey(Rider, on_delete=models.CASCADE, related_name="documents")
    kind = models.CharField(max_length=24, choices=KINDS)
    media = models.ForeignKey("media.Media", on_delete=models.PROTECT, related_name="+")
    number = models.CharField(max_length=60, blank=True, default="")
    expires_at = models.DateField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")


class DeliveryJob(UUIDModel):
    order = models.OneToOneField("commerce.Order", on_delete=models.CASCADE, related_name="delivery")
    rider = models.ForeignKey(Rider, null=True, blank=True, on_delete=models.SET_NULL, related_name="jobs")
    status = models.CharField(max_length=10, choices=JOB_STATUSES, default="SEARCHING", db_index=True)
    store = models.ForeignKey("inventory.Store", on_delete=models.PROTECT, related_name="+")
    pickup = gis.PointField(geography=True, srid=4326)
    dropoff = gis.PointField(geography=True, srid=4326)
    distance_m = models.PositiveIntegerField(default=0)
    earning = models.BigIntegerField(default=0)
    currency = models.CharField(max_length=3, default="TZS")
    round = models.PositiveSmallIntegerField(default=0)
    offered_rider_ids = models.JSONField(default=list, blank=True)
    searching_since = models.DateTimeField(null=True, blank=True)
    no_rider_alerted_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    at_store_at = models.DateTimeField(null=True, blank=True)
    picked_up_at = models.DateTimeField(null=True, blank=True)
    en_route_at = models.DateTimeField(null=True, blank=True)
    arrived_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.CharField(max_length=240, blank=True, default="")
    route_polyline = models.TextField(blank=True, default="")
    route_leg = models.CharField(max_length=12, blank=True, default="", help_text="to_store | to_client")
    eta_seconds = models.PositiveIntegerField(null=True, blank=True)
    eta_updated_at = models.DateTimeField(null=True, blank=True)
    nearby_notified_at = models.DateTimeField(null=True, blank=True)
    pin_attempts = models.PositiveSmallIntegerField(default=0)
    pickup_photo = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    proof_photo = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    manual_assigned_by = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        indexes = [models.Index(fields=["rider", "status"]), models.Index(fields=["status", "searching_since"])]


class DeliveryOffer(models.Model):
    STATUSES = [(s, s.title()) for s in ("PENDING", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN")]
    job = models.ForeignKey(DeliveryJob, on_delete=models.CASCADE, related_name="offers")
    rider = models.ForeignKey(Rider, on_delete=models.CASCADE, related_name="offers")
    status = models.CharField(max_length=10, choices=STATUSES, default="PENDING", db_index=True)
    round = models.PositiveSmallIntegerField(default=0)
    distance_to_store_m = models.PositiveIntegerField(default=0)
    earning = models.BigIntegerField(default=0)
    offered_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    responded_at = models.DateTimeField(null=True, blank=True)
    decline_reason = models.CharField(max_length=60, blank=True, default="")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["job", "rider"], condition=Q(status="PENDING"), name="one_pending_offer_per_rider")]
        indexes = [models.Index(fields=["rider", "status"])]


class RiderLocationPing(models.Model):
    rider = models.ForeignKey(Rider, on_delete=models.CASCADE, related_name="pings")
    job = models.ForeignKey(DeliveryJob, null=True, blank=True, on_delete=models.SET_NULL, related_name="pings")
    location = gis.PointField(geography=True, srid=4326)
    heading = models.FloatField(null=True, blank=True)
    speed_mps = models.FloatField(null=True, blank=True)
    accuracy_m = models.FloatField(null=True, blank=True)
    battery = models.FloatField(null=True, blank=True)
    recorded_at = models.DateTimeField(db_index=True)

    class Meta:
        indexes = [models.Index(fields=["rider", "-recorded_at"]), models.Index(fields=["job", "recorded_at"])]


class RiderRating(models.Model):
    job = models.OneToOneField(DeliveryJob, on_delete=models.CASCADE, related_name="rating")
    rider = models.ForeignKey(Rider, on_delete=models.CASCADE, related_name="ratings")
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="+")
    rating = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    tags = models.JSONField(default=list, blank=True)
    comment = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
