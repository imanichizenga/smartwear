from django.db import migrations


def forwards(apps, schema_editor):
    # Uses the live models deliberately: the seeder is the single source of the controlled taxonomy.
    from catalog.services.seed_taxonomy import ensure_taxonomy

    ensure_taxonomy(include_optional=False)


class Migration(migrations.Migration):
    dependencies = [("catalog", "0001_initial"), ("media", "0001_initial")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
