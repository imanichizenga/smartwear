from django.db import migrations, models


def legacy_support_threads(apps, schema_editor):
    """Support threads without an order stay readable but closed (they can't receive new messages). If several
    support threads point at the same order, keep the newest one attached and detach the rest."""
    ChatThread = apps.get_model("notifications", "ChatThread")
    ChatThread.objects.filter(kind="support", order__isnull=True).update(status="closed")
    seen = set()
    for t in ChatThread.objects.filter(kind="support", order__isnull=False).order_by("order_id", "-last_message_at", "-created_at"):
        if t.order_id in seen:
            ChatThread.objects.filter(pk=t.pk).update(order=None, status="closed")
        else:
            seen.add(t.order_id)


class Migration(migrations.Migration):
    dependencies = [("notifications", "0001_initial")]

    operations = [
        migrations.AddField(model_name="chatthread", name="user_read_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="chatthread", name="staff_read_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="chatmessage", name="client_id", field=models.CharField(blank=True, default="", max_length=64)),
        migrations.RunPython(legacy_support_threads, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="chatthread",
            constraint=models.UniqueConstraint(condition=models.Q(("kind", "support"), ("order__isnull", False)), fields=("order",), name="one_support_chat_per_order"),
        ),
        migrations.AddConstraint(
            model_name="chatmessage",
            constraint=models.UniqueConstraint(condition=models.Q(("client_id", ""), _negated=True), fields=("thread", "client_id"), name="uniq_chat_client_id"),
        ),
    ]
