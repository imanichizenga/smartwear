import { z } from 'zod';
import { CursorQuerySchema, IdSchema, MediaOutSchema, pageOf } from './common';
import { ORDER_STATUSES } from '../enums';
import { SETTINGS_GROUP_KEYS } from './settings';

export const SettingsGroupKeySchema = z.enum(SETTINGS_GROUP_KEYS as [string, ...string[]]);
export const SettingsGroupOutSchema = z.object({ group: z.string(), value: z.record(z.string(), z.unknown()), secretsMasked: z.record(z.string(), z.string()), version: z.number().int(), updatedAt: z.string().nullable(), updatedBy: z.string().nullable() });
export const SettingsUpdateSchema = z.object({ value: z.record(z.string(), z.unknown()), expectedVersion: z.number().int().optional() });
export const TestConnectionResultSchema = z.object({ ok: z.boolean(), checks: z.array(z.object({ name: z.string(), ok: z.boolean(), message: z.string(), durationMs: z.number().int().optional() })), providerError: z.string().nullable(), testedAt: z.string() });
export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;
export const IntegrationStatusSchema = z.object({ group: z.string(), title: z.string(), status: z.enum(['configured', 'not_configured', 'failing']), lastTestAt: z.string().nullable(), lastTestOk: z.boolean().nullable(), lastError: z.string().nullable(), missingFields: z.array(z.string()) });
export const RevealSecretSchema = z.object({ field: z.string(), password: z.string().optional(), code: z.string().optional() });
export const TestConnectionInputSchema = z.object({ testPhone: z.string().optional(), testIdToken: z.string().optional(), testPushToken: z.string().optional() }).default({});

export const AuditLogOutSchema = z.object({ id: IdSchema, actorType: z.string(), actorId: z.string().nullable(), actorName: z.string().nullable(), action: z.string(), entity: z.string(), entityId: z.string().nullable(), before: z.unknown().nullable(), after: z.unknown().nullable(), ip: z.string().nullable(), createdAt: z.string() });
export const AuditLogQuerySchema = CursorQuerySchema.extend({ entity: z.string().optional(), actorId: z.string().optional(), action: z.string().optional(), from: z.string().optional(), to: z.string().optional() });

export const AdminOrderListQuerySchema = CursorQuerySchema.extend({ q: z.string().optional(), status: z.string().optional(), storeId: IdSchema.optional(), riderId: IdSchema.optional(), from: z.string().optional(), to: z.string().optional(), paymentMethod: z.string().optional(), sort: z.enum(['newest', 'oldest', 'total_desc', 'total_asc', 'waiting']).default('newest') });
export const AdminOrderActionSchema = z.object({ action: z.enum(['advance', 'cancel', 'refund', 'note', 'set_status', 'retry_dispatch']), toStatus: z.enum(ORDER_STATUSES).optional(), note: z.string().max(1000).optional(), amount: z.number().int().optional(), reason: z.string().max(300).optional() });

export const InventoryLevelOutSchema = z.object({ variantId: IdSchema, sku: z.string(), productTitle: z.string(), variantLabel: z.string(), storeId: IdSchema, storeName: z.string(), quantity: z.number().int(), reserved: z.number().int(), lowStockThreshold: z.number().int(), cover: MediaOutSchema.nullable() });
export const InventoryAdjustSchema = z.object({ variantId: IdSchema, storeId: IdSchema, delta: z.number().int(), reason: z.enum(['received', 'sold', 'damaged', 'returned', 'correction', 'transfer_out', 'transfer_in']), note: z.string().max(300).optional() });
export const InventoryTransferSchema = z.object({ variantId: IdSchema, fromStoreId: IdSchema, toStoreId: IdSchema, quantity: z.number().int().min(1), note: z.string().max(300).optional() });

export const CustomerOutSchema = z.object({ id: IdSchema, name: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable(), avatarUrl: z.string().nullable(), customerType: z.enum(['RETAIL', 'WHOLESALE']), wholesaleStatus: z.string(), orders: z.number().int(), ltv: z.number().int(), lastOrderAt: z.string().nullable(), createdAt: z.string(), blocked: z.boolean(), loyaltyPoints: z.number().int(), groupIds: z.array(IdSchema) });
export const CustomerListQuerySchema = CursorQuerySchema.extend({ q: z.string().optional(), type: z.enum(['RETAIL', 'WHOLESALE']).optional(), wholesaleStatus: z.string().optional(), blocked: z.coerce.boolean().optional() });
export const WholesaleDecisionSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().max(1000).optional(), groupId: IdSchema.nullable().optional() });
export const PriceListInputSchema = z.object({ name: z.string().min(1), customerId: IdSchema.nullable().optional(), groupId: IdSchema.nullable().optional(), entries: z.array(z.object({ variantId: IdSchema, unitPrice: z.number().int().min(0), minQty: z.number().int().min(1).default(1) })), active: z.boolean().default(true) });
export const CustomerGroupInputSchema = z.object({ name: z.string().min(1), description: z.string().optional() });

export const HomeSectionKindSchema = z.enum(['stories', 'hero_carousel', 'new_in', 'collection_rail', 'for_you', 'brand_spotlight', 'beauty_corner', 'recently_viewed', 'drop_countdown', 'category_tiles', 'looks_teaser', 'editorial_banner', 'product_rail']);
export const HomeSectionInputSchema = z.object({ kind: HomeSectionKindSchema, title: z.string().max(80).nullable().optional(), titleSw: z.string().max(80).nullable().optional(), subtitle: z.string().max(140).nullable().optional(), config: z.record(z.string(), z.unknown()).default({}), sortOrder: z.number().int(), enabled: z.boolean().default(true), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional(), segment: z.enum(['all', 'new_users', 'wholesale', 'women', 'men', 'beauty_lovers']).default('all') });
export const HomeSectionOutSchema = HomeSectionInputSchema.extend({ id: IdSchema });

