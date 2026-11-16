from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("commerce", "0004_order_location_mode")]

    operations = [
        migrations.AddField(model_name="savedplace", name="is_default", field=models.BooleanField(default=False)),
    ]
