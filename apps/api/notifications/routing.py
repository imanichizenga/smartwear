from django.urls import path

from .consumers import RealtimeConsumer

websocket_urlpatterns = [path("realtime/", RealtimeConsumer.as_asgi())]
