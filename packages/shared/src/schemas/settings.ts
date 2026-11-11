import { z } from 'zod';
import { DeliveryPricingSettingsSchema } from '../delivery/fees';
import { DispatchSettingsSchema } from '../delivery/dispatch';
import { WholesaleSettingsSchema } from '../pricing/engine';
import { LOCALES, OTP_MODES } from '../enums';

/**
 * Every settings group is a Zod schema. The API validates writes, the settings service caches
 * parsed values, and the admin form is generated from the same schema + the field metadata below.
 *
 * `secret: true` fields are AES-256-GCM encrypted at rest and never returned to the browser.
 */

export const SECRET_PLACEHOLDER = '__SECRET_UNCHANGED__';

/** A secret string: the API accepts a new value or the placeholder meaning "keep existing". */
const secret = () => z.string().default('');

export const StorageS3Schema = z.object({
  provider: z.enum(['aws', 's3_compatible']).default('aws'),
  bucket: z.string().default(''),
  region: z.string().default('eu-west-1'),
  accessKeyId: secret(),
  secretAccessKey: secret(),
  /** For S3-compatible endpoints (RustFS/MinIO/R2). Empty for AWS. */
  endpoint: z.string().default(''),
  forcePathStyle: z.boolean().default(false),
  /** Public CDN origin (CloudFront). Empty → presigned GET URLs are used. */
  cdnBaseUrl: z.string().default(''),
  /** Prefix inside the bucket, e.g. "media" */
  keyPrefix: z.string().default('media'),
  presignTtlSeconds: z.number().int().min(60).max(3600).default(900),
  maxImageBytes: z.number().int().default(25 * 1024 * 1024),
  maxVideoBytes: z.number().int().default(1024 * 1024 * 1024),
  maxAudioBytes: z.number().int().default(50 * 1024 * 1024),
});

export const SmsBeemSchema = z.object({
  apiKey: secret(),
  secretKey: secret(),
  senderId: z.string().max(11).default(''),
  /** 'beem_sms' = we generate + hash the code and send via SMS API; 'beem_otp' = Beem OTP API. */
  otpMode: z.enum(OTP_MODES).default('beem_sms'),
  otpAppId: z.string().default(''),
  /** {{code}}, {{minutes}}, {{appHash}} are substituted. */
  otpTemplate: z.string().default('{{code}} is your SmartWear code. It expires in {{minutes}} minutes.\n{{appHash}}'),
  /** Android SMS Retriever hash — appended to the template for OTP auto-fill. */
  androidAppHash: z.string().default(''),
  useStaging: z.boolean().default(false),
  riderInviteTemplate: z.string().default('Karibu SmartWear, {{name}}! You are registered as a rider. Download the app: {{appLink}} and sign in with this number.'),
});

export const AuthSchema = z.object({
  googleWebClientId: z.string().default(''),
  googleIosClientId: z.string().default(''),
  googleAndroidClientId: z.string().default(''),
  otpLength: z.number().int().min(4).max(8).default(6),
  otpExpiryMinutes: z.number().int().min(1).max(30).default(5),
  otpMaxAttempts: z.number().int().min(3).max(10).default(5),
  otpResendCooldownSeconds: z.number().int().min(15).max(300).default(30),
  otpMaxPerPhonePerHour: z.number().int().min(1).default(5),
  otpMaxPerIpPerHour: z.number().int().min(1).default(30),
  otpMaxPerDevicePerHour: z.number().int().min(1).default(10),
  accessTokenTtlMinutes: z.number().int().min(5).max(120).default(15),
  refreshTokenTtlDays: z.number().int().min(1).max(365).default(60),
  requirePhoneForCheckout: z.boolean().default(true),
  defaultCountry: z.string().length(2).default('TZ'),
  defaultDialCode: z.string().default('+255'),
  adminSessionHours: z.number().int().min(1).max(72).default(12),
  /** Signing secret for JWTs — generated on first boot if empty. */
  jwtSecret: secret(),
});

