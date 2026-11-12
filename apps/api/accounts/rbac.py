"""Mirror of packages/shared/src/enums.ts PERMISSIONS / ROLE_PERMISSIONS (server is authoritative)."""

PERMISSIONS = [
    "dashboard.view",
    "orders.view", "orders.manage", "orders.refund",
    "dispatch.view", "dispatch.assign",
    "riders.view", "riders.manage", "payouts.manage",
    "products.view", "products.manage", "products.publish",
    "catalog.manage", "catalog.roots",
    "inventory.view", "inventory.manage",
    "stores.manage",
    "customers.view", "customers.manage", "wholesale.approve",
    "marketing.manage",
    "reviews.moderate", "returns.manage", "support.chat",
    "reports.view",
    "settings.view", "settings.manage", "settings.secrets.reveal",
    "team.manage", "audit.view",
]

ROLE_PERMISSIONS: dict[str, tuple[str, str, list[str]]] = {
    "SUPER_ADMIN": ("Super Admin", "Everything, including team, root categories and secrets.", PERMISSIONS),
    "MANAGER": ("Manager", "Runs the business day to day.", [p for p in PERMISSIONS if not p.startswith("team.") and p not in ("settings.secrets.reveal", "catalog.roots")]),
    "CATALOG_EDITOR": ("Catalog Editor", "Products, categories, media and merchandising.", ["dashboard.view", "products.view", "products.manage", "products.publish", "catalog.manage", "inventory.view", "inventory.manage", "marketing.manage"]),
    "DISPATCHER": ("Dispatcher", "Orders, riders and the dispatch control room.", ["dashboard.view", "orders.view", "orders.manage", "dispatch.view", "dispatch.assign", "riders.view", "riders.manage", "stores.manage"]),
    "SUPPORT": ("Support", "Customers, chat, reviews and returns.", ["dashboard.view", "orders.view", "customers.view", "support.chat", "reviews.moderate", "returns.manage"]),
    "FINANCE": ("Finance", "Payments, refunds, wholesale approvals and reports.", ["dashboard.view", "orders.view", "orders.refund", "riders.view", "payouts.manage", "customers.view", "wholesale.approve", "reports.view"]),
}


def ensure_roles() -> None:
    from .models import Role

    for key, (name, desc, perms) in ROLE_PERMISSIONS.items():
        Role.objects.update_or_create(key=key, defaults={"name": name, "description": desc, "permissions": list(perms), "is_system": True})
