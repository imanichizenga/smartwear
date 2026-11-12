from django.urls import path

from . import views as v

urlpatterns = [
    path("rider/me", v.RiderMeView.as_view()),
    path("rider/presence", v.RiderPresenceView.as_view()),
    path("rider/location", v.RiderLocationView.as_view()),
    path("rider/offers/<int:offer_id>/<str:action>", v.RiderOfferView.as_view()),
    path("rider/jobs/<uuid:jid>", v.RiderJobView.as_view()),
    path("rider/history", v.RiderHistoryView.as_view()),
    path("rider/documents", v.RiderDocumentsView.as_view()),
    path("admin/riders", v.AdminRidersView.as_view()),
    path("admin/riders/<uuid:rid>", v.AdminRiderView.as_view()),
    path("admin/riders/<uuid:rid>/invite", v.AdminRiderInviteView.as_view()),
    path("admin/riders/<uuid:rid>/route", v.AdminRiderRouteView.as_view()),
    path("admin/payouts", v.AdminPayoutsView.as_view()),
    path("admin/payouts/fee", v.AdminPayoutFeeView.as_view()),
    path("admin/payouts/<uuid:pid>/sync", v.AdminPayoutSyncView.as_view()),
    path("admin/dispatch", v.AdminDispatchView.as_view()),
    path("admin/dispatch/jobs/<uuid:jid>/auto", v.AdminDispatchAutoView.as_view()),
    path("admin/zones", v.AdminZonesView.as_view()),
    path("admin/zones/<uuid:zid>", v.AdminZoneView.as_view()),
    path("admin/stores", v.AdminStoresView.as_view()),
    path("admin/stores/<uuid:sid>", v.AdminStoreView.as_view()),
    path("admin/inventory", v.AdminInventoryView.as_view()),
    path("admin/inventory/movements", v.AdminStockMovementsView.as_view()),
    path("admin/inventory/transfers", v.AdminTransfersView.as_view()),
    path("admin/inventory/transfers/<uuid:tid>/<str:action>", v.AdminTransferView.as_view()),
]
