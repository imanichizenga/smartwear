import { z } from 'zod';
import { IdSchema, LatLngSchema, MediaOutSchema, OkSchema, pageOf } from './common';
import { ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, DELIVERY_JOB_STATUSES } from '../enums';
import { ProductCardSchema } from './catalog';

export const CartLineOutSchema = z.object({
  id: IdSchema, product: ProductCardSchema, variantId: IdSchema, variantLabel: z.string(), sku: z.string(), qty: z.number().int(), unitPrice: z.number().int(), basis: z.enum(['retail', 'tier', 'price_list']), tierLabel: z.string().nullable(), compareAtPrice: z.number().int().nullable(), lineTotal: z.number().int(), savings: z.number().int(), nextTier: z.object({ addQty: z.number().int(), unitPrice: z.number().int() }).nullable(), inStock: z.boolean(), maxQty: z.number().int().nullable(), savedForLater: z.boolean(), moqViolation: z.boolean(),
});
export const CartOutSchema = z.object({
  id: IdSchema, currency: z.string(), lines: z.array(CartLineOutSchema), subtotal: z.number().int(), discount: z.number().int(), tax: z.number().int(), taxInclusive: z.boolean(), savings: z.number().int(), promoCode: z.string().nullable(), promoError: z.string().nullable(), itemCount: z.number().int(), updatedAt: z.string(),
});
export type CartOut = z.infer<typeof CartOutSchema>;

export const CartAddSchema = z.object({ variantId: IdSchema, qty: z.number().int().min(1).max(999).default(1) });
export const CartUpdateLineSchema = z.object({ qty: z.number().int().min(0).max(999).optional(), savedForLater: z.boolean().optional() });
export const CartPromoSchema = z.object({ code: z.string().min(1).max(40).nullable() });

export const SavedPlaceOutSchema = z.object({ id: IdSchema, label: z.string(), kind: z.enum(['home', 'work', 'other']), address: z.string(), landmark: z.string().nullable(), location: LatLngSchema, plusCode: z.string().nullable(), isDefault: z.boolean() });
export const SavedPlaceInputSchema = z.object({ label: z.string().min(1).max(40), kind: z.enum(['home', 'work', 'other']).default('other'), address: z.string().min(1).max(300), landmark: z.string().max(140).nullable().optional(), location: LatLngSchema, plusCode: z.string().nullable().optional(), placeId: z.string().nullable().optional(), isDefault: z.boolean().default(false) });

export const DeliveryQuoteRequestSchema = z.object({ location: LatLngSchema, optionId: z.string().optional() });
export const DeliveryQuoteOptionSchema = z.object({ id: z.string(), name: z.string(), nameSw: z.string().nullable(), kind: z.enum(['express', 'standard', 'pickup']), fee: z.number().int(), feeBeforeFree: z.number().int(), freeDelivery: z.boolean(), etaMinMinutes: z.number().int(), etaMaxMinutes: z.number().int(), serviceable: z.boolean(), reason: z.string().nullable() });
export const DeliveryQuoteSchema = z.object({
  store: z.object({ id: IdSchema, name: z.string(), location: LatLngSchema, address: z.string() }).nullable(), distanceMeters: z.number().int().nullable(), routeDurationSeconds: z.number().int().nullable(), options: z.array(DeliveryQuoteOptionSchema), addressLabel: z.string().nullable(), currency: z.string(), unavailableReason: z.string().nullable(),
});
export type DeliveryQuote = z.infer<typeof DeliveryQuoteSchema>;

export const PaymentMethodOutSchema = z.object({ id: IdSchema, method: z.enum(PAYMENT_METHODS), label: z.string(), detail: z.string().nullable(), isDefault: z.boolean() });
export const PaymentMethodInputSchema = z.object({ method: z.enum(PAYMENT_METHODS), mobileNumber: z.string().optional(), isDefault: z.boolean().default(true) });

