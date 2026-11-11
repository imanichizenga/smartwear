from __future__ import annotations

from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVectorField
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import F, Q

from core.models import TimeStamped, UUIDModel

from .taxonomy import MAX_DEPTH

HEX = r"^#[0-9A-Fa-f]{6}$"


class Category(UUIDModel):
    """
    Fashion & beauty category tree. `path` is the materialised slug path ("women/women-clothing/women-dresses")
    so subtree queries are a single indexed prefix scan. Roots come only from catalog.taxonomy.ROOTS.
    """

    KINDS = [("fashion", "Fashion"), ("beauty", "Beauty")]
    DEPARTMENTS = [("women", "Women"), ("men", "Men"), ("kids", "Kids"), ("unisex", "Unisex")]

    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="children")
    root_key = models.CharField(max_length=32, db_index=True)
    slug = models.SlugField(max_length=96, unique=True)
    path = models.CharField(max_length=500, unique=True)
    depth = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(MAX_DEPTH)])
    name = models.CharField(max_length=80)
    name_sw = models.CharField(max_length=80, blank=True, default="")
    description = models.TextField(blank=True, default="")
    description_sw = models.TextField(blank=True, default="")
    kind = models.CharField(max_length=8, choices=KINDS)
    department = models.CharField(max_length=8, choices=DEPARTMENTS, null=True, blank=True)
    icon = models.CharField(max_length=32, blank=True, default="")
    image = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    show_in_nav = models.BooleanField(default=True)
    is_featured = models.BooleanField(default=False)
    attribute_keys = models.JSONField(default=list, blank=True, help_text="Attribute keys introduced at this level (inherited by descendants)")
    default_size_chart = models.ForeignKey("SizeChart", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    seo_title = models.CharField(max_length=70, blank=True, default="")
    seo_description = models.CharField(max_length=160, blank=True, default="")
    product_count = models.PositiveIntegerField(default=0, help_text="Published products in this subtree (denormalised)")
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name_plural = "categories"
        ordering = ["depth", "sort_order", "name"]
        constraints = [
            models.UniqueConstraint(fields=["root_key"], condition=Q(parent__isnull=True), name="one_root_per_key"),
            models.CheckConstraint(condition=Q(depth__lte=MAX_DEPTH), name="category_max_depth"),
            models.CheckConstraint(condition=(Q(parent__isnull=True) & Q(depth=0)) | (Q(parent__isnull=False) & Q(depth__gt=0)), name="category_root_depth"),
            models.UniqueConstraint(F("parent"), models.functions.Lower("name"), name="unique_sibling_name"),
        ]
        indexes = [
            models.Index(fields=["path"], name="category_path_prefix", opclasses=["varchar_pattern_ops"]),
            models.Index(fields=["parent", "sort_order"]),
            models.Index(fields=["is_active", "show_in_nav"]),
        ]

    def __str__(self) -> str:
        return self.path

    @property
    def is_root(self) -> bool:
        return self.parent_id is None


class AttributeDefinition(TimeStamped):
    TYPES = [("select", "Single choice"), ("multiselect", "Multiple choice"), ("text", "Text"), ("boolean", "Yes / no"), ("color", "Colour")]
    key = models.SlugField(max_length=40, unique=True)
    label = models.CharField(max_length=60)
    label_sw = models.CharField(max_length=60, blank=True, default="")
    type = models.CharField(max_length=12, choices=TYPES, default="select")
    options = models.JSONField(default=list, blank=True)
    filterable = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "label"]


class Brand(UUIDModel):
    slug = models.SlugField(max_length=96, unique=True)
    name = models.CharField(max_length=80, unique=True)
    story = models.TextField(blank=True, default="")
    story_sw = models.TextField(blank=True, default="")
    country = models.CharField(max_length=60, blank=True, default="")
    website = models.URLField(blank=True, default="")
    logo = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    cover = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    featured = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]


