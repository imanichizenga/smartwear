from __future__ import annotations

from rest_framework import serializers

from core.media_urls import media_out


class RequestOtpIn(serializers.Serializer):
    phone = serializers.CharField(max_length=32)


class VerifyOtpIn(serializers.Serializer):
    phone = serializers.CharField(max_length=32)
    code = serializers.CharField(max_length=12)
    deviceId = serializers.CharField(max_length=128, required=False, allow_blank=True)
    platform = serializers.ChoiceField(choices=["ios", "android", "web"], required=False)
    appVersion = serializers.CharField(max_length=24, required=False, allow_blank=True)


class GoogleIn(serializers.Serializer):
    idToken = serializers.CharField(max_length=4096)
    deviceId = serializers.CharField(max_length=128, required=False, allow_blank=True)
    platform = serializers.ChoiceField(choices=["ios", "android", "web"], required=False)
    appVersion = serializers.CharField(max_length=24, required=False, allow_blank=True)


class RefreshIn(serializers.Serializer):
    refreshToken = serializers.CharField(max_length=200)


class ProfileIn(serializers.Serializer):
    name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_null=True)
    locale = serializers.ChoiceField(choices=["en", "sw"], required=False)
    theme = serializers.ChoiceField(choices=["light", "dark", "system"], required=False)
    avatarMediaId = serializers.UUIDField(required=False, allow_null=True)
    coverMediaId = serializers.UUIDField(required=False, allow_null=True)
    notificationPrefs = serializers.DictField(child=serializers.BooleanField(), required=False)


class StyleProfileIn(serializers.Serializer):
    departments = serializers.ListField(child=serializers.ChoiceField(choices=["women", "men", "kids", "unisex"]), required=False, max_length=4)
    styles = serializers.ListField(child=serializers.CharField(max_length=40), required=False, max_length=12)
    sizes = serializers.DictField(child=serializers.CharField(max_length=12), required=False)
    fit = serializers.ChoiceField(choices=["fitted", "regular", "relaxed", "oversized"], required=False, allow_null=True)
    favouriteColors = serializers.ListField(child=serializers.CharField(max_length=24), required=False, max_length=12)
    skinType = serializers.ChoiceField(choices=["dry", "oily", "combination", "normal", "sensitive"], required=False, allow_null=True)
    skinTone = serializers.CharField(max_length=24, required=False, allow_null=True, allow_blank=True)
    undertone = serializers.ChoiceField(choices=["cool", "warm", "neutral", "olive"], required=False, allow_null=True)
    shadeMatches = serializers.DictField(child=serializers.CharField(max_length=40), required=False)
    hairType = serializers.CharField(max_length=24, required=False, allow_null=True, allow_blank=True)
    quizCompleted = serializers.BooleanField(required=False)


class AdminLoginIn(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(max_length=256)


class AdminCodeIn(serializers.Serializer):
    code = serializers.CharField(max_length=12, required=False, allow_blank=True)
    recoveryCode = serializers.CharField(max_length=40, required=False, allow_blank=True)


class AdminReauthIn(serializers.Serializer):
    password = serializers.CharField(max_length=256, required=False, allow_blank=True)
    code = serializers.CharField(max_length=12, required=False, allow_blank=True)


class AdminBootstrapIn(serializers.Serializer):
    email = serializers.EmailField()
    name = serializers.CharField(max_length=120)
    password = serializers.CharField(min_length=12, max_length=256)


class AcceptInviteIn(serializers.Serializer):
    token = serializers.CharField(max_length=200)
    name = serializers.CharField(max_length=120)
    password = serializers.CharField(min_length=12, max_length=256)


class InviteIn(serializers.Serializer):
    email = serializers.EmailField()
    name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    roleKey = serializers.CharField(max_length=32)


def user_out(user, *, private: bool = True) -> dict:
    rider = getattr(user, "rider", None) if user.is_rider else None
    providers = sorted(user.identities.values_list("provider", flat=True)) if private else []
    from core import settings_service

    tiers = settings_service.get("loyalty").tiers
    tier = None
    next_tier = None
    for t in sorted(tiers, key=lambda t: t.minPoints):
        if user.loyalty_points >= t.minPoints:
            tier = t
        elif next_tier is None:
            next_tier = t
    return {
        "id": str(user.id),
        "name": user.name,
        "displayName": user.display_name,
        "phone": user.phone,
        "phoneVerified": bool(user.phone_verified_at),
        "email": user.email,
        "avatar": media_out(user.avatar) if user.avatar_id else None,
        "cover": media_out(user.cover) if user.cover_id else None,
        "customerType": user.customer_type,
        "wholesaleApproved": user.wholesale_approved,
        "locale": user.locale,
        "theme": user.theme,
        "styleProfile": user.style_profile or {},
        "quizCompleted": bool(user.quiz_completed_at),
        "notificationPrefs": user.notification_prefs or {},
        "loyalty": {
            "points": user.loyalty_points,
            "tier": tier.name if tier else None,
            "perk": tier.perk if tier else None,
            "nextTier": next_tier.name if next_tier else None,
            "pointsToNext": (next_tier.minPoints - user.loyalty_points) if next_tier else None,
        },
        "identities": providers,
        "roles": ["customer"] + (["rider"] if rider else []),
        "rider": {"id": str(rider.id), "status": rider.status, "approved": rider.status == "ACTIVE"} if rider else None,
        "createdAt": user.created_at.isoformat(),
    }


def admin_out(admin) -> dict:
    return {
        "id": str(admin.id),
        "email": admin.email,
        "name": admin.name,
        "role": {"key": admin.role.key, "name": admin.role.name},
        "permissions": sorted(admin.permissions) if not admin.is_super_admin else ["*"],
        "mfaEnabled": admin.mfa_enabled,
        "isActive": admin.is_active,
        "lastLoginAt": admin.last_login.isoformat() if admin.last_login else None,
        "createdAt": admin.created_at.isoformat(),
    }