export const PlaceOrderSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  deliveryOptionId: z.string(),
  location: LatLngSchema,
  addressLabel: z.string().max(300),
  landmark: z.string().max(140).nullable().optional(),
  savedPlaceId: IdSchema.nullable().optional(),
  paymentMethodId: IdSchema.nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  extraFields: z.record(z.string(), z.string().max(500)).default({}),
  /** Server re-validates: the client sends what it displayed so a mismatch returns 409. */
  expectedTotal: z.number().int(),
});

export const OrderItemOutSchema = z.object({ id: IdSchema, productId: IdSchema, title: z.string(), variantLabel: z.string(), sku: z.string(), cover: MediaOutSchema.nullable(), qty: z.number().int(), unitPrice: z.number().int(), basis: z.string(), tierLabel: z.string().nullable(), lineTotal: z.number().int(), reviewed: z.boolean() });
export const OrderEventOutSchema = z.object({ id: IdSchema, type: z.string(), fromStatus: z.string().nullable(), toStatus: z.string().nullable(), actor: z.string(), note: z.string().nullable(), createdAt: z.string(), meta: z.record(z.string(), z.unknown()).nullable() });
export const RiderPublicSchema = z.object({ id: IdSchema, name: z.string(), avatarUrl: z.string().nullable(), rating: z.number(), vehicleType: z.string(), plate: z.string().nullable(), vehicleColor: z.string().nullable(), phoneMasked: z.string().nullable(), deliveries: z.number().int() });
export const DeliveryOutSchema = z.object({
  id: IdSchema, status: z.enum(DELIVERY_JOB_STATUSES), rider: RiderPublicSchema.nullable(), riderLocation: LatLngSchema.extend({ bearing: z.number().nullable(), updatedAt: z.string() }).nullable(), etaSeconds: z.number().int().nullable(), distanceMeters: z.number().int().nullable(), routePolyline: z.string().nullable(), pin: z.string().nullable(), pickupAt: z.string().nullable(), arrivedAt: z.string().nullable(), completedAt: z.string().nullable(), proofPhotoUrl: z.string().nullable(), chatThreadId: IdSchema.nullable(),
});
export const OrderOutSchema = z.object({
  id: IdSchema, number: z.string(), status: z.enum(ORDER_STATUSES), currency: z.string(), items: z.array(OrderItemOutSchema), subtotal: z.number().int(), discount: z.number().int(), deliveryFee: z.number().int(), tax: z.number().int(), total: z.number().int(), promoCode: z.string().nullable(), deliveryOption: z.object({ id: z.string(), name: z.string(), kind: z.string() }), dropoff: z.object({ location: LatLngSchema, address: z.string(), landmark: z.string().nullable() }), store: z.object({ id: IdSchema, name: z.string(), location: LatLngSchema, address: z.string(), phone: z.string().nullable() }), payment: z.object({ method: z.enum(PAYMENT_METHODS), status: z.enum(PAYMENT_STATUSES), checkoutUrl: z.string().nullable(), reference: z.string().nullable() }), delivery: DeliveryOutSchema.nullable(), events: z.array(OrderEventOutSchema), extraFields: z.record(z.string(), z.string()), shareToken: z.string().nullable(), canCancel: z.boolean(), canReorder: z.boolean(), canReturn: z.boolean(), createdAt: z.string(), updatedAt: z.string(), estimatedArrival: z.object({ min: z.string(), max: z.string() }).nullable(),
});
export type OrderOut = z.infer<typeof OrderOutSchema>;

export const OrderListResponseSchema = pageOf(OrderOutSchema.pick({ id: true, number: true, status: true, total: true, currency: true, createdAt: true, items: true, estimatedArrival: true }));

export const RateDeliverySchema = z.object({ riderRating: z.number().int().min(1).max(5), riderTags: z.array(z.string().max(30)).max(6).default([]), comment: z.string().max(500).optional(), tipAmount: z.number().int().min(0).optional() });

