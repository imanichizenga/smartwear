"""Sign-in, account linking and merge."""
from __future__ import annotations

import logging

from django.db import IntegrityError, transaction
from django.db.models import ForeignKey, OneToOneField
from django.utils import timezone

from core.audit import audit
from core.exceptions import ApiError

from .models import AuthIdentity, Session, User

logger = logging.getLogger("smartwear.accounts")


def login_with_phone(phone: str) -> tuple[User, bool]:
    now = timezone.now()
    ident = AuthIdentity.objects.select_related("user").filter(provider="phone", subject=phone, user__deleted_at__isnull=True).first()
    if ident:
        ident.last_used_at = now
        ident.save(update_fields=["last_used_at"])
        user = ident.user
        if not user.phone_verified_at:
            user.phone_verified_at = now
            user.save(update_fields=["phone_verified_at"])
        return user, False
    # Riders are pre-registered by Admin with only the phone on the user row.
    user = User.objects.filter(phone=phone, deleted_at__isnull=True).first()
    created = user is None
    with transaction.atomic():
        if user is None:
            user = User.objects.create(phone=phone, phone_verified_at=now)
        else:
            user.phone_verified_at = now
            user.save(update_fields=["phone_verified_at"])
        AuthIdentity.objects.create(user=user, provider="phone", subject=phone, last_used_at=now)
    return user, created


def login_with_google(claims: dict) -> tuple[User, bool]:
    now = timezone.now()
    sub = claims["sub"]
    email = claims.get("email") if claims.get("email_verified") else None
    ident = AuthIdentity.objects.select_related("user").filter(provider="google", subject=sub, user__deleted_at__isnull=True).first()
    if ident:
        ident.last_used_at = now
        ident.email = email or ident.email
        ident.save(update_fields=["last_used_at", "email"])
        user = ident.user
        changed = []
        if not user.name and claims.get("name"):
            user.name = claims["name"][:120]
            changed.append("name")
        if not user.email and email:
            user.email = email
            changed.append("email")
        if changed:
            user.save(update_fields=changed)
        return user, False
    # Per DECISIONS.md: never auto-merge by email. A new Google identity is a new account until linked explicitly.
    with transaction.atomic():
        user = User.objects.create(email=email, name=(claims.get("name") or "")[:120])
        AuthIdentity.objects.create(user=user, provider="google", subject=sub, email=email, data={"picture": claims.get("picture")}, last_used_at=now)
    return user, True


def link_identity(user: User, provider: str, subject: str, *, email: str | None = None, request=None) -> dict:
    """Attach a phone or Google identity to `user`. If it belongs to another account, merge that account in."""
    existing = AuthIdentity.objects.select_related("user").filter(provider=provider, subject=subject).first()
    if existing and existing.user_id == user.id:
        return {"linked": True, "merged": False}
    if AuthIdentity.objects.filter(user=user, provider=provider).exists():
        raise ApiError.conflict("identity_exists", f"This account already has a {provider} sign-in. Remove it first.")
    merged = False
    with transaction.atomic():
        if existing:
            other = existing.user
            keep, drop = (user, other) if user.created_at <= other.created_at else (other, user)
            merge_users(keep, drop, request=request)
            merged = True
            user = keep
            if provider == "phone" or AuthIdentity.objects.filter(user=keep, provider=provider, subject=subject).exists():
                pass
        if not AuthIdentity.objects.filter(provider=provider, subject=subject).exists():
            AuthIdentity.objects.create(user=user, provider=provider, subject=subject, email=email, last_used_at=timezone.now())
        if provider == "phone":
            User.objects.filter(pk=user.pk).update(phone=subject, phone_verified_at=timezone.now())
    audit("account.link", "user", user.id, request=request, user=user, meta={"provider": provider, "merged": merged})
    return {"linked": True, "merged": merged, "userId": str(user.id)}


def merge_users(keep: User, drop: User, *, request=None) -> None:
    """
    Merge rules (docs/DECISIONS.md): the older account survives; every row that references the
    younger account is re-pointed (orders, wishlists, places, reviews, chats, loyalty...). Rows that
    would violate a uniqueness rule on the survivor (e.g. a second cart) are folded or dropped.
    Loyalty points add up; profile fields fill gaps only.
    """
    if keep.pk == drop.pk:
        return
    for rel in User._meta.related_objects:
        if not isinstance(rel.field, (ForeignKey, OneToOneField)) or rel.related_model is User:
            continue
        model, fname = rel.related_model, rel.field.name
        if model is Session:
            continue
        if isinstance(rel.field, OneToOneField):
            if not model.objects.filter(**{fname: keep}).exists():
                model.objects.filter(**{fname: drop}).update(**{fname: keep})
            continue
        for obj in model.objects.filter(**{fname: drop}):
            try:
                with transaction.atomic():
                    setattr(obj, fname, keep)
                    obj.save(update_fields=[fname])
            except IntegrityError:
                hook = getattr(model, "merge_conflict", None)
                if hook:
                    hook(obj, keep)
                else:
                    obj.delete()
    fill = {f: getattr(drop, f) for f in ("name", "email", "phone", "avatar_id") if not getattr(keep, f) and getattr(drop, f)}
    for k, v in fill.items():
        setattr(keep, k, v)
    keep.loyalty_points += drop.loyalty_points
    if drop.customer_type == "WHOLESALE" and drop.wholesale_approved:
        keep.customer_type, keep.wholesale_approved = "WHOLESALE", True
    keep.style_profile = {**(drop.style_profile or {}), **(keep.style_profile or {})}
    keep.save()
    Session.objects.filter(user=drop, revoked_at__isnull=True).update(revoked_at=timezone.now(), revoke_reason="merged")
    drop.deleted_at = timezone.now()
    drop.merged_into = keep
    drop.phone = None
    drop.loyalty_points = 0
    drop.save(update_fields=["deleted_at", "merged_into", "phone", "loyalty_points"])
    audit("account.merge", "user", keep.id, request=request, meta={"merged": str(drop.id)}, actor_type="system")


def delete_account(user: User, request=None) -> None:
    """Right to erasure: anonymise PII, keep order rows for accounting (with snapshots, no PII)."""
    from .tokens import revoke_all

    revoke_all(user, "account_deleted")
    AuthIdentity.objects.filter(user=user).delete()
    user.name, user.email, user.phone = "", None, None
    user.avatar = None
    user.cover = None
    user.style_profile = {}
    user.deleted_at = timezone.now()
    user.save()
    audit("account.delete", "user", user.id, request=request, user=user)
