from django.db import migrations


def forwards(apps, schema_editor):
    from accounts.rbac import ROLE_PERMISSIONS

    Role = apps.get_model("accounts", "Role")
    for key, (name, desc, perms) in ROLE_PERMISSIONS.items():
        Role.objects.update_or_create(key=key, defaults={"name": name, "description": desc, "permissions": list(perms), "is_system": True})


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_initial")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