export const WishlistBoardOutSchema = z.object({ id: IdSchema, name: z.string(), isDefault: z.boolean(), shareToken: z.string().nullable(), itemCount: z.number().int(), covers: z.array(MediaOutSchema), updatedAt: z.string() });
export const WishlistBoardInputSchema = z.object({ name: z.string().min(1).max(40) });
export const WishlistToggleSchema = z.object({ productId: IdSchema, variantId: IdSchema.nullable().optional(), boardId: IdSchema.nullable().optional() });
export const WishlistItemOutSchema = z.object({ id: IdSchema, product: ProductCardSchema, variantId: IdSchema.nullable(), addedAt: z.string(), priceAtAdd: z.number().int(), priceDropped: z.boolean() });

export const StyleProfileSchema = z.object({
  department: z.enum(['women', 'men', 'kids', 'unisex']).nullable().default(null), styles: z.array(z.string()).default([]), sizes: z.record(z.string(), z.string()).default({}), fitPreference: z.enum(['fitted', 'regular', 'relaxed']).nullable().default(null), favouriteColors: z.array(z.string()).default([]),
  beauty: z.object({ skinType: z.enum(['dry', 'oily', 'combination', 'normal', 'sensitive']).nullable().default(null), skinTone: z.string().nullable().default(null), undertone: z.enum(['warm', 'cool', 'neutral']).nullable().default(null), shadeMatches: z.array(z.object({ brand: z.string(), shade: z.string() })).default([]), concerns: z.array(z.string()).default([]) }).default({ skinType: null, skinTone: null, undertone: null, shadeMatches: [], concerns: [] }),
  quizCompleted: z.boolean().default(false),
});
export type StyleProfile = z.infer<typeof StyleProfileSchema>;

export const WholesaleApplicationInputSchema = z.object({ businessName: z.string().min(2).max(120), tin: z.string().min(5).max(40), licenceMediaId: IdSchema.nullable().optional(), contactName: z.string().min(1).max(80), phone: z.string().min(6).max(20), email: z.string().email().optional(), note: z.string().max(1000).optional() });
export const WholesaleApplicationOutSchema = WholesaleApplicationInputSchema.extend({ id: IdSchema, status: z.enum(['PENDING', 'APPROVED', 'REJECTED']), adminNote: z.string().nullable(), createdAt: z.string(), decidedAt: z.string().nullable() });

export const NotificationOutSchema = z.object({ id: IdSchema, type: z.string(), title: z.string(), body: z.string(), data: z.record(z.string(), z.unknown()).nullable(), readAt: z.string().nullable(), createdAt: z.string(), image: MediaOutSchema.nullable() });
export const NotificationPrefsSchema = z.object({ orderUpdates: z.boolean().default(true), drops: z.boolean().default(true), priceDrops: z.boolean().default(true), marketing: z.boolean().default(false), sms: z.boolean().default(true) });

export const ReturnRequestInputSchema = z.object({ orderId: IdSchema, items: z.array(z.object({ orderItemId: IdSchema, qty: z.number().int().min(1), reason: z.enum(['size', 'damaged', 'not_as_described', 'changed_mind', 'other']), note: z.string().max(500).optional(), mediaIds: z.array(IdSchema).max(4).default([]) })).min(1), type: z.enum(['return', 'exchange']) });

export const LoyaltyOutSchema = z.object({ points: z.number().int(), tier: z.string(), nextTier: z.string().nullable(), pointsToNextTier: z.number().int().nullable(), history: z.array(z.object({ id: IdSchema, delta: z.number().int(), reason: z.string(), createdAt: z.string() })) });

export const ChatMessageOutSchema = z.object({ id: IdSchema, threadId: IdSchema, senderType: z.enum(['customer', 'rider', 'admin', 'system']), senderName: z.string(), body: z.string(), media: MediaOutSchema.nullable(), createdAt: z.string(), readAt: z.string().nullable() });
export const ChatSendSchema = z.object({ body: z.string().min(1).max(2000), mediaId: IdSchema.nullable().optional() });
export { OkSchema };
