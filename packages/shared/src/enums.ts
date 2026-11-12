export const ROOT_CATEGORIES = [
  { slug: 'women', name: 'Women', nameSw: 'Wanawake' },
  { slug: 'men', name: 'Men', nameSw: 'Wanaume' },
  { slug: 'kids', name: 'Kids', nameSw: 'Watoto' },
  { slug: 'shoes', name: 'Shoes', nameSw: 'Viatu' },
  { slug: 'bags', name: 'Bags', nameSw: 'Mikoba' },
  { slug: 'accessories', name: 'Accessories', nameSw: 'Vifaa' },
  { slug: 'jewellery-watches', name: 'Jewellery & Watches', nameSw: 'Vito na Saa' },
  { slug: 'beauty', name: 'Beauty', nameSw: 'Urembo' },
] as const;
export type RootCategorySlug = (typeof ROOT_CATEGORIES)[number]['slug'];
export const ROOT_CATEGORY_SLUGS = ROOT_CATEGORIES.map((c) => c.slug) as RootCategorySlug[];

export const BEAUTY_SUBCATEGORIES = ['makeup', 'skincare', 'haircare', 'fragrance', 'nails', 'tools'] as const;

export const CUSTOMER_TYPES = ['RETAIL', 'WHOLESALE'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'ASSIGNED',
  'PICKED_UP',
  'ON_THE_WAY',
  'ARRIVED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
  'FAILED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const DELIVERY_JOB_STATUSES = [
  'SEARCHING',
  'OFFERED',
  'ACCEPTED',
  'AT_STORE',
  'PICKED_UP',
  'EN_ROUTE',
  'ARRIVED',
  'COMPLETED',
  'CANCELLED',
  'NO_RIDER',
] as const;
export type DeliveryJobStatus = (typeof DELIVERY_JOB_STATUSES)[number];

export const DELIVERY_OFFER_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'] as const;

export const RIDER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDED'] as const;
export const RIDER_PRESENCE = ['OFFLINE', 'IDLE', 'ASSIGNED', 'EN_ROUTE'] as const;
export const VEHICLE_TYPES = ['MOTORBIKE', 'BICYCLE', 'CAR', 'ON_FOOT'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const PAYMENT_METHODS = ['CASH_ON_DELIVERY', 'MOBILE_MONEY', 'CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_STATUSES = ['PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED'] as const;

export const MEDIA_TYPES = ['IMAGE', 'VIDEO', 'AUDIO'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
export const MEDIA_STATUSES = ['UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED'] as const;

export const PRODUCT_STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const ADMIN_ROLES = ['SUPER_ADMIN', 'MANAGER', 'CATALOG_EDITOR', 'DISPATCHER', 'SUPPORT', 'FINANCE'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const PERMISSIONS = [
  'dashboard.view',
  'orders.view', 'orders.manage', 'orders.refund',
  'dispatch.view', 'dispatch.assign',
  'riders.view', 'riders.manage', 'payouts.manage',
  'products.view', 'products.manage', 'products.publish',
  'catalog.manage',
  'inventory.view', 'inventory.manage',
  'stores.manage',
  'customers.view', 'customers.manage', 'wholesale.approve',
  'marketing.manage',
  'reviews.moderate', 'returns.manage', 'support.chat',
  'reports.view',
  'settings.view', 'settings.manage', 'settings.secrets.reveal',
  'team.manage', 'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  MANAGER: PERMISSIONS.filter((p) => !p.startsWith('team.') && p !== 'settings.secrets.reveal'),
  CATALOG_EDITOR: ['dashboard.view', 'products.view', 'products.manage', 'products.publish', 'catalog.manage', 'inventory.view', 'inventory.manage', 'marketing.manage'],
  DISPATCHER: ['dashboard.view', 'orders.view', 'orders.manage', 'dispatch.view', 'dispatch.assign', 'riders.view', 'riders.manage', 'stores.manage'],
  SUPPORT: ['dashboard.view', 'orders.view', 'customers.view', 'support.chat', 'reviews.moderate', 'returns.manage'],
  FINANCE: ['dashboard.view', 'orders.view', 'orders.refund', 'riders.view', 'payouts.manage', 'customers.view', 'wholesale.approve', 'reports.view'],
};

export const DISPATCH_MODES = ['auto', 'manual', 'hybrid'] as const;
export const WHOLESALE_VISIBILITY = ['everyone', 'approved_only', 'hidden'] as const;
export const OTP_MODES = ['beem_sms', 'beem_otp'] as const;
export const LOCALES = ['en', 'sw'] as const;
export type Locale = (typeof LOCALES)[number];