export const MapsGoogleSchema = z.object({
  /** Server key with Places (New), Geocoding and Routes enabled. */
  serverApiKey: secret(),
  /** Browser key (HTTP-referrer restricted) for the admin map rendering. */
  browserApiKey: z.string().default(''),
  /** Map ID for cloud-based styling in admin; mobile uses JSON styles below. */
  mapId: z.string().default(''),
  regionCode: z.string().length(2).default('tz'),
  language: z.string().default('en'),
  autocompleteRadiusMeters: z.number().int().min(1000).max(50000).default(30000),
  routesTravelMode: z.enum(['TWO_WHEELER', 'DRIVE', 'BICYCLE', 'WALK']).default('TWO_WHEELER'),
  routeCacheSeconds: z.number().int().min(10).max(600).default(60),
  /** Google Maps JSON style arrays (monochrome / soft silver). */
  mapStyleLight: z.array(z.record(z.string(), z.unknown())).default([]),
  mapStyleDark: z.array(z.record(z.string(), z.unknown())).default([]),
});

export const PushSchema = z.object({
  provider: z.enum(['expo', 'fcm_apns']).default('expo'),
  expoAccessToken: secret(),
  fcmServiceAccountJson: secret(),
  apnsKeyP8: secret(),
  apnsKeyId: z.string().default(''),
  apnsTeamId: z.string().default(''),
  apnsBundleId: z.string().default('africa.smartwear.app'),
  apnsSandbox: z.boolean().default(false),
});

export const PaymentsSchema = z.object({
  cashOnDeliveryEnabled: z.boolean().default(true),
  cashOnDeliveryMaxAmount: z.number().int().min(0).nullable().default(null),
  mobileMoneyProvider: z.enum(['none', 'beem_checkout']).default('none'),
  beemCheckoutApiKey: secret(),
  beemCheckoutSecretKey: secret(),
  beemCheckoutReferencePrefix: z.string().default('SW'),
  beemCheckoutCallbackSecret: secret(),
  cardProvider: z.enum(['none']).default('none'),
  /** Public base URL of the API (for provider callbacks). */
  publicApiBaseUrl: z.string().default(''),
});

export const CheckoutExtraFieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string(),
  labelSw: z.string().optional(),
  type: z.enum(['text', 'textarea', 'phone', 'select']),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
});

export const CheckoutSchema = z.object({
  extraFields: z.array(CheckoutExtraFieldSchema).default([]),
  slideToConfirm: z.boolean().default(false),
  /** Minutes the store needs before a rider should arrive. */
  prepTimeMinutes: z.number().int().min(0).max(240).default(20),
  allowGuestCheckout: z.boolean().default(false),
  minOrderAmount: z.number().int().min(0).default(0),
  showDeliveryEstimateOnPdp: z.boolean().default(true),
});

export const BrandingSchema = z.object({
  storeName: z.string().default('SmartWear'),
  tagline: z.string().default('Fashion & beauty, delivered.'),
  taglineSw: z.string().default('Mitindo na urembo, hadi mlangoni.'),
  supportPhone: z.string().default(''),
  supportEmail: z.string().default(''),
  supportWhatsApp: z.string().default(''),
  logoMediaId: z.string().nullable().default(null),
  welcomeVideoMediaId: z.string().nullable().default(null),
  welcomeImageMediaId: z.string().nullable().default(null),
  /** Accent may be tuned within brand constraints; ink/canvas are fixed by the design system. */
  accentLight: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#B8955A'),
  accentDark: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#D1B07A'),
  appStoreUrl: z.string().default(''),
  playStoreUrl: z.string().default(''),
  appDownloadLink: z.string().default(''),
});

export const FeaturesSchema = z.object({
  guestBrowsing: z.boolean().default(true),
  looksFeed: z.boolean().default(true),
  stories: z.boolean().default(true),
  wishlistBoards: z.boolean().default(true),
  loyalty: z.boolean().default(true),
  reviews: z.boolean().default(true),
  returns: z.boolean().default(true),
  chatSupport: z.boolean().default(true),
  wholesaleApplications: z.boolean().default(true),
  styleQuiz: z.boolean().default(true),
  shareTracking: z.boolean().default(true),
  minAppVersionIos: z.string().default('1.0.0'),
  minAppVersionAndroid: z.string().default('1.0.0'),
  maintenanceMode: z.boolean().default(false),
  maintenanceMessage: z.string().default(''),
});

