"""
Every settings group is a pydantic model (server source of truth; packages/shared mirrors it in Zod for the admin forms).
Secret fields are listed in SECRET_FIELDS and encrypted at rest.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

SECRET_PLACEHOLDER = "__SECRET_UNCHANGED__"


class StorageS3(BaseModel):
    provider: Literal["aws", "s3_compatible"] = "aws"
    bucket: str = ""
    region: str = "eu-west-1"
    accessKeyId: str = ""
    secretAccessKey: str = ""
    endpoint: str = ""
    forcePathStyle: bool = False
    cdnBaseUrl: str = ""
    keyPrefix: str = "media"
    presignTtlSeconds: int = Field(900, ge=60, le=3600)
    maxImageBytes: int = 25 * 1024 * 1024
    maxVideoBytes: int = 1024 * 1024 * 1024
    maxAudioBytes: int = 50 * 1024 * 1024


class SmsBeem(BaseModel):
    apiKey: str = ""
    secretKey: str = ""
    senderId: str = Field("", max_length=11)
    otpMode: Literal["beem_sms", "beem_otp"] = "beem_sms"
    otpAppId: str = ""
    otpTemplate: str = "{{code}} is your SmartWear code. It expires in {{minutes}} minutes.\n{{appHash}}"
    androidAppHash: str = ""
    useStaging: bool = False
    riderInviteTemplate: str = "Karibu SmartWear, {{name}}! You are registered as a rider. Download the app: {{appLink}} and sign in with this number."


class Auth(BaseModel):
    googleWebClientId: str = ""
    googleIosClientId: str = ""
    googleAndroidClientId: str = ""
    otpLength: int = Field(6, ge=4, le=8)
    otpExpiryMinutes: int = Field(5, ge=1, le=30)
    otpMaxAttempts: int = Field(5, ge=3, le=10)
    otpResendCooldownSeconds: int = Field(30, ge=15, le=300)
    otpMaxPerPhonePerHour: int = Field(5, ge=1)
    otpMaxPerIpPerHour: int = Field(30, ge=1)
    otpMaxPerDevicePerHour: int = Field(10, ge=1)
    accessTokenTtlMinutes: int = Field(15, ge=5, le=120)
    refreshTokenTtlDays: int = Field(60, ge=1, le=365)
    requirePhoneForCheckout: bool = True
    defaultCountry: str = Field("TZ", min_length=2, max_length=2)
    defaultDialCode: str = "+255"
    adminSessionHours: int = Field(12, ge=1, le=72)
    jwtSecret: str = ""


class MapsGoogle(BaseModel):
    serverApiKey: str = ""
    browserApiKey: str = ""
    mapId: str = ""
    regionCode: str = Field("tz", min_length=2, max_length=2)
    language: str = "en"
    autocompleteRadiusMeters: int = Field(30000, ge=1000, le=50000)
    routesTravelMode: Literal["TWO_WHEELER", "DRIVE", "BICYCLE", "WALK"] = "TWO_WHEELER"
    routeCacheSeconds: int = Field(60, ge=10, le=600)
    mapStyleLight: list[dict[str, Any]] = []
    mapStyleDark: list[dict[str, Any]] = []


class Push(BaseModel):
    provider: Literal["expo", "fcm_apns"] = "expo"
    expoAccessToken: str = ""
    fcmServiceAccountJson: str = ""
    apnsKeyP8: str = ""
    apnsKeyId: str = ""
    apnsTeamId: str = ""
    apnsBundleId: str = "africa.smartwear.app"
    apnsSandbox: bool = False


class Payments(BaseModel):
    cashOnDeliveryEnabled: bool = True
    cashOnDeliveryMaxAmount: int | None = None
    mobileMoneyProvider: Literal["none", "beem_checkout"] = "none"
    beemCheckoutApiKey: str = ""
    beemCheckoutSecretKey: str = ""
    beemCheckoutReferencePrefix: str = "SW"
    beemCheckoutCallbackSecret: str = ""
    cardProvider: Literal["none"] = "none"
    publicApiBaseUrl: str = ""


class DeliveryOption(BaseModel):
    id: str
    name: str
    nameSw: str | None = None
    description: str | None = None
    kind: Literal["express", "standard", "pickup"]
    enabled: bool = True
    feeMultiplier: float = Field(1, ge=0)
    surcharge: int = Field(0, ge=0)
    etaMinMinutes: int = Field(ge=0)
    etaMaxMinutes: int = Field(ge=0)
    sortOrder: int = 0


class PeakWindow(BaseModel):
    days: list[int] = []
    startHour: int = Field(ge=0, le=23)
    endHour: int = Field(ge=1, le=24)
    multiplier: float = Field(ge=1, le=5)


class RiderEarning(BaseModel):
    baseFee: int = 1500
    perKm: int = 400
    minimum: int = 2000
    shareOfFeeBps: int = Field(0, ge=0, le=10000)


class DeliveryPricing(BaseModel):
    currency: str = "TZS"
    baseFee: int = Field(2000, ge=0)
    perKm: int = Field(700, ge=0)
    minimumFee: int = Field(2500, ge=0)
    freeDeliveryThreshold: int | None = None
    roundTo: int = Field(100, ge=1)
    includedMeters: int = Field(1000, ge=0)
    maxDistanceMeters: int = Field(35000, ge=1000)
    peakWindows: list[PeakWindow] = []
    options: list[DeliveryOption] = [
        DeliveryOption(id="express", name="Express", nameSw="Haraka", kind="express", feeMultiplier=1.5, etaMinMinutes=25, etaMaxMinutes=45, sortOrder=0),
        DeliveryOption(id="standard", name="Standard", nameSw="Kawaida", kind="standard", feeMultiplier=1, etaMinMinutes=60, etaMaxMinutes=120, sortOrder=1),
        DeliveryOption(id="pickup", name="Store pickup", nameSw="Chukua dukani", kind="pickup", feeMultiplier=0, etaMinMinutes=30, etaMaxMinutes=90, sortOrder=2),
    ]
    riderEarning: RiderEarning = RiderEarning()


class DispatchWeights(BaseModel):
    distance: float = 1
    rating: float = 0.15
    recency: float = 0.05


class WorkingHours(BaseModel):
    start: str = "07:00"
    end: str = "22:00"
    timezone: str = "Africa/Dar_es_Salaam"


class DeliveryDispatch(BaseModel):
    mode: Literal["auto", "manual", "hybrid"] = "auto"
    strategy: Literal["sequential", "batch"] = "sequential"
    batchSize: int = Field(3, ge=1, le=10)
    offerTimeoutSeconds: int = Field(20, ge=5, le=120)
    initialRadiusMeters: int = Field(2500, ge=200)
    radiusStepMeters: int = Field(1500, ge=100)
    maxRadiusMeters: int = Field(12000, ge=500)
    maxRounds: int = Field(6, ge=1, le=20)
    maxConcurrentJobsPerRider: int = Field(1, ge=1, le=5)
    eligibleVehicleTypes: list[Literal["MOTORBIKE", "BICYCLE", "CAR", "ON_FOOT"]] = ["MOTORBIKE", "BICYCLE", "CAR", "ON_FOOT"]
    heartbeatTtlSeconds: int = Field(45, ge=10)
    noRiderAlertMinutes: int = Field(5, ge=1)
    weights: DispatchWeights = DispatchWeights()
    deliveryPinEnabled: bool = True
    deliveryPinLength: int = Field(4, ge=4, le=6)
    workingHours: WorkingHours = WorkingHours()


class CheckoutExtraField(BaseModel):
    key: str = Field(pattern=r"^[a-zA-Z][a-zA-Z0-9_]*$")
    label: str
    labelSw: str | None = None
    type: Literal["text", "textarea", "phone", "select"]
    required: bool = False
    options: list[str] | None = None
    placeholder: str | None = None


class Checkout(BaseModel):
    extraFields: list[CheckoutExtraField] = []
    slideToConfirm: bool = False
    prepTimeMinutes: int = Field(20, ge=0, le=240)
    allowGuestCheckout: bool = False
    minOrderAmount: int = Field(0, ge=0)
    showDeliveryEstimateOnPdp: bool = True


class PricingWholesale(BaseModel):
    visibility: Literal["everyone", "approved_only", "hidden"] = "approved_only"
    autoTiersForRetail: bool = True
    rounding: Literal["none", "nearest_10", "nearest_50", "nearest_100", "nearest_500", "nearest_1000", "up_100", "down_100"] = "none"
    taxInclusive: bool = True
    taxRateBps: int = Field(0, ge=0, le=10000)
    currency: str = "TZS"


class Branding(BaseModel):
    storeName: str = "SmartWear"
    tagline: str = "Fashion & beauty, delivered."
    taglineSw: str = "Mitindo na urembo, hadi mlangoni."
    supportPhone: str = ""
    supportEmail: str = ""
    supportWhatsApp: str = ""
    logoMediaId: str | None = None
    welcomeVideoMediaId: str | None = None
    welcomeImageMediaId: str | None = None
    accentLight: str = Field("#B8955A", pattern=r"^#[0-9a-fA-F]{6}$")
    accentDark: str = Field("#D1B07A", pattern=r"^#[0-9a-fA-F]{6}$")
    appStoreUrl: str = ""
    playStoreUrl: str = ""
    appDownloadLink: str = ""
    adminUrl: str = "http://localhost:3000"
    publicWebUrl: str = "http://localhost:3000"


class Features(BaseModel):
    guestBrowsing: bool = True
    looksFeed: bool = True
    stories: bool = True
    wishlistBoards: bool = True
    loyalty: bool = True
    reviews: bool = True
    returns: bool = True
    chatSupport: bool = True
    wholesaleApplications: bool = True
    styleQuiz: bool = True
    shareTracking: bool = True
    minAppVersionIos: str = "1.0.0"
    minAppVersionAndroid: str = "1.0.0"
    maintenanceMode: bool = False
    maintenanceMessage: str = ""


class BackgroundCleanup(BaseModel):
    provider: Literal["none", "removebg", "http"] = "none"
    apiKey: str = ""
    endpoint: str = ""
    studioBackground: str = "#F5F2EC"


class MediaConvert(BaseModel):
    enabled: bool = False
    roleArn: str = ""
    queueArn: str = ""
    endpoint: str = ""


class MediaSettings(BaseModel):
    imageMasterMaxEdge: int = Field(2400, ge=1200, le=4000)
    imageWidths: list[int] = [320, 640, 960, 1280, 1920]
    avifQuality: int = Field(50, ge=30, le=90)
    webpQuality: int = Field(72, ge=40, le=95)
    jpegQuality: int = Field(78, ge=50, le=95)
    smartCropAspect: str = "4:5"
    videoResolutions: list[int] = [720, 1080]
    videoMaxBitrateKbps: int = 4500
    hlsMinDurationSeconds: int = 45
    previewLoopSeconds: int = Field(4, ge=2, le=10)
    audioBitrateKbps: int = Field(112, ge=64, le=192)
    audioLoudnessLufs: float = -16
    backgroundCleanup: BackgroundCleanup = BackgroundCleanup()
    autoEnhanceDefault: bool = False
    orphanCleanupHours: int = Field(24, ge=1)
    mediaConvert: MediaConvert = MediaConvert()


class NotificationTemplate(BaseModel):
    key: str
    channel: Literal["sms", "push", "email"]
    title: str = ""
    body: str
    bodySw: str | None = None
    enabled: bool = True


DEFAULT_TEMPLATES = [
    NotificationTemplate(key="order.confirmed", channel="push", title="Order confirmed", body="Your order {{orderNumber}} is confirmed. We are preparing it now.", bodySw="Oda yako {{orderNumber}} imethibitishwa. Tunaiandaa sasa."),
    NotificationTemplate(key="order.rider_assigned", channel="push", title="Rider on the way to the store", body="{{riderName}} will deliver your order.", bodySw="{{riderName}} ataleta oda yako."),
    NotificationTemplate(key="order.on_the_way", channel="push", title="On the way", body="Your order is on its way. ETA {{eta}}.", bodySw="Oda yako iko njiani. Inafika {{eta}}."),
    NotificationTemplate(key="order.nearby", channel="push", title="Almost there", body="Your rider is {{minutes}} min away.", bodySw="Dereva yuko dakika {{minutes}}."),
    NotificationTemplate(key="order.arrived", channel="push", title="Your rider has arrived", body="Share PIN {{pin}} with your rider to receive your order.", bodySw="Mpe dereva PIN {{pin}} kupokea oda yako."),
    NotificationTemplate(key="order.delivered", channel="push", title="Delivered", body="Enjoy! Tap to rate your experience.", bodySw="Furahia! Gusa kutoa maoni."),
    NotificationTemplate(key="order.no_rider", channel="push", title="Looking for a rider", body="Riders are busy right now. We are still searching for you.", bodySw="Madereva wana shughuli sasa. Bado tunatafuta."),
    NotificationTemplate(key="order.cancelled", channel="push", title="Order cancelled", body="Order {{orderNumber}} was cancelled.", bodySw="Oda {{orderNumber}} imeghairiwa."),
    NotificationTemplate(key="order.confirmed", channel="sms", body="SmartWear: order {{orderNumber}} confirmed. Track it in the app.", enabled=False),
    NotificationTemplate(key="order.ready_pickup", channel="push", title="Ready for pickup", body="Order {{orderNumber}} is ready at {{storeName}}.", bodySw="Oda {{orderNumber}} iko tayari {{storeName}}."),
    NotificationTemplate(key="drop.live", channel="push", title="{{dropName}} is live", body="The drop you were waiting for just launched."),
    NotificationTemplate(key="wishlist.price_drop", channel="push", title="Price drop", body="{{productTitle}} is now {{price}}."),
    NotificationTemplate(key="rider.new_job", channel="push", title="New delivery request", body="Pickup at {{storeName}} · {{distance}} · {{earning}}"),
    NotificationTemplate(key="wholesale.approved", channel="push", title="Wholesale approved", body="Your wholesale account is active. Bulk prices are now shown."),
]


class NotificationTemplates(BaseModel):
    templates: list[NotificationTemplate] = DEFAULT_TEMPLATES


class Localization(BaseModel):
    defaultLocale: Literal["en", "sw"] = "en"
    enabledLocales: list[Literal["en", "sw"]] = ["en", "sw"]
    currency: str = "TZS"
    enabledCurrencies: list[str] = ["TZS"]
    timezone: str = "Africa/Dar_es_Salaam"


class LoyaltyTier(BaseModel):
    name: str
    minPoints: int = Field(ge=0)
    perk: str = ""


class Loyalty(BaseModel):
    enabled: bool = True
    pointsPerCurrencyUnit: float = 0.001
    tiers: list[LoyaltyTier] = [LoyaltyTier(name="Atelier", minPoints=0, perk="Welcome to SmartWear"), LoyaltyTier(name="Maison", minPoints=500, perk="Early access to drops"), LoyaltyTier(name="Couture", minPoints=2000, perk="Free express delivery")]
    redeemRate: float = 10


class Search(BaseModel):
    trending: list[str] = ["linen dress", "gold hoops", "loafers", "vitamin C serum", "oud perfume"]
    typoTolerance: bool = True
    resultsPerPage: int = Field(24, ge=10, le=60)


SETTINGS_GROUPS: dict[str, type[BaseModel]] = {
    "storage.s3": StorageS3,
    "sms.beem": SmsBeem,
    "auth": Auth,
    "maps.google": MapsGoogle,
    "push": Push,
    "payments": Payments,
    "delivery.pricing": DeliveryPricing,
    "delivery.dispatch": DeliveryDispatch,
    "checkout": Checkout,
    "pricing.wholesale": PricingWholesale,
    "branding": Branding,
    "features": Features,
    "media": MediaSettings,
    "notifications.templates": NotificationTemplates,
    "localization": Localization,
    "loyalty": Loyalty,
    "search": Search,
}

SECRET_FIELDS: dict[str, list[str]] = {
    "storage.s3": ["accessKeyId", "secretAccessKey"],
    "sms.beem": ["apiKey", "secretKey"],
    "auth": ["jwtSecret"],
    "maps.google": ["serverApiKey"],
    "push": ["expoAccessToken", "fcmServiceAccountJson", "apnsKeyP8"],
    "payments": ["beemCheckoutApiKey", "beemCheckoutSecretKey", "beemCheckoutCallbackSecret"],
    "media": ["backgroundCleanup.apiKey"],
}

PUBLIC_CONFIG_PICK: dict[str, list[str] | str] = {
    "branding": ["storeName", "tagline", "taglineSw", "supportPhone", "supportEmail", "supportWhatsApp", "accentLight", "accentDark", "logoMediaId", "welcomeVideoMediaId", "welcomeImageMediaId", "appDownloadLink"],
    "features": "*",
    "checkout": ["extraFields", "slideToConfirm", "allowGuestCheckout", "minOrderAmount", "showDeliveryEstimateOnPdp"],
    "localization": "*",
    "auth": ["googleWebClientId", "googleIosClientId", "googleAndroidClientId", "otpLength", "otpResendCooldownSeconds", "requirePhoneForCheckout", "defaultCountry", "defaultDialCode"],
    "maps.google": ["mapStyleLight", "mapStyleDark", "regionCode"],
    "pricing.wholesale": ["visibility", "autoTiersForRetail", "currency", "taxInclusive"],
    "delivery.pricing": ["options", "currency", "freeDeliveryThreshold"],
    "delivery.dispatch": ["deliveryPinEnabled", "offerTimeoutSeconds"],
    "payments": ["cashOnDeliveryEnabled", "cashOnDeliveryMaxAmount", "mobileMoneyProvider", "cardProvider"],
    "loyalty": "*",
    "search": ["trending"],
}


class IntegrationMeta(BaseModel):
    group: str
    title: str
    description: str
    consoleUrl: str = ""
    docsUrl: str = ""
    requiredFields: list[str]
    testable: bool = True


INTEGRATIONS = [
    IntegrationMeta(group="storage.s3", title="Media storage (S3)", description="Private bucket for all product media, served through a CDN.", consoleUrl="https://s3.console.aws.amazon.com/s3/home", docsUrl="https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html", requiredFields=["bucket", "region", "accessKeyId", "secretAccessKey"]),
    IntegrationMeta(group="sms.beem", title="SMS & OTP (Beem)", description="Phone verification codes, rider invites and SMS campaigns.", consoleUrl="https://login.beem.africa/", docsUrl="https://docs.beem.africa", requiredFields=["apiKey", "secretKey", "senderId"]),
    IntegrationMeta(group="auth", title="Google Sign-In", description="Client IDs used to verify Google ID tokens from the mobile app.", consoleUrl="https://console.cloud.google.com/apis/credentials", docsUrl="https://developers.google.com/identity", requiredFields=["googleWebClientId"]),
    IntegrationMeta(group="maps.google", title="Google Maps Platform", description="Places Autocomplete (New), Geocoding and Routes — all proxied by the API.", consoleUrl="https://console.cloud.google.com/google/maps-apis", docsUrl="https://developers.google.com/maps/documentation", requiredFields=["serverApiKey"]),
    IntegrationMeta(group="push", title="Push notifications", description="Expo Push or FCM/APNs credentials.", consoleUrl="https://expo.dev/accounts", docsUrl="https://docs.expo.dev/push-notifications/overview/", requiredFields=["provider"]),
    IntegrationMeta(group="payments", title="Payments", description="Cash on delivery and mobile money via Beem Checkout.", consoleUrl="https://login.beem.africa/", docsUrl="https://docs.beem.africa/guides/payments-checkout/index.md", requiredFields=[]),
]
