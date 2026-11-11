import { z } from 'zod';
import { CursorQuerySchema, IdSchema, LatLngSchema, MediaOutSchema, pageOf } from './common';
import { PRODUCT_STATUSES } from '../enums';
import { PriceTierSchema } from '../pricing/engine';

export const CategoryOutSchema = z.object({
  id: IdSchema, slug: z.string(), name: z.string(), nameSw: z.string().nullable(), parentId: IdSchema.nullable(), isRoot: z.boolean(), sortOrder: z.number().int(), image: MediaOutSchema.nullable(), productCount: z.number().int().optional(), children: z.array(z.lazy((): z.ZodTypeAny => CategoryOutSchema)).optional(),
});
export type CategoryOut = z.infer<typeof CategoryOutSchema>;

export const BrandOutSchema = z.object({ id: IdSchema, slug: z.string(), name: z.string(), story: z.string().nullable(), logo: MediaOutSchema.nullable(), cover: MediaOutSchema.nullable(), featured: z.boolean() });

export const BadgeOutSchema = z.object({ id: IdSchema, key: z.string(), label: z.string(), labelSw: z.string().nullable(), tone: z.enum(['ink', 'accent', 'blush', 'muted']) });

export const PriceDisplaySchema = z.object({
  retail: z.number().int(),
  compareAt: z.number().int().nullable(),
  currency: z.string(),
  /** Lowest wholesale tier unit price, when the viewer may see wholesale. */
  fromBulk: z.number().int().nullable(),
  tiers: z.array(PriceTierSchema),
  moq: z.number().int().nullable(),
  /** Viewer-specific resolved unit price at qty 1 (price lists applied). */
  yourPrice: z.number().int(),
  yourBasis: z.enum(['retail', 'tier', 'price_list']),
  showWholesale: z.boolean(),
});
export type PriceDisplay = z.infer<typeof PriceDisplaySchema>;

export const OptionValueOutSchema = z.object({ id: IdSchema, value: z.string(), label: z.string(), swatchHex: z.string().nullable(), swatchMedia: MediaOutSchema.nullable(), sortOrder: z.number().int() });
export const OptionTypeOutSchema = z.object({ id: IdSchema, name: z.string(), kind: z.enum(['color', 'size', 'shade', 'volume', 'other']), values: z.array(OptionValueOutSchema) });

export const VariantOutSchema = z.object({
  id: IdSchema, sku: z.string(), barcode: z.string().nullable(), optionValueIds: z.array(IdSchema), price: PriceDisplaySchema, inStock: z.boolean(), stockLevel: z.number().int().nullable(), lowStock: z.boolean(), weightGrams: z.number().int().nullable(), mediaIds: z.array(IdSchema), shadeHex: z.string().nullable(),
});

export const SizeChartOutSchema = z.object({ id: IdSchema, name: z.string(), unit: z.enum(['cm', 'in']), columns: z.array(z.string()), rows: z.array(z.object({ label: z.string(), values: z.array(z.string()) })), note: z.string().nullable() });

export const ReviewSummarySchema = z.object({ average: z.number(), count: z.number().int(), distribution: z.array(z.number().int()).length(5) });

export const ProductCardSchema = z.object({
  id: IdSchema, slug: z.string(), title: z.string(), brand: z.object({ id: IdSchema, name: z.string(), slug: z.string() }).nullable(), cover: MediaOutSchema.nullable(), hover: MediaOutSchema.nullable(), price: PriceDisplaySchema, badges: z.array(BadgeOutSchema), swatches: z.array(z.object({ hex: z.string().nullable(), mediaUrl: z.string().nullable() })), rating: z.number().nullable(), reviewCount: z.number().int(), isNew: z.boolean(), wishlisted: z.boolean(), department: z.string().nullable(), isBeauty: z.boolean(),
});
export type ProductCard = z.infer<typeof ProductCardSchema>;

export const ProductDetailSchema = ProductCardSchema.extend({
  tagline: z.string().nullable(), descriptionHtml: z.string().nullable(), story: z.string().nullable(), care: z.string().nullable(), materials: z.string().nullable(), countryOfOrigin: z.string().nullable(), season: z.string().nullable(), tags: z.array(z.string()), attributes: z.record(z.string(), z.string()),
  beauty: z.object({ skinTypes: z.array(z.string()), finish: z.string().nullable(), ingredients: z.string().nullable(), volume: z.string().nullable(), paoMonths: z.number().int().nullable(), crueltyFree: z.boolean(), vegan: z.boolean() }).nullable(),
  media: z.array(MediaOutSchema), audioNote: MediaOutSchema.nullable(), optionTypes: z.array(OptionTypeOutSchema), variants: z.array(VariantOutSchema), sizeChart: SizeChartOutSchema.nullable(), fitNote: z.enum(['runs_small', 'true_to_size', 'runs_large']).nullable(), reviews: ReviewSummarySchema, completeTheLook: z.array(ProductCardSchema), pairsWellWith: z.array(ProductCardSchema), categoryPath: z.array(z.object({ id: IdSchema, slug: z.string(), name: z.string() })), publishedAt: z.string().nullable(),
});
export type ProductDetail = z.infer<typeof ProductDetailSchema>;