export const MediaSchema = z.object({
  imageMasterMaxEdge: z.number().int().min(1200).max(4000).default(2400),
  imageWidths: z.array(z.number().int()).default([320, 640, 960, 1280, 1920]),
  avifQuality: z.number().int().min(30).max(90).default(50),
  webpQuality: z.number().int().min(40).max(95).default(72),
  jpegQuality: z.number().int().min(50).max(95).default(78),
  smartCropAspect: z.string().default('4:5'),
  videoResolutions: z.array(z.number().int()).default([720, 1080]),
  videoMaxBitrateKbps: z.number().int().default(4500),
  hlsMinDurationSeconds: z.number().int().default(45),
  previewLoopSeconds: z.number().int().min(2).max(10).default(4),
  audioBitrateKbps: z.number().int().min(64).max(192).default(112),
  audioLoudnessLufs: z.number().default(-16),
  backgroundCleanup: z.object({
    provider: z.enum(['none', 'removebg', 'http']).default('none'),
    apiKey: secret(),
    endpoint: z.string().default(''),
    /** Hex background colour composited behind the cut-out product. */
    studioBackground: z.string().default('#F5F2EC'),
  }).default({ provider: 'none', apiKey: '', endpoint: '', studioBackground: '#F5F2EC' }),
  autoEnhanceDefault: z.boolean().default(false),
  orphanCleanupHours: z.number().int().min(1).default(24),
  mediaConvert: z.object({ enabled: z.boolean().default(false), roleArn: z.string().default(''), queueArn: z.string().default(''), endpoint: z.string().default('') }).default({ enabled: false, roleArn: '', queueArn: '', endpoint: '' }),
});

export const NotificationTemplateSchema = z.object({
  key: z.string(),
  channel: z.enum(['sms', 'push', 'email']),
  title: z.string().default(''),
  body: z.string(),
  bodySw: z.string().optional(),
  enabled: z.boolean().default(true),
});

export const NotificationTemplatesSchema = z.object({
  templates: z.array(NotificationTemplateSchema).default([
    { key: 'order.confirmed', channel: 'push', title: 'Order confirmed', body: 'Your order {{orderNumber}} is confirmed. We are preparing it now.', bodySw: 'Oda yako {{orderNumber}} imethibitishwa. Tunaiandaa sasa.', enabled: true },
    { key: 'order.rider_assigned', channel: 'push', title: 'Rider on the way to the store', body: '{{riderName}} will deliver your order.', bodySw: '{{riderName}} ataleta oda yako.', enabled: true },
    { key: 'order.on_the_way', channel: 'push', title: 'On the way', body: 'Your order is on its way. ETA {{eta}}.', bodySw: 'Oda yako iko njiani. Inafika {{eta}}.', enabled: true },
    { key: 'order.nearby', channel: 'push', title: 'Almost there', body: 'Your rider is {{minutes}} min away.', bodySw: 'Dereva yuko dakika {{minutes}}.', enabled: true },
    { key: 'order.arrived', channel: 'push', title: 'Your rider has arrived', body: 'Share PIN {{pin}} with your rider to receive your order.', bodySw: 'Mpe dereva PIN {{pin}} kupokea oda yako.', enabled: true },
    { key: 'order.delivered', channel: 'push', title: 'Delivered', body: 'Enjoy! Tap to rate your experience.', bodySw: 'Furahia! Gusa kutoa maoni.', enabled: true },
    { key: 'order.no_rider', channel: 'push', title: 'Looking for a rider', body: 'Riders are busy right now. We are still searching for you.', bodySw: 'Madereva wana shughuli sasa. Bado tunatafuta.', enabled: true },
    { key: 'order.cancelled', channel: 'push', title: 'Order cancelled', body: 'Order {{orderNumber}} was cancelled.', bodySw: 'Oda {{orderNumber}} imeghairiwa.', enabled: true },
    { key: 'order.confirmed', channel: 'sms', title: '', body: 'SmartWear: order {{orderNumber}} confirmed. Track it in the app.', enabled: false },
    { key: 'drop.live', channel: 'push', title: '{{dropName}} is live', body: 'The drop you were waiting for just launched.', enabled: true },
    { key: 'wishlist.price_drop', channel: 'push', title: 'Price drop', body: '{{productTitle}} is now {{price}}.', enabled: true },
    { key: 'rider.new_job', channel: 'push', title: 'New delivery request', body: 'Pickup at {{storeName}} · {{distance}} · {{earning}}', enabled: true },
    { key: 'wholesale.approved', channel: 'push', title: 'Wholesale approved', body: 'Your wholesale account is active. Bulk prices are now shown.', enabled: true },
  ]),
});