export const StoryInputSchema = z.object({ title: z.string().max(40), coverMediaId: IdSchema, slides: z.array(z.object({ mediaId: IdSchema, caption: z.string().max(140).nullable().optional(), productId: IdSchema.nullable().optional(), collectionId: IdSchema.nullable().optional(), durationMs: z.number().int().min(2000).max(15000).default(5000) })).min(1), publishedAt: z.string().datetime().nullable().optional(), expiresAt: z.string().datetime().nullable().optional(), sortOrder: z.number().int().default(0) });
export const StoryOutSchema = StoryInputSchema.extend({ id: IdSchema, cover: MediaOutSchema, slides: z.array(z.object({ mediaId: IdSchema, media: MediaOutSchema, caption: z.string().nullable(), productId: IdSchema.nullable(), collectionId: IdSchema.nullable(), durationMs: z.number().int() })), seen: z.boolean().optional() });

export const LookTagSchema = z.object({ productId: IdSchema, x: z.number().min(0).max(1), y: z.number().min(0).max(1), variantId: IdSchema.nullable().optional() });
export const LookInputSchema = z.object({ mediaId: IdSchema, caption: z.string().max(300).nullable().optional(), tags: z.array(LookTagSchema).default([]), creatorName: z.string().max(60).nullable().optional(), published: z.boolean().default(false), sortOrder: z.number().int().default(0) });
export const LookOutSchema = z.object({ id: IdSchema, media: MediaOutSchema, caption: z.string().nullable(), tags: z.array(LookTagSchema.extend({ product: z.lazy((): z.ZodTypeAny => z.unknown()) })), creatorName: z.string().nullable(), likes: z.number().int(), liked: z.boolean(), saved: z.boolean(), published: z.boolean(), createdAt: z.string() });

export const PromoCodeInputSchema = z.object({ code: z.string().min(3).max(40).transform((s) => s.toUpperCase()), type: z.enum(['PERCENT', 'FIXED', 'FREE_DELIVERY']), value: z.number().int().min(0), minSubtotal: z.number().int().nullable().optional(), maxDiscount: z.number().int().nullable().optional(), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional(), usageLimit: z.number().int().nullable().optional(), perCustomerLimit: z.number().int().nullable().optional(), customerTypes: z.array(z.enum(['RETAIL', 'WHOLESALE'])).nullable().optional(), active: z.boolean().default(true) });
export const CampaignInputSchema = z.object({ channel: z.enum(['push', 'sms']), title: z.string().max(80).optional(), body: z.string().min(1).max(480), audience: z.enum(['all', 'retail', 'wholesale', 'inactive_30d', 'riders']), scheduleAt: z.string().datetime().nullable().optional(), deepLink: z.string().max(200).nullable().optional() });
export const CampaignOutSchema = CampaignInputSchema.extend({ id: IdSchema, status: z.enum(['scheduled', 'sending', 'sent', 'failed', 'cancelled']), recipients: z.number().int(), delivered: z.number().int(), createdAt: z.string(), sentAt: z.string().nullable() });

export const ReportQuerySchema = z.object({ from: z.string(), to: z.string(), granularity: z.enum(['day', 'week', 'month']).default('day'), storeId: IdSchema.optional() });
export const DashboardSchema = z.object({
  today: z.object({ sales: z.number().int(), orders: z.number().int(), aov: z.number().int(), conversion: z.number(), currency: z.string(), deliveredPct: z.number(), avgDeliveryMinutes: z.number().nullable() }),
  ordersByStatus: z.array(z.object({ status: z.string(), count: z.number().int() })),
  salesSeries: z.array(z.object({ date: z.string(), sales: z.number().int(), orders: z.number().int() })),
  topProducts: z.array(z.object({ productId: IdSchema, title: z.string(), cover: MediaOutSchema.nullable(), units: z.number().int(), revenue: z.number().int() })),
  lowStock: z.array(z.object({ variantId: IdSchema, title: z.string(), variantLabel: z.string(), quantity: z.number().int(), storeName: z.string() })),
  liveRiders: z.number().int(), activeDeliveries: z.number().int(), pendingWholesale: z.number().int(), unreadSupport: z.number().int(),
});

export const SupportThreadOutSchema = z.object({ id: IdSchema, kind: z.enum(['support', 'delivery']), customer: z.object({ id: IdSchema, name: z.string().nullable(), avatarUrl: z.string().nullable() }), lastMessage: z.string().nullable(), lastMessageAt: z.string().nullable(), unread: z.number().int(), orderId: IdSchema.nullable(), status: z.enum(['open', 'resolved']) });
export const ReviewModerationQuerySchema = CursorQuerySchema.extend({ status: z.enum(['pending', 'approved', 'rejected']).default('pending') });
export const ReviewModerateSchema = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(300).optional() });
export const ReturnDecisionSchema = z.object({ decision: z.enum(['approved', 'rejected', 'received', 'refunded']), note: z.string().max(500).optional(), refundAmount: z.number().int().optional() });

export const BulkPriceUpdateSchema = z.object({ productIds: z.array(IdSchema).min(1), mode: z.enum(['percent', 'fixed']), value: z.number(), target: z.enum(['retail', 'wholesale_tiers', 'both']).default('retail'), scheduleAt: z.string().datetime().nullable().optional(), rounding: z.string().default('none') });
export const ProductTemplateSchema = z.object({ id: IdSchema, name: z.string(), payload: z.record(z.string(), z.unknown()) });
export const AdminListResponse = pageOf;
