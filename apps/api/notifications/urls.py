from django.urls import path

from . import views as v

urlpatterns = [
    path("push-tokens", v.PushTokenView.as_view()),
    path("me/notifications", v.InboxView.as_view()),
    path("chat/threads", v.ThreadsView.as_view()),
    path("chat/threads/<uuid:tid>/messages", v.ThreadMessagesView.as_view()),
    path("admin/support", v.AdminSupportInboxView.as_view()),
    path("admin/support/<uuid:tid>", v.AdminThreadView.as_view()),
    path("admin/push-devices", v.AdminPushTokenStatusView.as_view()),
]