export const LocalizationSchema = z.object({
  defaultLocale: z.enum(LOCALES).default('en'),
  enabledLocales: z.array(z.enum(LOCALES)).default(['en', 'sw']),
  currency: z.string().length(3).default('TZS'),
  enabledCurrencies: z.array(z.string().length(3)).default(['TZS']),
  timezone: z.string().default('Africa/Dar_es_Salaam'),
});

export const LoyaltySchema = z.object({
  enabled: z.boolean().default(true),
  pointsPerCurrencyUnit: z.number().min(0).default(0.001), // 1 point per 1,000 TZS
  tiers: z.array(z.object({ name: z.string(), minPoints: z.number().int().min(0), perk: z.string().default('') })).default([
    { name: 'Atelier', minPoints: 0, perk: 'Welcome to SmartWear' },
    { name: 'Maison', minPoints: 500, perk: 'Early access to drops' },
    { name: 'Couture', minPoints: 2000, perk: 'Free express delivery' },
  ]),
  redeemRate: z.number().min(0).default(10), // 1 point = 10 TZS
});

export const SearchSchema = z.object({
  trending: z.array(z.string()).default(['linen dress', 'gold hoops', 'loafers', 'vitamin C serum', 'oud perfume']),
  typoTolerance: z.boolean().default(true),
  resultsPerPage: z.number().int().min(10).max(60).default(24),
});

export const SETTINGS_GROUPS = {
  'storage.s3': StorageS3Schema,
  'sms.beem': SmsBeemSchema,
  auth: AuthSchema,
  'maps.google': MapsGoogleSchema,
  push: PushSchema,
  payments: PaymentsSchema,
  'delivery.pricing': DeliveryPricingSettingsSchema,
  'delivery.dispatch': DispatchSettingsSchema,
  checkout: CheckoutSchema,
  'pricing.wholesale': WholesaleSettingsSchema,
  branding: BrandingSchema,
  features: FeaturesSchema,
  media: MediaSchema,
  'notifications.templates': NotificationTemplatesSchema,
  localization: LocalizationSchema,
  loyalty: LoyaltySchema,
  search: SearchSchema,
} as const;

export type SettingsGroupKey = keyof typeof SETTINGS_GROUPS;
export type SettingsValue<K extends SettingsGroupKey> = z.infer<(typeof SETTINGS_GROUPS)[K]>;
export type AllSettings = { [K in SettingsGroupKey]: SettingsValue<K> };

export const SETTINGS_GROUP_KEYS = Object.keys(SETTINGS_GROUPS) as SettingsGroupKey[];

/** Paths (dot notation) of secret fields per group. Used for encryption and redaction. */
export const SECRET_FIELDS: Record<SettingsGroupKey, string[]> = {
  'storage.s3': ['accessKeyId', 'secretAccessKey'],
  'sms.beem': ['apiKey', 'secretKey'],
  auth: ['jwtSecret'],
  'maps.google': ['serverApiKey'],
  push: ['expoAccessToken', 'fcmServiceAccountJson', 'apnsKeyP8'],
  payments: ['beemCheckoutApiKey', 'beemCheckoutSecretKey', 'beemCheckoutCallbackSecret'],
  'delivery.pricing': [],
  'delivery.dispatch': [],
  checkout: [],
  'pricing.wholesale': [],
  branding: [],
  features: [],
  media: ['backgroundCleanup.apiKey'],
  'notifications.templates': [],
  localization: [],
  loyalty: [],
  search: [],
};

