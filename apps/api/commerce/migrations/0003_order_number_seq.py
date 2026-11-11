from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("commerce", "0002_initial")]
    operations = [migrations.RunSQL("CREATE SEQUENCE IF NOT EXISTS commerce_order_number_seq START 1048576", "DROP SEQUENCE IF EXISTS commerce_order_number_seq")]
