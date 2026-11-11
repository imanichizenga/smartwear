from django.urls import path

from . import views as v

urlpatterns = [
    path("auth/otp/request", v.OtpRequestView.as_view()),
    path("auth/otp/verify", v.OtpVerifyView.as_view()),
    path("auth/google", v.GoogleLoginView.as_view()),
    path("auth/refresh", v.RefreshView.as_view()),
    path("auth/logout", v.LogoutView.as_view()),
    path("me", v.MeView.as_view()),
    path("me/style-profile", v.StyleProfileView.as_view()),
    path("me/sessions", v.SessionsView.as_view()),
    path("me/sessions/<uuid:session_id>", v.SessionsView.as_view()),
    path("me/link/phone/request", v.LinkPhoneRequestView.as_view()),
    path("me/link/phone/verify", v.LinkPhoneVerifyView.as_view()),
    path("me/link/google", v.LinkGoogleView.as_view()),
    path("me/export", v.DataExportView.as_view()),
    path("admin/auth/login", v.AdminLoginView.as_view()),
    path("admin/auth/bootstrap", v.AdminBootstrapView.as_view()),
    path("admin/auth/accept-invite", v.AdminAcceptInviteView.as_view()),
    path("admin/auth/mfa/setup", v.AdminMfaSetupView.as_view()),
    path("admin/auth/mfa/confirm", v.AdminMfaConfirmView.as_view()),
    path("admin/auth/mfa/verify", v.AdminMfaVerifyView.as_view()),
    path("admin/auth/reauth", v.AdminReauthView.as_view()),
    path("admin/auth/me", v.AdminMeView.as_view()),
    path("admin/auth/logout", v.AdminLogoutView.as_view()),
    path("admin/auth/sessions", v.AdminSessionsView.as_view()),
    path("admin/auth/sessions/<uuid:session_id>", v.AdminSessionsView.as_view()),
    path("admin/team", v.TeamView.as_view()),
    path("admin/team/invites", v.TeamInviteView.as_view()),
    path("admin/team/<uuid:admin_id>", v.TeamMemberView.as_view()),
]
