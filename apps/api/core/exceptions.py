"""Consistent error envelope: { code, message, details?, requestId }."""
from __future__ import annotations

import logging

from django.core.exceptions import PermissionDenied
from django.http import Http404

logger = logging.getLogger("smartwear.errors")


class ApiError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str, *, status_code: int | None = None, code: str | None = None, details: object = None):
        super().__init__(message)
        self.message = message
        if status_code:
            self.status_code = status_code
        if code:
            self.code = code
        self.details = details

    @classmethod
    def bad_request(cls, message: str, details: object = None):
        return cls(message, status_code=400, code="bad_request", details=details)

    @classmethod
    def unauthorized(cls, message: str = "Authentication required"):
        return cls(message, status_code=401, code="unauthorized")

    @classmethod
    def forbidden(cls, message: str = "You do not have permission to do that"):
        return cls(message, status_code=403, code="forbidden")

    @classmethod
    def not_found(cls, what: str = "Resource"):
        return cls(f"{what} not found", status_code=404, code="not_found")

    @classmethod
    def conflict(cls, code: str, message: str, details: object = None):
        return cls(message, status_code=409, code=code, details=details)

    @classmethod
    def too_many(cls, message: str = "Too many requests. Please slow down.", details: object = None):
        return cls(message, status_code=429, code="rate_limited", details=details)

    @classmethod
    def not_configured(cls, integration: str, hint: str | None = None):
        return cls(f"{integration} is not configured. {hint or 'An administrator must enter the credentials in Settings.'}", status_code=503, code="not_configured")

    @classmethod
    def upstream(cls, provider: str, message: str, details: object = None):
        return cls(f"{provider}: {message}", status_code=502, code="upstream_error", details=details)


def exception_handler(exc, context):
    from rest_framework import exceptions as drf
    from rest_framework.response import Response
    from rest_framework.views import exception_handler as drf_handler

    request = context.get("request")
    rid = getattr(getattr(request, "_request", request), "request_id", None)
    if isinstance(exc, ApiError):
        body = {"code": exc.code, "message": exc.message, "requestId": rid}
        if exc.details is not None:
            body["details"] = exc.details
        return Response(body, status=exc.status_code)
    if isinstance(exc, drf.ValidationError):
        return Response({"code": "validation_error", "message": "Request did not pass validation", "details": exc.detail, "requestId": rid}, status=400)
    if isinstance(exc, (drf.NotAuthenticated, drf.AuthenticationFailed)):
        return Response({"code": "unauthorized", "message": str(exc.detail), "requestId": rid}, status=401)
    if isinstance(exc, (drf.PermissionDenied, PermissionDenied)):
        return Response({"code": "forbidden", "message": str(getattr(exc, "detail", exc)) or "Forbidden", "requestId": rid}, status=403)
    if isinstance(exc, (drf.NotFound, Http404)):
        return Response({"code": "not_found", "message": str(getattr(exc, "detail", "Not found")), "requestId": rid}, status=404)
    if isinstance(exc, drf.Throttled):
        return Response({"code": "rate_limited", "message": "Too many requests. Please slow down.", "details": {"retryAfterSeconds": exc.wait}, "requestId": rid}, status=429)
    if isinstance(exc, drf.APIException):
        return Response({"code": getattr(exc, "default_code", "error"), "message": str(exc.detail), "requestId": rid}, status=exc.status_code)
    response = drf_handler(exc, context)
    if response is not None:
        return response
    from django.conf import settings

    if getattr(settings, "RAISE_UNHANDLED", False):
        raise exc
    logger.exception("unhandled error", extra={"request_id": rid})
    return Response({"code": "internal_error", "message": "Something went wrong on our side.", "requestId": rid}, status=500)
