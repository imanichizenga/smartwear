import { z } from 'zod';
import { IdSchema, OkSchema } from './common';

export const DeviceInfoSchema = z.object({
  deviceId: z.string().min(8).max(128),
  platform: z.enum(['ios', 'android', 'web']),
  model: z.string().max(100).optional(),
  appVersion: z.string().max(32).optional(),
  pushToken: z.string().max(256).optional(),
  locale: z.string().max(10).optional(),
});

export const OtpRequestSchema = z.object({ phone: z.string().min(6).max(20), device: DeviceInfoSchema });
export const OtpRequestResponseSchema = z.object({
  challengeId: IdSchema,
  phone: z.string(),
  expiresInSeconds: z.number().int(),
  resendInSeconds: z.number().int(),
  codeLength: z.number().int(),
});

export const OtpVerifySchema = z.object({ challengeId: IdSchema, code: z.string().min(4).max(8), device: DeviceInfoSchema });

export const UserRoleSchema = z.enum(['CUSTOMER', 'RIDER']);

export const UserProfileSchema = z.object({
  id: IdSchema,
  phone: z.string().nullable(),
  phoneVerified: z.boolean(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  locale: z.string(),
  customerType: z.enum(['RETAIL', 'WHOLESALE']),
  wholesaleStatus: z.enum(['NONE', 'PENDING', 'APPROVED', 'REJECTED']),
  roles: z.array(UserRoleSchema),
  hasGoogle: z.boolean(),
  isNew: z.boolean(),
  styleQuizCompleted: z.boolean(),
  loyaltyPoints: z.number().int(),
  loyaltyTier: z.string(),
  createdAt: z.string(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const TokenPairSchema = z.object({ accessToken: z.string(), refreshToken: z.string(), accessExpiresIn: z.number().int() });
export const AuthResultSchema = z.object({ tokens: TokenPairSchema, user: UserProfileSchema });
export type AuthResult = z.infer<typeof AuthResultSchema>;

export const GoogleSignInSchema = z.object({ idToken: z.string().min(20), device: DeviceInfoSchema });
export const RefreshSchema = z.object({ refreshToken: z.string().min(20), device: DeviceInfoSchema.pick({ deviceId: true }) });
export const LogoutSchema = z.object({ refreshToken: z.string().optional(), allDevices: z.boolean().default(false) });

export const LinkPhoneSchema = OtpVerifySchema;
export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  email: z.string().email().optional(),
  locale: z.enum(['en', 'sw']).optional(),
  avatarMediaId: IdSchema.nullable().optional(),
});

export const SessionOutSchema = z.object({ id: IdSchema, deviceId: z.string(), platform: z.string(), model: z.string().nullable(), lastSeenAt: z.string(), createdAt: z.string(), current: z.boolean() });

// Admin
export const AdminLoginSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });
export const AdminLoginResponseSchema = z.discriminatedUnion('step', [
  z.object({ step: z.literal('totp_required'), pendingToken: z.string() }),
  z.object({ step: z.literal('totp_setup_required'), pendingToken: z.string(), otpauthUrl: z.string(), secret: z.string() }),
]);
export const AdminTotpSchema = z.object({ pendingToken: z.string(), code: z.string().length(6) });
export const AdminUserOutSchema = z.object({
  id: IdSchema, email: z.string(), name: z.string(), role: z.enum(['SUPER_ADMIN', 'MANAGER', 'CATALOG_EDITOR', 'DISPATCHER', 'SUPPORT', 'FINANCE']), permissions: z.array(z.string()), avatarUrl: z.string().nullable(), totpEnabled: z.boolean(), lastLoginAt: z.string().nullable(),
});
export type AdminUserOut = z.infer<typeof AdminUserOutSchema>;
export const AdminSessionOutSchema = z.object({ id: IdSchema, ip: z.string().nullable(), userAgent: z.string().nullable(), createdAt: z.string(), lastSeenAt: z.string(), current: z.boolean() });
export const AdminReauthSchema = z.object({ password: z.string().optional(), code: z.string().length(6).optional() });
export const AdminInviteSchema = z.object({ email: z.string().email(), name: z.string().min(1), role: AdminUserOutSchema.shape.role });
export const AdminAcceptInviteSchema = z.object({ token: z.string(), password: z.string().min(10).max(200) });
export const AdminChangePasswordSchema = z.object({ currentPassword: z.string(), newPassword: z.string().min(10).max(200) });
export { OkSchema };
