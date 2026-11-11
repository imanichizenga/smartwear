from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView

urlpatterns = [
    path("", include("core.urls")),
    path("docs/openapi.json", SpectacularAPIView.as_view(), name="openapi"),
    path("v1/", include("accounts.urls")),
    path("v1/", include("catalog.urls")),
    path("v1/", include("media.urls")),
    path("v1/", include("commerce.urls")),
    path("v1/", include("delivery.urls")),
    path("v1/", include("marketing.urls")),
    path("v1/", include("notifications.urls")),
]
