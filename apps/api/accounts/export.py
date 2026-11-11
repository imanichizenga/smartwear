"""Personal data export (Profile → Privacy → Download my data)."""
from __future__ import annotations

from django.apps import apps
from django.db.models import ForeignKey
from django.forms.models import model_to_dict

from .models import User
from .serializers import user_out

SKIP_FIELDS = {"refresh_hash", "previous_hash", "code_hash", "token_hash"}


def _plain(v):
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if isinstance(v, (list, dict, str, int, float, bool)) or v is None:
        return v
    return str(v)


def export_user(user: User) -> dict:
    out: dict = {"profile": user_out(user)}
    for model in apps.get_models():
        for f in model._meta.get_fields():
            if isinstance(f, ForeignKey) and f.related_model is User and model is not User:
                rows = model.objects.filter(**{f.name: user})[:5000]
                if rows:
                    key = f"{model._meta.app_label}.{model.__name__}"
                    out.setdefault(key, []).extend({k: _plain(v) for k, v in model_to_dict(r).items() if k not in SKIP_FIELDS} for r in rows)
    return out
