/**
 * Human labels, help text and layout for every settings group. The API sends each group's JSON
 * schema (pydantic is the source of truth); this file only makes it read like a product.
 * Unknown fields still render — labels fall back to a humanised key.
 */
export interface FieldMeta {
  label?: string;
  help?: string;
  placeholder?: string;
  /** money in minor units of the store currency */
  money?: boolean;
  /** render as multi-line text */
  multiline?: boolean;
  /** bytes → shown in MB */
  bytes?: boolean;
  /** JSON editor (map styles etc.) */
  json?: boolean;
  hidden?: boolean;
  /** values for enums: label per option */
  options?: Record<string, string>;
  suffix?: string;
}

export interface GroupMeta {
  title: string;
  description: string;
  section: 'Integrations' | 'Store' | 'Delivery' | 'Content';
  /** Ordered field groups; fields not listed land in "More". */
  layout?: { title: string; description?: string; fields: string[] }[];
  fields?: Record<string, FieldMeta>;
  test?: { label: string; inputs?: { key: string; label: string; placeholder?: string; help?: string }[] };
}

export const SETTINGS_META: Record<string, GroupMeta> = {
  'storage.s3': {
    title: 'Media storage',
    section: 'Integrations',
    description: 'All product images, videos and audio live in a private S3 bucket and are served through your CDN.',
    layout: [
      { title: 'Bucket', fields: ['provider', 'bucket', 'region', 'endpoint', 'forcePathStyle', 'keyPrefix'] },
      { title: 'Credentials', description: 'An IAM user limited to this bucket (see docs/CONFIGURATION.md for the policy).', fields: ['accessKeyId', 'secretAccessKey'] },
      { title: 'Delivery', fields: ['cdnBaseUrl', 'presignTtlSeconds'] },
      { title: 'Upload limits', fields: ['maxImageBytes', 'maxVideoBytes', 'maxAudioBytes'] },
    ],
    fields: {
      provider: { label: 'Provider', options: { aws: 'Amazon S3', s3_compatible: 'S3-compatible (MinIO, R2, RustFS…)' } },
      bucket: { label: 'Bucket name', placeholder: 'smartwear-media' },
      region: { label: 'Region', placeholder: 'eu-west-1' },
      endpoint: { label: 'Custom endpoint', help: 'Only for S3-compatible storage. Leave empty for AWS.', placeholder: 'https://…' },
      forcePathStyle: { label: 'Path-style URLs', help: 'Needed by most S3-compatible servers.' },
      keyPrefix: { label: 'Key prefix', help: 'Folder all SmartWear objects are stored under.' },
      accessKeyId: { label: 'Access key ID' },
      secretAccessKey: { label: 'Secret access key' },
      cdnBaseUrl: { label: 'CloudFront / CDN URL', help: 'Public files are served from here. Leave empty to use short-lived signed links.', placeholder: 'https://d123.cloudfront.net' },
      presignTtlSeconds: { label: 'Signed link lifetime', suffix: 'seconds' },
      maxImageBytes: { label: 'Max image size', bytes: true, suffix: 'MB' },
      maxVideoBytes: { label: 'Max video size', bytes: true, suffix: 'MB' },
      maxAudioBytes: { label: 'Max audio size', bytes: true, suffix: 'MB' },
    },
    test: { label: 'Puts, reads and deletes a test object, checks browser-upload CORS and that the CDN resolves.' },
  },
  'sms.beem': {
    title: 'SMS & OTP — Beem',
    section: 'Integrations',
    description: 'Sign-in codes, rider invites and SMS campaigns are sent through Beem Africa.',
    layout: [
      { title: 'Account', fields: ['apiKey', 'secretKey', 'senderId', 'useStaging'] },
      { title: 'One-time codes', fields: ['otpMode', 'otpAppId', 'otpTemplate', 'androidAppHash'] },
      { title: 'Messages', fields: ['riderInviteTemplate'] },
    ],
    fields: {
      apiKey: { label: 'API key' },
      secretKey: { label: 'Secret key' },
      senderId: { label: 'Sender ID', help: 'Your approved sender name (max 11 characters), e.g. SMARTWEAR.' },
      useStaging: { label: 'Use Beem sandbox' },
      otpMode: { label: 'Code delivery', options: { beem_sms: 'SmartWear generates the code, Beem SMS delivers it', beem_otp: 'Beem OTP service (request/verify with an App ID)' } },
      otpAppId: { label: 'Beem OTP App ID', help: 'Only for the Beem OTP service.' },
      otpTemplate: { label: 'Code message', multiline: true, help: 'Variables: {{code}}, {{minutes}}, {{appHash}} (keep {{appHash}} on its own last line so Android can auto-fill).' },
      androidAppHash: { label: 'Android app hash', help: '11-character hash for the SMS Retriever API (from your release signing key).' },
      riderInviteTemplate: { label: 'Rider invite', multiline: true, help: 'Variables: {{name}}, {{appLink}}.' },
    },
    test: { label: 'Checks your Beem balance, then optionally sends a test SMS.', inputs: [{ key: 'testPhone', label: 'Send a test SMS to', placeholder: '+255 7XX XXX XXX', help: 'Optional.' }] },
  },
  auth: {
    title: 'Sign-in & sessions',
    section: 'Integrations',
    description: 'Google Sign-In client IDs, phone code rules and session lifetimes.',
    layout: [
      { title: 'Google Sign-In', description: 'From Google Cloud → APIs & Services → Credentials. The app fetches the web client ID at launch.', fields: ['googleWebClientId', 'googleIosClientId', 'googleAndroidClientId'] },
      { title: 'Phone codes', fields: ['otpLength', 'otpExpiryMinutes', 'otpMaxAttempts', 'otpResendCooldownSeconds', 'otpMaxPerPhonePerHour', 'otpMaxPerDevicePerHour', 'otpMaxPerIpPerHour'] },
      { title: 'Phone numbers', fields: ['defaultCountry', 'defaultDialCode', 'requirePhoneForCheckout'] },
      { title: 'Sessions', fields: ['accessTokenTtlMinutes', 'refreshTokenTtlDays', 'adminSessionHours'] },
    ],
    fields: {
      googleWebClientId: { label: 'Web client ID', placeholder: '…apps.googleusercontent.com' },
      googleIosClientId: { label: 'iOS client ID' },
      googleAndroidClientId: { label: 'Android client ID' },
      otpLength: { label: 'Code length', suffix: 'digits' },
      otpExpiryMinutes: { label: 'Code expires after', suffix: 'minutes' },
      otpMaxAttempts: { label: 'Wrong attempts allowed' },
      otpResendCooldownSeconds: { label: 'Resend countdown', suffix: 'seconds' },
      otpMaxPerPhonePerHour: { label: 'Codes per phone / hour' },
      otpMaxPerDevicePerHour: { label: 'Codes per device / hour' },
      otpMaxPerIpPerHour: { label: 'Codes per IP / hour' },
      defaultCountry: { label: 'Default country', help: 'ISO code, e.g. TZ.' },
      defaultDialCode: { label: 'Default dial code' },
      requirePhoneForCheckout: { label: 'Ask Google users for a phone at first checkout', help: 'Riders need a number to call.' },
      accessTokenTtlMinutes: { label: 'App access token', suffix: 'minutes' },
      refreshTokenTtlDays: { label: 'App stays signed in for', suffix: 'days' },
      adminSessionHours: { label: 'Admin session', suffix: 'hours' },
      jwtSecret: { hidden: true },
    },
    test: { label: 'Validates the client ID format and, if you paste one, verifies a Google ID token.', inputs: [{ key: 'idToken', label: 'Test ID token', placeholder: 'eyJhbGciOi…', help: 'Optional — from a test sign-in.' }] },
  },
  'maps.google': {
    title: 'Google Maps Platform',
    section: 'Integrations',
    description: 'Place search, geocoding and routes are proxied through the API with this server key. The app binary only holds a display-only key.',
    layout: [
      { title: 'Keys', fields: ['serverApiKey', 'browserApiKey', 'mapId'] },
      { title: 'Search & routing', fields: ['regionCode', 'language', 'autocompleteRadiusMeters', 'routesTravelMode', 'routeCacheSeconds'] },
      { title: 'Map style', description: 'Google map style JSON for light and dark — the minimal silver look by default.', fields: ['mapStyleLight', 'mapStyleDark'] },
    ],
    fields: {
      serverApiKey: { label: 'Server API key', help: 'Restrict to Places API (New), Geocoding API and Routes API, by server IP.' },
      browserApiKey: { label: 'Admin map key', help: 'Maps JavaScript API, restricted to your admin domain.' },
      mapId: { label: 'Map ID', help: 'Optional cloud-styled map ID for the admin maps.' },
      regionCode: { label: 'Region bias' },
      language: { label: 'Result language' },
      autocompleteRadiusMeters: { label: 'Search bias radius', suffix: 'metres' },
      routesTravelMode: { label: 'Rider travel mode', options: { TWO_WHEELER: 'Motorbike', DRIVE: 'Car', BICYCLE: 'Bicycle', WALK: 'On foot' } },
      routeCacheSeconds: { label: 'Route cache', suffix: 'seconds' },
      mapStyleLight: { label: 'Light style JSON', json: true },
      mapStyleDark: { label: 'Dark style JSON', json: true },
    },
    test: { label: 'Makes a Geocoding, Places Autocomplete and Routes call and reports which APIs are enabled.' },
  },
  push: {
    title: 'Push notifications',
    section: 'Integrations',
    description: 'Order milestones, rider alerts and campaigns.',
    layout: [
      { title: 'Provider', fields: ['provider', 'expoAccessToken'] },
      { title: 'Firebase / APNs', description: 'Only when sending directly instead of through Expo.', fields: ['fcmServiceAccountJson', 'apnsKeyP8', 'apnsKeyId', 'apnsTeamId', 'apnsBundleId', 'apnsSandbox'] },
    ],
    fields: {
      provider: { label: 'Provider', options: { expo: 'Expo Push', fcm_apns: 'Firebase + APNs directly' } },
      expoAccessToken: { label: 'Expo access token' },
      fcmServiceAccountJson: { label: 'FCM service account JSON', multiline: true },
      apnsKeyP8: { label: 'APNs key (.p8)', multiline: true },
      apnsKeyId: { label: 'APNs key ID' },
      apnsTeamId: { label: 'Apple team ID' },
      apnsBundleId: { label: 'Bundle ID' },
      apnsSandbox: { label: 'APNs sandbox' },
    },
    test: { label: 'Sends a test notification to your own registered devices.' },
  },
  payments: {
    title: 'Payments',
    section: 'Integrations',
    description: 'Cash on delivery and mobile money through Beem Checkout.',
    layout: [
      { title: 'Cash on delivery', fields: ['cashOnDeliveryEnabled', 'cashOnDeliveryMaxAmount'] },
      { title: 'Mobile money', fields: ['mobileMoneyProvider', 'beemCheckoutApiKey', 'beemCheckoutSecretKey', 'beemCheckoutCallbackSecret', 'beemCheckoutReferencePrefix', 'publicApiBaseUrl'] },
    ],
    fields: {
      cashOnDeliveryEnabled: { label: 'Accept cash on delivery' },
      cashOnDeliveryMaxAmount: { label: 'Cash limit per order', money: true, help: 'Leave empty for no limit.' },
      mobileMoneyProvider: { label: 'Mobile money', options: { none: 'Off', beem_checkout: 'Beem Checkout (M-Pesa, Tigo Pesa, Airtel Money…)' } },
      beemCheckoutApiKey: { label: 'Checkout API key' },
      beemCheckoutSecretKey: { label: 'Checkout secret key' },
      beemCheckoutCallbackSecret: { label: 'Callback secure token', help: 'Beem sends it in the beem-secure-token header; callbacks without it are rejected.' },
      beemCheckoutReferencePrefix: { label: 'Reference prefix' },
      publicApiBaseUrl: { label: 'Public API URL', help: 'Where Beem sends payment callbacks.', placeholder: 'https://api.smartwear.co.tz' },
      cardProvider: { hidden: true },
    },
    test: { label: 'Pings the payment provider in sandbox mode.' },
  },
  'delivery.pricing': {
    title: 'Delivery fees',
    section: 'Delivery',
    description: 'How the delivery fee is calculated from the distance to the nearest store that has the items. Zone overrides are drawn on the map under Delivery zones.',
    layout: [
      { title: 'Formula', fields: ['baseFee', 'perKm', 'includedMeters', 'minimumFee', 'roundTo', 'freeDeliveryThreshold', 'maxDistanceMeters'] },
      { title: 'Delivery options', description: 'Shown as cards at checkout.', fields: ['options'] },
      { title: 'Peak hours', fields: ['peakWindows'] },
      { title: 'Rider earnings', fields: ['riderEarning'] },
    ],
    fields: {
      baseFee: { label: 'Base fee', money: true },
      perKm: { label: 'Per km', money: true },
      includedMeters: { label: 'Included distance', suffix: 'metres' },
      minimumFee: { label: 'Minimum fee', money: true },
      roundTo: { label: 'Round to nearest', money: true },
      freeDeliveryThreshold: { label: 'Free delivery over', money: true, help: 'Leave empty to always charge.' },
      maxDistanceMeters: { label: 'Furthest delivery', suffix: 'metres' },
      currency: { hidden: true },
      feeMultiplier: { label: 'Fee multiplier', suffix: '×' },
      surcharge: { label: 'Surcharge', money: true },
      etaMinMinutes: { label: 'ETA from', suffix: 'min' },
      etaMaxMinutes: { label: 'ETA to', suffix: 'min' },
      multiplier: { label: 'Multiplier', suffix: '×' },
      shareOfFeeBps: { label: 'Share of delivery fee', help: 'Basis points (10000 = 100%). 0 uses the formula above.' },
    },
  },
  'delivery.dispatch': {
    title: 'Dispatch rules',
    section: 'Delivery',
    description: 'How orders find a rider: who is offered first, how long they have, and how far the search widens.',
    layout: [
      { title: 'Mode', fields: ['mode', 'strategy', 'batchSize', 'offerTimeoutSeconds'] },
      { title: 'Search radius', fields: ['initialRadiusMeters', 'radiusStepMeters', 'maxRadiusMeters', 'maxRounds', 'noRiderAlertMinutes'] },
      { title: 'Eligibility', fields: ['eligibleVehicleTypes', 'maxConcurrentJobsPerRider', 'heartbeatTtlSeconds', 'workingHours'] },
      { title: 'Delivery PIN', fields: ['deliveryPinEnabled', 'deliveryPinLength'] },
      { title: 'Ranking weights', fields: ['weights'] },
    ],
    fields: {
      mode: { label: 'Dispatch mode', options: { auto: 'Automatic', manual: 'Manual — dispatcher assigns', hybrid: 'Automatic with dispatcher override' } },
      strategy: { label: 'Offer strategy', options: { sequential: 'One rider at a time (nearest first)', batch: 'Several riders at once — first to accept wins' } },
      batchSize: { label: 'Riders per batch' },
      offerTimeoutSeconds: { label: 'Time to accept', suffix: 'seconds' },
      initialRadiusMeters: { label: 'Start searching within', suffix: 'metres' },
      radiusStepMeters: { label: 'Widen by', suffix: 'metres per round' },
      maxRadiusMeters: { label: 'Never search beyond', suffix: 'metres' },
      maxRounds: { label: 'Rounds before alerting' },
      noRiderAlertMinutes: { label: 'Alert dispatchers after', suffix: 'minutes' },
      eligibleVehicleTypes: { label: 'Vehicles allowed', options: { MOTORBIKE: 'Motorbike', BICYCLE: 'Bicycle', CAR: 'Car', ON_FOOT: 'On foot' } },
      maxConcurrentJobsPerRider: { label: 'Orders per rider at once' },
      heartbeatTtlSeconds: { label: 'Treat rider as offline after', suffix: 'seconds without location' },
      deliveryPinEnabled: { label: 'Require a delivery PIN', help: 'The customer reads a code to the rider at the door.' },
      deliveryPinLength: { label: 'PIN length', suffix: 'digits' },
    },
  },
  checkout: {
    title: 'Checkout',
    section: 'Store',
    description: 'Checkout has no forms by default. Add optional fields here only if you need them.',
    layout: [
      { title: 'Behaviour', fields: ['slideToConfirm', 'minOrderAmount', 'prepTimeMinutes', 'showDeliveryEstimateOnPdp', 'allowGuestCheckout'] },
      { title: 'Extra fields', description: 'Shown collapsed and optional unless marked required.', fields: ['extraFields'] },
    ],
    fields: {
      slideToConfirm: { label: 'Slide to place order', help: 'Instead of a tap — prevents accidental orders.' },
      minOrderAmount: { label: 'Minimum order', money: true },
      prepTimeMinutes: { label: 'Store preparation time', suffix: 'minutes' },
      showDeliveryEstimateOnPdp: { label: 'Show “Arrives today by…” on product pages' },
      allowGuestCheckout: { label: 'Allow checkout without an account' },
    },
  },
  'pricing.wholesale': {
    title: 'Retail & wholesale pricing',
    section: 'Store',
    description: 'Who sees bulk prices, how they apply, and how prices are rounded and taxed.',
    fields: {
      visibility: { label: 'Who sees wholesale prices', options: { everyone: 'Everyone', approved_only: 'Approved wholesale accounts only', hidden: 'Nobody (hidden)' } },
      autoTiersForRetail: { label: 'Apply bulk tiers automatically by quantity', help: 'Retail customers who add enough units get the tier price.' },
      rounding: { label: 'Rounding', options: { none: 'None', nearest_10: 'Nearest 10', nearest_50: 'Nearest 50', nearest_100: 'Nearest 100', nearest_500: 'Nearest 500', nearest_1000: 'Nearest 1,000', up_100: 'Up to 100', down_100: 'Down to 100' } },
      taxInclusive: { label: 'Prices include tax' },
      taxRateBps: { label: 'Tax rate', help: 'Basis points (1800 = 18% VAT).' },
      currency: { label: 'Store currency' },
    },
  },
  branding: {
    title: 'Business & branding',
    section: 'Store',
    description: 'Store name, contact details and links the apps show.',
    fields: {
      storeName: { label: 'Store name' },
      tagline: { label: 'Tagline (English)' },
      taglineSw: { label: 'Tagline (Swahili)' },
      supportPhone: { label: 'Support phone' },
      supportEmail: { label: 'Support email' },
      supportWhatsApp: { label: 'WhatsApp' },
      logoMediaId: { hidden: true },
      welcomeVideoMediaId: { hidden: true },
      welcomeImageMediaId: { hidden: true },
      accentLight: { label: 'Accent (light)', help: 'Within the champagne family only.' },
      accentDark: { label: 'Accent (dark)' },
    },
  },
  features: {
    title: 'Feature flags',
    section: 'Store',
    description: 'Switch app features on and off instantly — no release needed.',
    fields: {
      guestBrowsing: { label: 'Browse without signing in' },
      looksFeed: { label: 'Discover / Looks feed' },
      stories: { label: 'Stories row' },
      wishlistBoards: { label: 'Wishlist boards' },
      loyalty: { label: 'Loyalty points' },
      reviews: { label: 'Product reviews' },
      returns: { label: 'Return & exchange requests' },
      chatSupport: { label: 'In-app support chat' },
      wholesaleApplications: { label: 'Wholesale applications' },
      styleQuiz: { label: 'Style quiz for new customers' },
      shareTracking: { label: 'Share live tracking link' },
      minAppVersionIos: { label: 'Minimum iOS version' },
      minAppVersionAndroid: { label: 'Minimum Android version' },
      maintenanceMode: { label: 'Maintenance mode', help: 'The app shows a calm “back soon” screen.' },
      maintenanceMessage: { label: 'Maintenance message', multiline: true },
    },
  },
  media: {
    title: 'Media pipeline',
    section: 'Content',
    description: 'How uploads are optimised: sizes, quality, video and audio processing.',
    fields: {
      imageMasterMaxEdge: { label: 'Master image long edge', suffix: 'px' },
      imageWidths: { label: 'Rendition widths', suffix: 'px' },
      avifQuality: { label: 'AVIF quality' },
      webpQuality: { label: 'WebP quality' },
      jpegQuality: { label: 'JPEG quality' },
      smartCropAspect: { label: 'Product crop', help: 'Always 4:5 for a consistent grid.' },
      videoResolutions: { label: 'Video heights', suffix: 'p' },
      videoMaxBitrateKbps: { label: 'Max video bitrate', suffix: 'kbps' },
      hlsMinDurationSeconds: { label: 'Use HLS for videos longer than', suffix: 'seconds' },
      previewLoopSeconds: { label: 'Feed preview loop', suffix: 'seconds' },
      audioBitrateKbps: { label: 'Audio bitrate', suffix: 'kbps' },
      audioLoudnessLufs: { label: 'Audio loudness target', suffix: 'LUFS' },
      autoEnhanceDefault: { label: 'Auto-enhance new images' },
      orphanCleanupHours: { label: 'Delete abandoned uploads after', suffix: 'hours' },
    },
  },
  'notifications.templates': { title: 'Notification templates', section: 'Content', description: 'SMS, push and email wording with variables — English and Swahili.' },
  localization: {
    title: 'Languages & currency',
    section: 'Content',
    description: 'English and Swahili; TZS by default.',
    fields: { defaultLocale: { label: 'Default language', options: { en: 'English', sw: 'Kiswahili' } }, enabledLocales: { label: 'Languages', options: { en: 'English', sw: 'Kiswahili' } } },
  },
  loyalty: { title: 'Loyalty', section: 'Store', description: 'Points earned per order and the tiers customers progress through.' },
  search: { title: 'Search', section: 'Content', description: 'Typo tolerance and synonyms for product search.' },
};

export const humanize = (k: string) =>
  k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._]/g, ' ')
    .replace(/\bbps\b/i, '(bps)')
    .replace(/^./, (c) => c.toUpperCase());
