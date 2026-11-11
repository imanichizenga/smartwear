"""On-brand PDF invoice and packing label (with order QR) using ReportLab."""
from __future__ import annotations

import io

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, A6
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from core import settings_service

INK, MUTED, HAIR, ACCENT, CANVAS = HexColor("#0B0B0C"), HexColor("#6E6A64"), HexColor("#E9E4DC"), HexColor("#B8955A"), HexColor("#FAF8F4")


def money(n: int, cur: str) -> str:
    return f"{cur} {n:,.0f}"


def _mark(c: canvas.Canvas, x: float, y: float, s: float) -> None:
    """The Atelier A (same geometry as packages/brand) drawn with PDF paths."""
    k = s / 100
    c.setStrokeColor(INK)
    c.setLineCap(1)
    c.setLineWidth(7 * k)
    c.line(x + 18 * k, y + (100 - 86) * k, x + 50 * k, y + (100 - 14) * k)
    c.line(x + 82 * k, y + (100 - 86) * k, x + 50 * k, y + (100 - 14) * k)
    c.setLineWidth(4.5 * k)
    c.setDash(3.2 * k, 2.4 * k)
    c.line(x + 28.67 * k, y + (100 - 62) * k, x + 71.33 * k, y + (100 - 62) * k)
    c.setDash()
    c.setFillColor(ACCENT)
    c.circle(x + 50 * k, y + (100 - 10) * k, 3.2 * k, stroke=0, fill=1)


def _qr(c: canvas.Canvas, data: str, x: float, y: float, size: float) -> None:
    w = QrCodeWidget(data)
    b = w.getBounds()
    d = Drawing(size, size, transform=[size / (b[2] - b[0]), 0, 0, size / (b[3] - b[1]), 0, 0])
    d.add(w)
    renderPDF.draw(d, c, x, y)


