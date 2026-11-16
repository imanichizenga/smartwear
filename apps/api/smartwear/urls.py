from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView

urlpatterns = [
    path("", include("core.urls")),
    path("docs/openapi.json", SpectacularAPIView.as_view(), name="openapi"),
    # Browsable index of every endpoint: /api/ (Swagger UI), /api/redoc/, raw schema at /api/schema/.
    path("api/", SpectacularSwaggerView.as_view(url_name="openapi"), name="api-docs"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="openapi"), name="api-redoc"),
    path("api/schema/", SpectacularAPIView.as_view(), name="api-schema"),
    path("v1/", include("accounts.urls")),
    path("v1/", include("catalog.urls")),
    path("v1/", include("media.urls")),
    path("v1/", include("commerce.urls")),
    path("v1/", include("delivery.urls")),
    path("v1/", include("marketing.urls")),
    path("v1/", include("notifications.urls")),
]
