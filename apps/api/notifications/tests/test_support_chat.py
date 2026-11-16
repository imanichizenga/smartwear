"""Order-based support chat: one thread per order, idempotent sends, read receipts, presence-aware pushes."""
from __future__ import annotations

import pytest

from accounts.models import User
from catalog.tests.test_products import store
from commerce.models import Order
from conftest import admin_client, user_client
from notifications.models import ChatMessage, ChatThread

pytestmark = pytest.mark.django_db


def _order(user, number="SW-1001"):
    from inventory.models import Store

    s = Store.objects.first() or store()
    return Order.objects.create(number=number, user=user, store=s, currency="TZS", subtotal=50000, total=50000, payment_method="CASH_ON_DELIVERY", delivery_option={})


def test_one_support_thread_per_order_and_ownership(customer):
    o1, o2 = _order(customer), _order(customer, "SW-1002")
    c = user_client(customer)
    t1 = c.post("/v1/chat/threads", {"orderId": str(o1.id), "body": "Where is my order?"}, format="json").json()
    again = c.post("/v1/chat/threads", {"orderId": str(o1.id)}, format="json").json()
    t2 = c.post("/v1/chat/threads", {"orderId": str(o2.id)}, format="json").json()
    assert t1["id"] == again["id"] != t2["id"]
    assert t1["order"]["number"] == "SW-1001" and t1["lastMessage"]["body"] == "Where is my order?"
    # Support needs an order, and it must be yours.
    assert c.post("/v1/chat/threads", {"body": "hi"}, format="json").status_code == 400
    other = User.objects.create(phone="+255700000999", name="Other")
    assert user_client(other).post("/v1/chat/threads", {"orderId": str(o1.id)}, format="json").status_code == 404


def test_idempotent_send_by_client_id(customer):
    o = _order(customer)
    c = user_client(customer)
    t = c.post("/v1/chat/threads", {"orderId": str(o.id)}, format="json").json()
    a = c.post(f"/v1/chat/threads/{t['id']}/messages", {"body": "Hello 👋", "clientId": "c-1"}, format="json")
    b = c.post(f"/v1/chat/threads/{t['id']}/messages", {"body": "Hello 👋", "clientId": "c-1"}, format="json")
    assert a.status_code == 201 and b.status_code == 200 and a.json()["id"] == b.json()["id"]
    assert a.json()["clientId"] == "c-1" and ChatMessage.objects.filter(thread_id=t["id"]).count() == 1


def test_read_receipts_and_admin_inbox(customer, admin_user):
    o = _order(customer)
    c = user_client(customer)
    t = c.post("/v1/chat/threads", {"orderId": str(o.id), "body": "Size question"}, format="json").json()
    a = admin_client(admin_user)
    inbox = a.get("/v1/admin/support?q=SW-1001").json()
    assert [x["id"] for x in inbox["items"]] == [t["id"]] and inbox["items"][0]["unread"] == 1
    assert inbox["items"][0]["order"]["items"] == [] and inbox["items"][0]["customer"]["name"] == "Neema Mushi"
    assert a.get("/v1/admin/support?q=SW-9999").json()["items"] == []
    # Staff opening the thread = read: the customer sees it as read.
    a.get(f"/v1/chat/threads/{t['id']}/messages")
    seen = c.get(f"/v1/chat/threads/{t['id']}/messages").json()["thread"]
    assert seen["otherReadAt"] is not None and seen["otherReadAt"] >= seen["lastMessage"]["at"]
    assert a.post(f"/v1/chat/threads/{t['id']}/messages", {"body": "We have it in M"}, format="json").status_code == 201
    assert c.get("/v1/chat/support").json()["items"][0]["thread"]["unread"] == 1
    assert c.post(f"/v1/chat/threads/{t['id']}/read", {}, format="json").status_code == 200
    assert ChatThread.objects.get(id=t["id"]).unread_for_user == 0


def test_admin_opens_thread_from_order(customer, admin_user):
    o = _order(customer)
    a = admin_client(admin_user)
    t = a.post("/v1/admin/support", {"orderId": str(o.id), "body": "Your parcel is ready"}, format="json").json()
    assert t["order"]["number"] == "SW-1001" and t["assignedTo"]
    mine = user_client(customer).post("/v1/chat/threads", {"orderId": str(o.id)}, format="json").json()
    assert mine["id"] == t["id"]


def test_legacy_thread_without_order_is_read_only(customer):
    t = ChatThread.objects.create(kind="support", user=customer, status="closed")
    c = user_client(customer)
    assert c.get(f"/v1/chat/threads/{t.id}/messages").json()["thread"]["canReply"] is False
    r = c.post(f"/v1/chat/threads/{t.id}/messages", {"body": "hello"}, format="json")
    assert r.status_code == 409 and r.json()["code"] == "thread_closed"


def test_no_push_while_customer_views_the_thread(customer, admin_user, monkeypatch, django_capture_on_commit_callbacks):
    sent = []
    monkeypatch.setattr("notifications.push.send_to_user", lambda user, title, body, data=None, **kw: sent.append(body))
    o = _order(customer)
    t = user_client(customer).post("/v1/chat/threads", {"orderId": str(o.id)}, format="json").json()
    a = admin_client(admin_user)
    with django_capture_on_commit_callbacks(execute=True):
        a.post(f"/v1/chat/threads/{t['id']}/messages", {"body": "first"}, format="json")
    assert sent == ["first"]
    from notifications.presence import set_viewing

    set_viewing(t["id"], "user", str(customer.id), True)
    with django_capture_on_commit_callbacks(execute=True):
        a.post(f"/v1/chat/threads/{t['id']}/messages", {"body": "second"}, format="json")
    assert sent == ["first"]
    customer.notification_prefs = {"chat": False}
    customer.save()
    set_viewing(t["id"], "user", str(customer.id), False)
    with django_capture_on_commit_callbacks(execute=True):
        a.post(f"/v1/chat/threads/{t['id']}/messages", {"body": "third"}, format="json")
    assert sent == ["first"]


def test_presence_reported_to_both_sides(customer):
    from notifications import presence

    o = _order(customer)
    c = user_client(customer)
    t = c.post("/v1/chat/threads", {"orderId": str(o.id)}, format="json").json()
    assert t["presence"]["online"] is False
    presence.touch("staff", "agent-1")
    assert c.get("/v1/chat/support").json()["presence"]["online"] is True
    presence.leave("staff", "agent-1")
    p = c.get("/v1/chat/support").json()["presence"]
    assert p["online"] is False and p["lastSeenAt"]