/** Groups that are safe to expose (partially) through GET /v1/config/public. */
export const PUBLIC_CONFIG_PICK = {
  branding: ['storeName', 'tagline', 'taglineSw', 'supportPhone', 'supportEmail', 'supportWhatsApp', 'accentLight', 'accentDark', 'logoMediaId', 'welcomeVideoMediaId', 'welcomeImageMediaId', 'appDownloadLink'],
  features: '*',
  checkout: ['extraFields', 'slideToConfirm', 'allowGuestCheckout', 'minOrderAmount', 'showDeliveryEstimateOnPdp'],
  localization: '*',
  auth: ['googleWebClientId', 'googleIosClientId', 'googleAndroidClientId', 'otpLength', 'otpResendCooldownSeconds', 'requirePhoneForCheckout', 'defaultCountry', 'defaultDialCode'],
  'maps.google': ['mapStyleLight', 'mapStyleDark', 'regionCode'],
  'pricing.wholesale': ['visibility', 'autoTiersForRetail', 'currency', 'taxInclusive'],
  'delivery.pricing': ['options', 'currency', 'freeDeliveryThreshold'],
  'delivery.dispatch': ['deliveryPinEnabled', 'offerTimeoutSeconds'],
  payments: ['cashOnDeliveryEnabled', 'cashOnDeliveryMaxAmount', 'mobileMoneyProvider', 'cardProvider'],
  loyalty: '*',
  search: ['trending'],
} as const satisfies Partial<Record<SettingsGroupKey, readonly string[] | '*'>>;

export interface IntegrationMeta {
  group: SettingsGroupKey;
  title: string;
  description: string;
  consoleUrl?: string;
  docsUrl?: string;
  /** Fields that must be non-empty for the integration to count as Configured. */
  requiredFields: string[];
  testable: boolean;
}

export const INTEGRATIONS: IntegrationMeta[] = [
  { group: 'storage.s3', title: 'Media storage (S3)', description: 'Private bucket for all product media, served through a CDN.', consoleUrl: 'https://s3.console.aws.amazon.com/s3/home', docsUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html', requiredFields: ['bucket', 'region', 'accessKeyId', 'secretAccessKey'], testable: true },
  { group: 'sms.beem', title: 'SMS & OTP (Beem)', description: 'Phone verification codes, rider invites and SMS campaigns.', consoleUrl: 'https://login.beem.africa/', docsUrl: 'https://docs.beem.africa', requiredFields: ['apiKey', 'secretKey', 'senderId'], testable: true },
  { group: 'auth', title: 'Google Sign-In', description: 'Client IDs used to verify Google ID tokens from the mobile app.', consoleUrl: 'https://console.cloud.google.com/apis/credentials', docsUrl: 'https://developers.google.com/identity', requiredFields: ['googleWebClientId'], testable: true },
  { group: 'maps.google', title: 'Google Maps Platform', description: 'Places Autocomplete (New), Geocoding and Routes — all proxied by the API.', consoleUrl: 'https://console.cloud.google.com/google/maps-apis', docsUrl: 'https://developers.google.com/maps/documentation', requiredFields: ['serverApiKey'], testable: true },
  { group: 'push', title: 'Push notifications', description: 'Expo Push or FCM/APNs credentials.', consoleUrl: 'https://expo.dev/accounts', docsUrl: 'https://docs.expo.dev/push-notifications/overview/', requiredFields: ['provider'], testable: true },
  { group: 'payments', title: 'Payments', description: 'Cash on delivery and mobile money via Beem Checkout.', consoleUrl: 'https://login.beem.africa/', docsUrl: 'https://docs.beem.africa/guides/payments-checkout/index.md', requiredFields: [], testable: true },
];
