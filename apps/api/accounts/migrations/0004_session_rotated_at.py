from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0003_seed_roles")]

    operations = [
        migrations.AddField(model_name="session", name="rotated_at", field=models.DateTimeField(blank=True, null=True)),
    ]
