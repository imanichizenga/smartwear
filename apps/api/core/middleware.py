import logging
import time
import uuid

logger = logging.getLogger("smartwear.request")


class RequestIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        rid = request.headers.get("X-Request-Id") or uuid.uuid4().hex
        request.request_id = rid
        t = time.monotonic()
        response = self.get_response(request)
        response["X-Request-Id"] = rid
        logger.info("%s %s → %s", request.method, request.get_full_path(), response.status_code, extra={"request_id": rid, "path": request.path, "status": response.status_code, "duration_ms": round((time.monotonic() - t) * 1000)})
        return response


class LocaleMiddleware:
    """`request.locale` is 'sw' or 'en' from Accept-Language; authenticated users override it later."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        al = (request.headers.get("Accept-Language") or "").lower()
        request.locale = "sw" if al.startswith("sw") else "en"
        request.device_id = request.headers.get("X-Device-Id") or None
        return self.get_response(request)