class Badge(TimeStamped):
    TONES = [("ink", "Ink"), ("accent", "Champagne"), ("blush", "Blush"), ("muted", "Muted")]
    key = models.SlugField(max_length=32, unique=True)
    label = models.CharField(max_length=24)
    label_sw = models.CharField(max_length=24, blank=True, default="")
    tone = models.CharField(max_length=8, choices=TONES, default="ink")
    sort_order = models.IntegerField(default=0)


class SizeChart(UUIDModel):
    key = models.SlugField(max_length=48, unique=True, null=True, blank=True)
    name = models.CharField(max_length=80)
    unit = models.CharField(max_length=2, choices=[("cm", "cm"), ("in", "in")], default="cm")
    columns = models.JSONField(default=list)
    rows = models.JSONField(default=list, help_text='[{"label": "M", "values": ["12", "40", ...]}]')
    note = models.TextField(blank=True, default="")
    brand = models.ForeignKey(Brand, null=True, blank=True, on_delete=models.CASCADE, related_name="size_charts")
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="size_charts")


class Collection(UUIDModel):
    slug = models.SlugField(max_length=96, unique=True)
    title = models.CharField(max_length=120)
    title_sw = models.CharField(max_length=120, blank=True, default="")
    subtitle = models.CharField(max_length=200, blank=True, default="")
    description = models.TextField(blank=True, default="")
    cover = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    is_drop = models.BooleanField(default=False)
    launches_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    rule = models.JSONField(null=True, blank=True, help_text="Rule-based membership: {categoryIds, brandIds, tags, isNewDays, minPrice, maxPrice}")
    published = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "-created_at"]


class CustomerGroup(UUIDModel):
    name = models.CharField(max_length=80, unique=True)
    description = models.CharField(max_length=240, blank=True, default="")


class Product(UUIDModel):
    STATUSES = [("DRAFT", "Draft"), ("SCHEDULED", "Scheduled"), ("PUBLISHED", "Published"), ("ARCHIVED", "Archived")]
    DEPARTMENTS = Category.DEPARTMENTS
    FIT_NOTES = [("runs_small", "Runs small"), ("true_to_size", "True to size"), ("runs_large", "Runs large")]

    slug = models.SlugField(max_length=120, unique=True)
    title = models.CharField(max_length=160)
    title_sw = models.CharField(max_length=160, blank=True, default="")
    brand = models.ForeignKey(Brand, null=True, blank=True, on_delete=models.SET_NULL, related_name="products")
    primary_category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="primary_products")
    categories = models.ManyToManyField(Category, through="ProductCategory", related_name="products")
    tagline = models.CharField(max_length=200, blank=True, default="")
    description_html = models.TextField(blank=True, default="")
    story = models.TextField(blank=True, default="")
    care = models.TextField(blank=True, default="")
    materials = models.CharField(max_length=2000, blank=True, default="")
    country_of_origin = models.CharField(max_length=80, blank=True, default="")
    department = models.CharField(max_length=8, choices=DEPARTMENTS, null=True, blank=True)
    season = models.CharField(max_length=80, blank=True, default="")
    tags = models.JSONField(default=list, blank=True)
    attributes = models.JSONField(default=dict, blank=True, help_text="{attributeKey: value | [values]}")
    is_beauty = models.BooleanField(default=False)
    beauty = models.JSONField(null=True, blank=True, help_text="{skinTypes, finish, ingredients, volume, paoMonths, crueltyFree, vegan}")
    size_chart = models.ForeignKey(SizeChart, null=True, blank=True, on_delete=models.SET_NULL, related_name="products")
    fit_note = models.CharField(max_length=16, choices=FIT_NOTES, null=True, blank=True)
    badges = models.ManyToManyField(Badge, blank=True, related_name="products")
    collections = models.ManyToManyField(Collection, through="CollectionProduct", blank=True, related_name="products")
    featured = models.BooleanField(default=False)
    status = models.CharField(max_length=10, choices=STATUSES, default="DRAFT", db_index=True)
    publish_at = models.DateTimeField(null=True, blank=True)
    unpublish_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)
    seo_title = models.CharField(max_length=70, blank=True, default="")
    seo_description = models.CharField(max_length=160, blank=True, default="")
    # Denormalised for fast listing / sorting
    currency = models.CharField(max_length=3, default="TZS")
    min_price = models.BigIntegerField(default=0, db_index=True)
    max_price = models.BigIntegerField(default=0)
    min_bulk_price = models.BigIntegerField(null=True, blank=True)
    in_stock = models.BooleanField(default=False, db_index=True)
    rating_avg = models.FloatField(default=0)
    rating_count = models.PositiveIntegerField(default=0)
    popularity = models.FloatField(default=0, db_index=True)
    search_text = models.TextField(blank=True, default="", help_text="brand, categories, tags, attributes — feeds search_vector")
    search_vector = SearchVectorField(null=True)
    version = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    updated_by = models.ForeignKey("accounts.AdminUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            GinIndex(fields=["search_vector"], name="product_search_gin"),
            GinIndex(name="product_title_trgm", fields=["title"], opclasses=["gin_trgm_ops"]),
            models.Index(fields=["status", "-published_at"]),
            models.Index(fields=["primary_category", "status"]),
            models.Index(fields=["brand", "status"]),
            GinIndex(fields=["tags"], name="product_tags_gin"),
            GinIndex(fields=["attributes"], name="product_attrs_gin"),
        ]

    def __str__(self) -> str:
        return self.title