def render_invoice_pdf(order) -> bytes:
    brand = settings_service.get("branding")
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    c.setFillColor(CANVAS)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    _mark(c, 20 * mm, H - 38 * mm, 18 * mm)
    c.setFillColor(INK)
    c.setFont("Times-Roman", 22)
    c.drawString(42 * mm, H - 28 * mm, brand.storeName)
    c.setFont("Helvetica", 8.5)
    c.setFillColor(MUTED)
    c.drawString(42 * mm, H - 33 * mm, brand.tagline)
    c.setFont("Helvetica-Bold", 8)
    c.drawRightString(W - 20 * mm, H - 24 * mm, "INVOICE")
    c.setFont("Helvetica", 9)
    c.setFillColor(INK)
    c.drawRightString(W - 20 * mm, H - 30 * mm, order.number)
    c.setFillColor(MUTED)
    c.drawRightString(W - 20 * mm, H - 35 * mm, order.placed_at.strftime("%d %b %Y, %H:%M"))
    y = H - 52 * mm
    c.setStrokeColor(HAIR)
    c.line(20 * mm, y, W - 20 * mm, y)
    y -= 8 * mm
    c.setFont("Helvetica-Bold", 7.5)
    c.setFillColor(MUTED)
    c.drawString(20 * mm, y, "BILLED TO")
    c.drawString(105 * mm, y, "DELIVER TO" if order.fulfilment == "delivery" else "PICK UP AT")
    c.setFont("Helvetica", 9.5)
    c.setFillColor(INK)
    c.drawString(20 * mm, y - 5 * mm, order.contact_name or order.user.display_name)
    c.drawString(20 * mm, y - 10 * mm, order.contact_phone or "")
    c.drawString(105 * mm, y - 5 * mm, (order.destination_label if order.fulfilment == "delivery" else order.store.name)[:60])
    c.setFillColor(MUTED)
    c.drawString(105 * mm, y - 10 * mm, (order.destination_area if order.fulfilment == "delivery" else order.store.address)[:60])
    y -= 24 * mm
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(20 * mm, y, "ITEM")
    c.drawRightString(140 * mm, y, "QTY")
    c.drawRightString(165 * mm, y, "UNIT")
    c.drawRightString(W - 20 * mm, y, "TOTAL")
    y -= 3 * mm
    c.line(20 * mm, y, W - 20 * mm, y)
    for it in order.items.all():
        y -= 7 * mm
        if y < 60 * mm:
            c.showPage()
            y = H - 30 * mm
        c.setFont("Helvetica", 9.5)
        c.setFillColor(INK)
        c.drawString(20 * mm, y, f"{it.title}"[:58])
        c.setFont("Helvetica", 8)
        c.setFillColor(MUTED)
        sub = " · ".join(x for x in (it.brand, it.options_label, it.sku) if x)
        if it.price_basis != "retail":
            sub += "  ·  wholesale tier" if it.price_basis == "tier" else "  ·  your price list"
        c.drawString(20 * mm, y - 4 * mm, sub[:90])
        c.setFont("Helvetica", 9.5)
        c.setFillColor(INK)
        c.drawRightString(140 * mm, y, str(it.qty))
        c.drawRightString(165 * mm, y, f"{it.unit_price:,.0f}")
        c.drawRightString(W - 20 * mm, y, f"{it.line_total:,.0f}")
        y -= 4 * mm
    y -= 6 * mm
    c.line(110 * mm, y, W - 20 * mm, y)
    rows = [("Subtotal", order.subtotal), *([("Discount" + (f" ({order.promo_code})" if order.promo_code else ""), -order.discount)] if order.discount else []), ("Delivery", order.delivery_fee)]
    settings = settings_service.get("pricing.wholesale")
    if order.tax:
        rows.append((f"VAT {'included' if settings.taxInclusive else ''}".strip(), order.tax))
    for label, val in rows:
        y -= 6 * mm
        c.setFont("Helvetica", 9)
        c.setFillColor(MUTED)
        c.drawString(110 * mm, y, label)
        c.setFillColor(INK)
        c.drawRightString(W - 20 * mm, y, f"{val:,.0f}")
    y -= 9 * mm
    c.setFont("Times-Roman", 15)
    c.drawString(110 * mm, y, "Total")
    c.drawRightString(W - 20 * mm, y, money(order.total, order.currency))
    if order.savings:
        y -= 5 * mm
        c.setFont("Helvetica", 8)
        c.setFillColor(ACCENT)
        c.drawRightString(W - 20 * mm, y, f"You saved {money(order.savings, order.currency)} with bulk pricing")
    _qr(c, f"smartwear://order/{order.id}", 20 * mm, 20 * mm, 24 * mm)
    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    pay = {"CASH_ON_DELIVERY": "Cash on delivery", "MOBILE_MONEY": "Mobile money", "CARD": "Card"}.get(order.payment_method, order.payment_method)
    c.drawString(48 * mm, 38 * mm, f"Payment: {pay} — {order.payment_status.title()}")
    if brand.supportPhone or brand.supportEmail:
        c.drawString(48 * mm, 33 * mm, "Questions? " + " · ".join(x for x in (brand.supportPhone, brand.supportEmail) if x))
    c.drawString(48 * mm, 28 * mm, "Thank you for shopping with us.")
    c.showPage()
    c.save()
    return buf.getvalue()


def render_label_pdf(order) -> bytes:
    """A6 packing label with QR the rider scans at pickup."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A6)
    W, H = A6
    _mark(c, 8 * mm, H - 22 * mm, 13 * mm)
    c.setFont("Times-Roman", 16)
    c.drawString(24 * mm, H - 15 * mm, order.number)
    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    c.drawString(24 * mm, H - 20 * mm, f"{order.items.count()} item(s) · {order.store.name}")
    _qr(c, f"SWPICK:{order.id}", (W - 50 * mm) / 2, H - 80 * mm, 50 * mm)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(W / 2, 28 * mm, (order.contact_name or "Customer").split(" ")[0])
    c.setFont("Helvetica", 8.5)
    c.drawCentredString(W / 2, 23 * mm, (order.destination_area or order.destination_label or "Store pickup")[:44])
    c.drawCentredString(W / 2, 18 * mm, {"CASH_ON_DELIVERY": f"COLLECT {order.currency} {order.total:,.0f}" if order.payment_status != "PAID" else "PAID"}.get(order.payment_method, "PAID" if order.payment_status == "PAID" else ""))
    c.showPage()
    c.save()
    return buf.getvalue()
