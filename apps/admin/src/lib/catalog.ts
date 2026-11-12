'use client';

import { useQuery } from '@tanstack/react-query';
import type { CatNode } from '@/components/catalog/categories';
import { api } from './api';
import type { MediaOut } from './types';

export type ProductStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'ARCHIVED';
export interface ProductRow {
  id: string;
  slug: string;
  title: string;
  status: ProductStatus;
  brand: string | null;
  category: { id: string; name: string; path: string } | null;
  cover: MediaOut | null;
  minPrice: number;
  maxPrice: number;
  currency: string;
  hasWholesale: boolean;
  variants: number;
  stock: number;
  inStock: boolean;
  featured: boolean;
  rating: number | null;
  updatedAt: string;
  publishedAt: string | null;
  skus: string[];
}
export interface Brand { id: string; slug: string; name: string; story: string | null; storySw: string | null; country: string | null; website: string | null; featured: boolean; isActive: boolean; sortOrder: number; logo: MediaOut | null; coverMediaId: string | null; productCount?: number }
export interface Badge { id: string; key: string; label: string; labelSw: string | null; tone: string; sortOrder: number; productCount: number }
export interface SizeChart { id: string; name: string; unit: string; columns: string[]; rows: { label: string; values: string[] }[]; note: string | null; brandId: string | null; categoryId: string | null; key: string | null }
export interface Collection { id: string; slug: string; title: string; titleSw: string | null; subtitle: string | null; description: string | null; cover: MediaOut | null; coverMediaId: string | null; isDrop: boolean; launchesAt: string | null; endsAt: string | null; rule: Record<string, unknown> | null; published: boolean; sortOrder: number; productIds: string[]; subscribers: number }
export interface AttrOption { value: string; label: string; labelSw?: string | null; hex?: string }
export interface Attribute { key: string; label: string; labelSw: string | null; type: 'select' | 'multiselect' | 'text' | 'boolean'; options: AttrOption[]; filterable: boolean; sortOrder: number; usedBy: string[] }
export interface StoreLite { id: string; name: string; code: string; kind: string; isActive: boolean; area: string }

export const STATUS_TONE: Record<ProductStatus, 'success' | 'warning' | 'neutral' | 'accent'> = { PUBLISHED: 'success', SCHEDULED: 'accent', DRAFT: 'warning', ARCHIVED: 'neutral' };

export interface CatOption { id: string; label: string; name: string; depth: number; kind: 'fashion' | 'beauty'; isLeaf: boolean; attributeKeys: string[]; defaultSizeChartId: string | null; rootKey: string }

function flatten(nodes: CatNode[], trail: string[] = [], out: CatOption[] = [], inherited: string[] = []): CatOption[] {
  for (const n of nodes) {
    if (n.archived) continue;
    const keys = [...new Set([...inherited, ...n.attributeKeys])];
    out.push({ id: n.id, name: n.name, label: [...trail, n.name].join(' › '), depth: n.depth, kind: n.kind, isLeaf: n.children.length === 0, attributeKeys: keys, defaultSizeChartId: n.defaultSizeChartId, rootKey: n.rootKey });
    flatten(n.children, [...trail, n.name], out, keys);
  }
  return out;
}

const stale = 60_000;
export const useCategories = () =>
  useQuery({ queryKey: ['categories', 'flat'], staleTime: stale, queryFn: async () => flatten((await api<{ items: CatNode[] }>('/admin/categories')).items) });
export const useBrands = () => useQuery({ queryKey: ['brands'], staleTime: stale, queryFn: async () => (await api<{ items: Brand[] }>('/admin/brands')).items });
export const useBadges = () => useQuery({ queryKey: ['badges'], staleTime: stale, queryFn: async () => (await api<{ items: Badge[] }>('/admin/badges')).items });
export const useSizeCharts = () => useQuery({ queryKey: ['size-charts'], staleTime: stale, queryFn: async () => (await api<{ items: SizeChart[] }>('/admin/size-charts')).items });
export const useCollections = () => useQuery({ queryKey: ['collections'], staleTime: stale, queryFn: async () => (await api<{ items: Collection[] }>('/admin/collections')).items });
export const useAttributes = () => useQuery({ queryKey: ['attributes'], staleTime: stale, queryFn: async () => (await api<{ items: Attribute[] }>('/admin/attributes')).items });
export const useStores = () => useQuery({ queryKey: ['stores', 'lite'], staleTime: stale, queryFn: async () => (await api<{ items: StoreLite[] }>('/admin/stores')).items });

/** Product search used by every picker (related products, look tags, collections, transfers). */
export async function searchProducts(q: string, limit = 12) {
  return (await api<{ items: ProductRow[] }>('/admin/products', { query: { q, limit } })).items;
}
