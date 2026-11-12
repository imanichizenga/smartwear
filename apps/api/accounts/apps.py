from django.apps import AppConfig
from django.db.models.signals import post_migrate


def _sync_roles(sender, **kwargs):
    # System roles follow accounts/rbac.py on every deploy, so new permissions reach existing installs.
    from .rbac import ensure_roles

    ensure_roles()


class AccountsConfig(AppConfig):
    name = "accounts"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        post_migrate.connect(_sync_roles, sender=self)