class ProductCategory(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="category_links")
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name="product_links")
    is_primary = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0, help_text="Merchandised position inside the category")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["product", "category"], name="uniq_product_category"),
            models.UniqueConstraint(fields=["product"], condition=Q(is_primary=True), name="one_primary_category"),
        ]
        indexes = [models.Index(fields=["category", "sort_order"])]


class CollectionProduct(models.Model):
    collection = models.ForeignKey(Collection, on_delete=models.CASCADE)
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    sort_order = models.IntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["collection", "product"], name="uniq_collection_product")]


class OptionType(models.Model):
    KINDS = [("color", "Colour"), ("size", "Size"), ("shade", "Shade"), ("volume", "Volume"), ("other", "Other")]
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="option_types")
    name = models.CharField(max_length=40)
    kind = models.CharField(max_length=8, choices=KINDS)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [models.UniqueConstraint(fields=["product", "kind", "name"], name="uniq_option_type")]


class OptionValue(models.Model):
    option_type = models.ForeignKey(OptionType, on_delete=models.CASCADE, related_name="values")
    value = models.CharField(max_length=60)
    label = models.CharField(max_length=60, blank=True, default="")
    swatch_hex = models.CharField(max_length=7, blank=True, default="")
    swatch_media = models.ForeignKey("media.Media", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", help_text="Shade on skin / fabric swatch")
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [models.UniqueConstraint(fields=["option_type", "value"], name="uniq_option_value")]


class ProductVariant(UUIDModel):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="variants")
    sku = models.CharField(max_length=64, unique=True)
    barcode = models.CharField(max_length=64, blank=True, default="", db_index=True)
    option_values = models.ManyToManyField(OptionValue, blank=True, related_name="variants")
    currency = models.CharField(max_length=3, default="TZS")
    retail_price = models.BigIntegerField(validators=[MinValueValidator(0)])
    compare_at_price = models.BigIntegerField(null=True, blank=True, validators=[MinValueValidator(0)])
    cost_price = models.BigIntegerField(null=True, blank=True, validators=[MinValueValidator(0)])
    wholesale_moq = models.PositiveIntegerField(null=True, blank=True)
    weight_grams = models.PositiveIntegerField(null=True, blank=True)
    shade_hex = models.CharField(max_length=7, blank=True, default="")
    media = models.ManyToManyField("media.Media", blank=True, related_name="product_variants")
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(compare_at_price__isnull=True) | Q(compare_at_price__gt=F("retail_price")), name="compare_at_is_real_discount"),
        ]