export const ProductListQuerySchema = CursorQuerySchema.extend({
  q: z.string().max(120).optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  collection: z.string().optional(),
  sizes: z.string().optional(), // comma list
  colors: z.string().optional(),
  shades: z.string().optional(),
  minPrice: z.coerce.number().int().optional(),
  maxPrice: z.coerce.number().int().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  inStock: z.coerce.boolean().optional(),
  isNew: z.coerce.boolean().optional(),
  badge: z.string().optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc', 'rating', 'popular']).default('relevance'),
});
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

export const FacetSchema = z.object({ key: z.string(), label: z.string(), values: z.array(z.object({ value: z.string(), label: z.string(), count: z.number().int(), hex: z.string().nullable().optional() })) });
export const ProductListResponseSchema = pageOf(ProductCardSchema).extend({ facets: z.array(FacetSchema).optional(), priceRange: z.object({ min: z.number().int(), max: z.number().int() }).optional() });

export const SearchSuggestResponseSchema = z.object({
  products: z.array(ProductCardSchema), categories: z.array(z.object({ id: IdSchema, slug: z.string(), name: z.string() })), brands: z.array(z.object({ id: IdSchema, slug: z.string(), name: z.string() })), queries: z.array(z.string()), recent: z.array(z.string()), trending: z.array(z.string()),
});

export const CollectionOutSchema = z.object({ id: IdSchema, slug: z.string(), title: z.string(), titleSw: z.string().nullable(), subtitle: z.string().nullable(), cover: MediaOutSchema.nullable(), launchesAt: z.string().nullable(), endsAt: z.string().nullable(), isDrop: z.boolean(), notifyCount: z.number().int().optional(), productCount: z.number().int() });

export const ReviewOutSchema = z.object({ id: IdSchema, rating: z.number().int().min(1).max(5), title: z.string().nullable(), body: z.string().nullable(), tags: z.array(z.string()), media: z.array(MediaOutSchema), author: z.object({ name: z.string(), avatarUrl: z.string().nullable() }), variantLabel: z.string().nullable(), verified: z.boolean(), createdAt: z.string(), helpful: z.number().int() });
export const CreateReviewSchema = z.object({ productId: IdSchema, orderId: IdSchema.optional(), rating: z.number().int().min(1).max(5), title: z.string().max(100).optional(), body: z.string().max(2000).optional(), tags: z.array(z.string().max(30)).max(6).default([]), mediaIds: z.array(IdSchema).max(4).default([]) });

export const DeliveryEstimateQuerySchema = z.object({ lat: z.coerce.number(), lng: z.coerce.number(), productId: IdSchema.optional() });
export const DeliveryEstimateSchema = z.object({ available: z.boolean(), storeName: z.string().nullable(), minMinutes: z.number().int().nullable(), maxMinutes: z.number().int().nullable(), arrivesByLabel: z.string().nullable(), fee: z.number().int().nullable(), currency: z.string() });

// ---------- Admin product editor ----------
export const AdminVariantInputSchema = z.object({
  id: IdSchema.optional(), sku: z.string().min(1).max(64), barcode: z.string().max(64).nullable().optional(), optionValueIds: z.array(IdSchema), retailPrice: z.number().int().min(0), compareAtPrice: z.number().int().min(0).nullable().optional(), costPrice: z.number().int().min(0).nullable().optional(), wholesaleTiers: z.array(PriceTierSchema).default([]), wholesaleMoq: z.number().int().min(1).nullable().optional(), weightGrams: z.number().int().min(0).nullable().optional(), mediaIds: z.array(IdSchema).default([]), shadeHex: z.string().nullable().optional(), stock: z.array(z.object({ storeId: IdSchema, quantity: z.number().int().min(0), lowStockThreshold: z.number().int().min(0).optional() })).default([]),
});

