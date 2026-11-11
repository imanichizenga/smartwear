import { z } from 'zod';
import { IdSchema, MediaOutSchema } from './common';

export const PresignRequestSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(3).max(100),
  bytes: z.number().int().min(1),
  type: z.enum(['IMAGE', 'VIDEO', 'AUDIO']),
  purpose: z.enum(['product', 'avatar', 'review', 'rider_document', 'rider_photo', 'proof', 'story', 'look', 'brand', 'category', 'wholesale_licence', 'chat']).default('product'),
  /** Multipart for big uploads: the API decides based on size and returns part URLs. */
  multipart: z.boolean().default(false),
  options: z.object({ backgroundCleanup: z.boolean().default(false), autoEnhance: z.boolean().default(false), focalX: z.number().min(0).max(1).optional(), focalY: z.number().min(0).max(1).optional(), role: z.string().optional() }).default({ backgroundCleanup: false, autoEnhance: false }),
});
export const PresignResponseSchema = z.object({
  mediaId: IdSchema, key: z.string(),
  single: z.object({ url: z.string(), headers: z.record(z.string(), z.string()), expiresAt: z.string() }).nullable(),
  multipart: z.object({ uploadId: z.string(), partSizeBytes: z.number().int(), parts: z.array(z.object({ partNumber: z.number().int(), url: z.string() })), expiresAt: z.string() }).nullable(),
});
export const CompleteUploadSchema = z.object({ mediaId: IdSchema, parts: z.array(z.object({ partNumber: z.number().int(), etag: z.string() })).optional() });
export const MediaUpdateSchema = z.object({ alt: z.string().max(200).nullable().optional(), focalX: z.number().min(0).max(1).optional(), focalY: z.number().min(0).max(1).optional(), role: z.string().nullable().optional(), rotate: z.number().int().optional(), crop: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(), posterAtMs: z.number().int().optional(), trim: z.object({ startMs: z.number().int(), endMs: z.number().int() }).optional(), reprocess: z.boolean().default(false) });
export const MediaListQuerySchema = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(40), type: z.enum(['IMAGE', 'VIDEO', 'AUDIO']).optional(), purpose: z.string().optional(), q: z.string().optional() });
export { MediaOutSchema };
