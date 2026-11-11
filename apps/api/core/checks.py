from django.core.checks import Error, register

from .crypto import parse_key_ring


@register()
def master_key_check(app_configs, **kwargs):
    from django.conf import settings

    try:
        parse_key_ring(settings.MASTER_ENCRYPTION_KEY)
    except Exception as e:  # noqa: BLE001
        return [Error(f"MASTER_ENCRYPTION_KEY is invalid: {e}", id="core.E001")]
    return []