export const AdminProductInputSchema = z.object({
  title: z.string().min(1).max(160), slug: z.string().optional(), brandId: IdSchema.nullable().optional(), categoryIds: z.array(IdSchema).min(1), tagline: z.string().max(200).nullable().optional(), descriptionHtml: z.string().max(50000).nullable().optional(), story: z.string().max(5000).nullable().optional(), care: z.string().max(5000).nullable().optional(), materials: z.string().max(2000).nullable().optional(), countryOfOrigin: z.string().max(80).nullable().optional(), department: z.enum(['women', 'men', 'kids', 'unisex']).nullable().optional(), season: z.string().max(80).nullable().optional(), tags: z.array(z.string().max(40)).default([]), attributes: z.record(z.string(), z.string()).default({}),
  beauty: z.object({ skinTypes: z.array(z.string()).default([]), finish: z.string().nullable().optional(), ingredients: z.string().max(10000).nullable().optional(), volume: z.string().nullable().optional(), paoMonths: z.number().int().nullable().optional(), crueltyFree: z.boolean().default(false), vegan: z.boolean().default(false) }).nullable().optional(),
  optionTypes: z.array(z.object({ id: IdSchema.optional(), name: z.string().min(1), kind: z.enum(['color', 'size', 'shade', 'volume', 'other']), values: z.array(z.object({ id: IdSchema.optional(), value: z.string().min(1), label: z.string().optional(), swatchHex: z.string().nullable().optional(), swatchMediaId: IdSchema.nullable().optional() })) })).default([]),
  variants: z.array(AdminVariantInputSchema).min(1),
  media: z.array(z.object({ mediaId: IdSchema, sortOrder: z.number().int(), role: z.enum(['gallery', 'designer_note', 'story', 'hover']).default('gallery'), alt: z.string().max(200).nullable().optional() })).default([]),
  sizeChartId: IdSchema.nullable().optional(), fitNote: z.enum(['runs_small', 'true_to_size', 'runs_large']).nullable().optional(),
  badgeIds: z.array(IdSchema).default([]), featured: z.boolean().default(false), collectionIds: z.array(IdSchema).default([]), relatedProductIds: z.array(IdSchema).default([]), completeTheLookIds: z.array(IdSchema).default([]),
  status: z.enum(PRODUCT_STATUSES).default('DRAFT'), publishAt: z.string().datetime().nullable().optional(), unpublishAt: z.string().datetime().nullable().optional(),
  seoTitle: z.string().max(70).nullable().optional(), seoDescription: z.string().max(160).nullable().optional(),
});
export type AdminProductInput = z.infer<typeof AdminProductInputSchema>;

export const AdminProductListQuerySchema = CursorQuerySchema.extend({ q: z.string().optional(), status: z.enum(PRODUCT_STATUSES).optional(), categoryId: IdSchema.optional(), brandId: IdSchema.optional(), lowStock: z.coerce.boolean().optional(), sort: z.enum(['updated', 'title', 'price', 'stock']).default('updated') });

export const QualityHintSchema = z.object({ level: z.enum(['info', 'warning', 'error']), code: z.string(), message: z.string(), mediaId: IdSchema.optional() });

export const CategoryInputSchema = z.object({ name: z.string().min(1).max(80), nameSw: z.string().max(80).nullable().optional(), slug: z.string().optional(), parentId: IdSchema.nullable().optional(), imageMediaId: IdSchema.nullable().optional(), sortOrder: z.number().int().optional() });
export const BrandInputSchema = z.object({ name: z.string().min(1).max(80), slug: z.string().optional(), story: z.string().max(5000).nullable().optional(), logoMediaId: IdSchema.nullable().optional(), coverMediaId: IdSchema.nullable().optional(), featured: z.boolean().default(false) });
export const CollectionInputSchema = z.object({ title: z.string().min(1).max(120), titleSw: z.string().nullable().optional(), slug: z.string().optional(), subtitle: z.string().max(200).nullable().optional(), coverMediaId: IdSchema.nullable().optional(), isDrop: z.boolean().default(false), launchesAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional(), rule: z.object({ categoryIds: z.array(IdSchema).optional(), brandIds: z.array(IdSchema).optional(), tags: z.array(z.string()).optional(), isNewDays: z.number().int().optional() }).nullable().optional(), productIds: z.array(IdSchema).default([]), published: z.boolean().default(false) });
export const SizeChartInputSchema = z.object({ name: z.string().min(1), unit: z.enum(['cm', 'in']).default('cm'), columns: z.array(z.string()).min(1), rows: z.array(z.object({ label: z.string(), values: z.array(z.string()) })).min(1), note: z.string().nullable().optional(), brandId: IdSchema.nullable().optional(), categoryId: IdSchema.nullable().optional() });
export const BadgeInputSchema = z.object({ key: z.string().regex(/^[a-z0-9_]+$/), label: z.string().min(1).max(24), labelSw: z.string().max(24).nullable().optional(), tone: z.enum(['ink', 'accent', 'blush', 'muted']).default('ink') });
export { LatLngSchema };
