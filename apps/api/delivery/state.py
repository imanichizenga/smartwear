"""Order + delivery state machines (mirror of packages/shared/src/state/machines.ts). Server-enforced."""
from __future__ import annotations

from core.exceptions import ApiError

ORDER_TRANSITIONS: dict[str, dict[str, list[str]]] = {
    "PENDING_PAYMENT": {"CONFIRMED": ["system", "admin"], "CANCELLED": ["customer", "admin", "system"], "FAILED": ["system"]},
    "CONFIRMED": {"PREPARING": ["admin", "system"], "CANCELLED": ["customer", "admin", "system"]},
    "PREPARING": {"READY_FOR_PICKUP": ["admin", "system"], "ASSIGNED": ["system", "admin"], "CANCELLED": ["admin", "system"]},
    "READY_FOR_PICKUP": {"ASSIGNED": ["system", "admin"], "PICKED_UP": ["rider", "admin"], "DELIVERED": ["admin"], "CANCELLED": ["admin", "system"]},
    "ASSIGNED": {"PICKED_UP": ["rider", "admin"], "READY_FOR_PICKUP": ["system", "admin"], "PREPARING": ["system", "admin"], "CANCELLED": ["admin", "system"]},
    "PICKED_UP": {"ON_THE_WAY": ["rider", "admin", "system"], "CANCELLED": ["admin"]},
    "ON_THE_WAY": {"ARRIVED": ["rider", "admin"], "CANCELLED": ["admin"]},
    "ARRIVED": {"DELIVERED": ["rider", "admin"], "ON_THE_WAY": ["rider"], "CANCELLED": ["admin"]},
    "DELIVERED": {"REFUNDED": ["admin"]},
    "CANCELLED": {"REFUNDED": ["admin", "system"]},
    "REFUNDED": {},
    "FAILED": {"PENDING_PAYMENT": ["customer", "system"], "CANCELLED": ["admin", "system"]},
}

DELIVERY_TRANSITIONS: dict[str, dict[str, list[str]]] = {
    "SEARCHING": {"OFFERED": ["system"], "ACCEPTED": ["admin"], "NO_RIDER": ["system"], "CANCELLED": ["admin", "system"]},
    "OFFERED": {"ACCEPTED": ["rider", "admin"], "SEARCHING": ["system", "admin"], "NO_RIDER": ["system"], "CANCELLED": ["admin", "system"]},
    "ACCEPTED": {"AT_STORE": ["rider", "admin"], "SEARCHING": ["rider", "admin", "system"], "CANCELLED": ["admin", "system"]},
    "AT_STORE": {"PICKED_UP": ["rider", "admin"], "SEARCHING": ["admin", "system"], "CANCELLED": ["admin", "system"]},
    "PICKED_UP": {"EN_ROUTE": ["rider", "admin", "system"], "CANCELLED": ["admin"]},
    "EN_ROUTE": {"ARRIVED": ["rider", "admin"], "CANCELLED": ["admin"]},
    "ARRIVED": {"COMPLETED": ["rider", "admin"], "EN_ROUTE": ["rider"], "CANCELLED": ["admin"]},
    "COMPLETED": {},
    "CANCELLED": {},
    "NO_RIDER": {"SEARCHING": ["admin", "system", "customer"], "ACCEPTED": ["admin"], "CANCELLED": ["admin", "customer", "system"]},
}

DELIVERY_TO_ORDER = {"ACCEPTED": "ASSIGNED", "PICKED_UP": "PICKED_UP", "EN_ROUTE": "ON_THE_WAY", "ARRIVED": "ARRIVED", "COMPLETED": "DELIVERED"}
ORDER_ACTIVE = ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "ASSIGNED", "PICKED_UP", "ON_THE_WAY", "ARRIVED"]
DELIVERY_ACTIVE = ["SEARCHING", "OFFERED", "ACCEPTED", "AT_STORE", "PICKED_UP", "EN_ROUTE", "ARRIVED"]
RIDER_HOLDS = ["ACCEPTED", "AT_STORE", "PICKED_UP", "EN_ROUTE", "ARRIVED"]


def can_order(frm: str, to: str, actor: str) -> bool:
    return actor in ORDER_TRANSITIONS.get(frm, {}).get(to, [])


def assert_order(frm: str, to: str, actor: str) -> None:
    if not can_order(frm, to, actor):
        raise ApiError.conflict("invalid_transition", f"Order can't go from {frm.replace('_', ' ').lower()} to {to.replace('_', ' ').lower()}", {"from": frm, "to": to, "actor": actor})


def can_delivery(frm: str, to: str, actor: str) -> bool:
    return actor in DELIVERY_TRANSITIONS.get(frm, {}).get(to, [])


def assert_delivery(frm: str, to: str, actor: str) -> None:
    if not can_delivery(frm, to, actor):
        raise ApiError.conflict("invalid_transition", f"Delivery can't go from {frm.replace('_', ' ').lower()} to {to.replace('_', ' ').lower()}", {"from": frm, "to": to, "actor": actor})
