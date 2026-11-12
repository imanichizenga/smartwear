from django.urls import path

from . import views as v

urlpatterns = [
    path("health", v.HealthView.as_view()),
    path("ready", v.ReadyView.as_view()),
    path("v1/config/public", v.PublicConfigView.as_view()),
    path("v1/admin/maps/config", v.AdminMapsConfigView.as_view()),
    path("v1/admin/settings", v.SettingsGroupsView.as_view()),
    path("v1/admin/settings/status", v.IntegrationStatusView.as_view()),
    path("v1/admin/settings/<str:group>", v.SettingsGroupView.as_view()),
    path("v1/admin/settings/<str:group>/reveal", v.SettingsRevealView.as_view()),
    path("v1/admin/settings/<str:group>/test", v.SettingsTestView.as_view()),
    path("v1/admin/audit", v.AuditLogView.as_view()),
]
