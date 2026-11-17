from django.urls import path

from . import views as v

urlpatterns = [
    path("media/presign", v.PresignView.as_view()),
    path("media/complete", v.CompleteUploadView.as_view()),
    path("admin/media", v.MediaListView.as_view()),
    path("media/<uuid:media_id>", v.MediaDetailView.as_view()),
    path("media/<uuid:media_id>/enhance-preview", v.EnhancePreviewView.as_view()),
    path("media/<uuid:media_id>/hls.m3u8", v.HlsMasterView.as_view()),
    path("media/<uuid:media_id>/hls/<int:res>.m3u8", v.HlsVariantView.as_view()),
]
