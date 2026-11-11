from django.urls import path

from . import views as v

urlpatterns = [
    path("home", v.HomeView.as_view()),
    path("looks", v.LooksFeedView.as_view()),
    path("looks/<uuid:lid>/react/<str:kind>", v.LookReactView.as_view()),
    path("looks/<uuid:lid>/event/<str:event>", v.LookEventView.as_view()),
    path("stories", v.StoriesView.as_view()),
    path("stories/<uuid:sid>/seen", v.StorySeenView.as_view()),
    path("collections/<uuid:cid>/notify", v.DropNotifyView.as_view()),
    path("admin/home/sections", v.AdminHomeSectionsView.as_view()),
    path("admin/home/sections/reorder", v.AdminHomeReorderView.as_view()),
    path("admin/home/sections/<uuid:sid>", v.AdminHomeSectionView.as_view()),
    path("admin/home/preview", v.AdminHomePreviewView.as_view()),
    path("admin/stories", v.AdminStoriesView.as_view()),
    path("admin/stories/<uuid:sid>", v.AdminStoryView.as_view()),
    path("admin/banners", v.AdminBannersView.as_view()),
    path("admin/banners/<uuid:bid>", v.AdminBannerView.as_view()),
    path("admin/looks", v.AdminLooksView.as_view()),
    path("admin/looks/<uuid:lid>", v.AdminLookView.as_view()),
    path("admin/campaigns", v.AdminCampaignsView.as_view()),
    path("admin/campaigns/<uuid:cid>/<str:action>", v.AdminCampaignView.as_view()),
]
