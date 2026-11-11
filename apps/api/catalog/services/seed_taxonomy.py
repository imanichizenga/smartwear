"""Idempotent installer for the controlled taxonomy (roots, tree, attributes, size charts, badges)."""
from __future__ import annotations

from django.db import transaction

from ..models import AttributeDefinition, Badge, Category, SizeChart
from ..taxonomy import ATTRIBUTES, BADGES, ROOT_BY_KEY, ROOTS, SEED_TREE, SIZE_CHARTS, Node


def ensure_attributes() -> None:
    for i, a in enumerate(ATTRIBUTES):
        AttributeDefinition.objects.update_or_create(
            key=a["key"], defaults={"label": a["label"], "label_sw": a["labelSw"], "type": a["type"], "options": a["options"], "filterable": a["filterable"], "sort_order": i * 10}
        )


def ensure_size_charts() -> dict[str, SizeChart]:
    out = {}
    for key, c in SIZE_CHARTS.items():
        rows = [{"label": r[0], "values": r[1:]} for r in c["rows"]]
        chart, _ = SizeChart.objects.get_or_create(key=key, defaults={"name": c["name"], "unit": c["unit"], "columns": c["columns"], "rows": rows})
        out[key] = chart
    return out


def ensure_badges() -> None:
    for i, b in enumerate(BADGES):
        Badge.objects.get_or_create(key=b["key"], defaults={"label": b["label"], "label_sw": b["labelSw"], "tone": b["tone"], "sort_order": i * 10})


def _ensure_node(node: Node, parent: Category, charts: dict[str, SizeChart], sort: int) -> None:
    existing = Category.objects.filter(slug=node.slug).first()
    if existing is None:
        existing = Category.objects.create(
            parent=parent, root_key=parent.root_key, slug=node.slug, path=f"{parent.path}/{node.slug}", depth=parent.depth + 1,
            name=node.name, name_sw=node.name_sw, kind=parent.kind, department=node.department or parent.department,
            icon=node.icon or "", sort_order=sort, attribute_keys=node.attributes, default_size_chart=charts.get(node.size_chart) if node.size_chart else None,
        )
    for i, child in enumerate(node.children):
        _ensure_node(child, existing, charts, (i + 1) * 10)


@transaction.atomic
def ensure_root(key: str, charts: dict[str, SizeChart] | None = None, *, with_tree: bool = True) -> Category:
    spec = ROOT_BY_KEY[key]
    charts = charts or {c.key: c for c in SizeChart.objects.exclude(key__isnull=True)}
    root = Category.objects.filter(parent__isnull=True, root_key=key).first()
    if root is None:
        root = Category.objects.create(
            parent=None, root_key=key, slug=key, path=key, depth=0, name=spec.name, name_sw=spec.name_sw, kind=spec.kind,
            department=spec.department, icon=spec.icon, description=spec.description, sort_order=[r.key for r in ROOTS].index(key) * 10,
        )
    if with_tree:
        for i, node in enumerate(SEED_TREE.get(key, [])):
            _ensure_node(node, root, charts, (i + 1) * 10)
    return root


@transaction.atomic
def ensure_taxonomy(include_optional: bool = False) -> int:
    ensure_attributes()
    charts = ensure_size_charts()
    ensure_badges()
    for spec in ROOTS:
        if spec.core or include_optional:
            ensure_root(spec.key, charts)
    return Category.objects.count()