class PriceTier(models.Model):
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name="tiers")
    min_qty = models.PositiveIntegerField(validators=[MinValueValidator(2)])
    unit_price = models.BigIntegerField(validators=[MinValueValidator(0)])

    class Meta:
        ordering = ["min_qty"]
        constraints = [models.UniqueConstraint(fields=["variant", "min_qty"], name="uniq_tier_qty")]


class ScheduledPriceChange(UUIDModel):
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name="scheduled_prices")
    retail_price = models.BigIntegerField()
    compare_at_price = models.BigIntegerField(null=True, blank=True)
    starts_at = models.DateTimeField(db_index=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey("accounts.AdminUser", null=True, on_delete=models.SET_NULL, related_name="+")


class PriceList(UUIDModel):
    """Custom wholesale prices for one customer or a customer group."""

    name = models.CharField(max_length=80)
    customer = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.CASCADE, related_name="price_lists")
    group = models.ForeignKey(CustomerGroup, null=True, blank=True, on_delete=models.CASCADE, related_name="price_lists")
    active = models.BooleanField(default=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(customer__isnull=False) | Q(group__isnull=False), name="pricelist_has_target")]


class PriceListEntry(models.Model):
    price_list = models.ForeignKey(PriceList, on_delete=models.CASCADE, related_name="entries")
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name="+")
    min_qty = models.PositiveIntegerField(default=1)
    unit_price = models.BigIntegerField(validators=[MinValueValidator(0)])

    class Meta:
        constraints = [models.UniqueConstraint(fields=["price_list", "variant", "min_qty"], name="uniq_pricelist_entry")]


class ProductMedia(models.Model):
    ROLES = [("gallery", "Gallery"), ("hover", "Hover"), ("designer_note", "Designer's note"), ("story", "Product story"), ("video", "Video")]
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="media_links")
    media = models.ForeignKey("media.Media", on_delete=models.CASCADE, related_name="product_links")
    role = models.CharField(max_length=16, choices=ROLES, default="gallery")
    sort_order = models.IntegerField(default=0)
    alt = models.CharField(max_length=200, blank=True, default="")
    option_value = models.ForeignKey(OptionValue, null=True, blank=True, on_delete=models.SET_NULL, related_name="media_links", help_text="Shown when this colour/shade is selected")

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [models.UniqueConstraint(fields=["product", "media"], name="uniq_product_media")]


class ProductRelation(models.Model):
    KINDS = [("related", "Related"), ("complete_look", "Complete the look"), ("pairs_with", "Pairs well with")]
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="relations")
    related = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=16, choices=KINDS)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order"]
        constraints = [
            models.UniqueConstraint(fields=["product", "related", "kind"], name="uniq_product_relation"),
            models.CheckConstraint(condition=~Q(product=F("related")), name="no_self_relation"),
        ]


class ProductVersion(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="versions")
    version = models.PositiveIntegerField()
    snapshot = models.JSONField()
    note = models.CharField(max_length=200, blank=True, default="")
    created_by = models.ForeignKey("accounts.AdminUser", null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-version"]
        constraints = [models.UniqueConstraint(fields=["product", "version"], name="uniq_product_version")]


class ProductTemplate(UUIDModel):
    """'Dress template' etc. — pre-fills attributes, option types and size chart in the editor."""

    name = models.CharField(max_length=80, unique=True)
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    data = models.JSONField(default=dict)


class ProductView(models.Model):
    """Recently viewed + personalisation signal."""

    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="product_views")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="+")
    viewed_at = models.DateTimeField(auto_now=True, db_index=True)
    count = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "product"], name="uniq_product_view")]
        indexes = [models.Index(fields=["user", "-viewed_at"])]

    @staticmethod
    def merge_conflict(obj, keep) -> None:
        obj.delete()
