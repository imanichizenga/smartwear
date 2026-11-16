from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("commerce", "0003_order_number_seq")]

    operations = [
        migrations.AddField(
            model_name="order",
            name="location_mode",
            field=models.CharField(choices=[("automatic", "Automatic (map)"), ("manual", "Manual (form)")], default="automatic", max_length=10),
        ),
        migrations.AddField(model_name="order", name="location_details", field=models.TextField(blank=True, default="", max_length=500)),
        migrations.AddField(model_name="order", name="delivery_notes", field=models.TextField(blank=True, default="", max_length=500)),
        migrations.AddField(model_name="order", name="location_accuracy_m", field=models.FloatField(blank=True, null=True)),
    ]
