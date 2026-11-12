import type { MediaOut } from '@/lib/types';
import type { ProductStatus } from '@/lib/catalog';

export interface OptionValueIn { id?: string; value: string; label?: string | null; swatchHex?: string | null; swatchMediaId?: string | null }
export interface OptionTypeIn { id?: string; name: string; kind: 'color' | 'size' | 'shade' | 'volume' | 'other'; values: OptionValueIn[] }
export interface Tier { minQty: number; unitPrice: number }
export interface StockIn { storeId: string; quantity: number; reserved?: number; lowStockThreshold?: number | null }
export interface VariantIn {
  id?: string;
  /** Client-only key so new rows have a stable identity before they have an id. */
  _k: string;
  sku: string;
  barcode: string | null;
  optionValueIds: string[];
  retailPrice: number;
  compareAtPrice: number | null;
  costPrice: number | null;
  wholesaleTiers: Tier[];
  wholesaleMoq: number | null;
  weightGrams: number | null;
  mediaIds: string[];
  shadeHex: string | null;
  isActive: boolean;
  stock: StockIn[];
}
export interface ProductMediaIn { mediaId: string; sortOrder: number; role: string; alt: string | null; optionValueId: string | null; media: MediaOut }
export interface BeautyIn { finish?: string; volume?: string; paoMonths?: number | null; skinTypes?: string[]; ingredients?: string; vegan?: boolean; crueltyFree?: boolean; expiry?: string | null }

export interface ProductForm {
  id?: string;
  title: string;
  titleSw: string | null;
  slug: string;
  brandId: string | null;
  primaryCategoryId: string | null;
  categoryIds: string[];
  tagline: string | null;
  descriptionHtml: string | null;
  story: string | null;
  care: string | null;
  materials: string | null;
  countryOfOrigin: string | null;
  department: string | null;
  season: string | null;
  tags: string[];
  attributes: Record<string, string | string[] | boolean>;
  beauty: BeautyIn | null;
  isBeauty?: boolean;
  optionTypes: OptionTypeIn[];
  variants: VariantIn[];
  media: ProductMediaIn[];
  sizeChartId: string | null;
  fitNote: string | null;
  badgeIds: string[];
  featured: boolean;
  collectionIds: string[];
  relatedProductIds: string[];
  completeTheLookIds: string[];
  pairsWellWithIds: string[];
  status: ProductStatus;
  publishAt: string | null;
  unpublishAt: string | null;
  publishedAt?: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  version?: number;
  updatedAt?: string;
  qualityHints?: { level: 'info' | 'warning' | 'error'; code: string; message: string }[];
}

let n = 0;
export const newKey = () => `k${Date.now().toString(36)}${(n++).toString(36)}`;

export const emptyVariant = (sku = ''): VariantIn => ({
  _k: newKey(), sku, barcode: null, optionValueIds: [], retailPrice: 0, compareAtPrice: null, costPrice: null, wholesaleTiers: [], wholesaleMoq: null, weightGrams: null, mediaIds: [], shadeHex: null, isActive: true, stock: [],
});

export const emptyProduct = (): ProductForm => ({
  title: '', titleSw: null, slug: '', brandId: null, primaryCategoryId: null, categoryIds: [], tagline: null, descriptionHtml: null, story: null, care: null, materials: null, countryOfOrigin: null,
  department: null, season: null, tags: [], attributes: {}, beauty: null, optionTypes: [], variants: [emptyVariant()], media: [], sizeChartId: null, fitNote: null, badgeIds: [], featured: false,
  collectionIds: [], relatedProductIds: [], completeTheLookIds: [], pairsWellWithIds: [], status: 'DRAFT', publishAt: null, unpublishAt: null, seoTitle: null, seoDescription: null,
});

/** API → form (adds client keys). */
export function fromApi(d: Omit<ProductForm, 'variants'> & { variants: Omit<VariantIn, '_k'>[] }): ProductForm {
  return { ...d, variants: d.variants.map((v) => ({ ...v, _k: v.id ?? newKey() })) };
}

/** Form → API payload (drops client keys and read-only fields). */
export function toApi(f: ProductForm) {
  const { qualityHints, updatedAt, publishedAt, isBeauty, ...rest } = f;
  return {
    ...rest,
    variants: f.variants.map(({ _k, ...v }) => v),
    media: f.media.map(({ media, ...m }, i) => ({ ...m, sortOrder: i })),
  };
}

export const skuStem = (title: string) => title.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 10) || 'SKU';
export const skuPart = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6);
