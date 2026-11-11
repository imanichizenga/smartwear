from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = "core"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self) -> None:  # pragma: no cover
        from . import checks  # noqa: F401
