import { z } from 'zod';

export const IdSchema = z.string().min(1).max(64);
export const CursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export type CursorQuery = z.infer<typeof CursorQuerySchema>;

export const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable(), total: z.number().int().optional() });

export const ErrorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export const LatLngSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export const MoneyOutSchema = z.object({ amount: z.number().int(), currency: z.string().length(3) });
export const OkSchema = z.object({ ok: z.literal(true) });

export const LocalizedStringSchema = z.object({ en: z.string(), sw: z.string().optional() });

export const MediaVariantSchema = z.object({
  width: z.number().int(),
  height: z.number().int(),
  format: z.enum(['avif', 'webp', 'jpeg', 'mp4', 'm3u8', 'm4a', 'png']),
  key: z.string(),
  bytes: z.number().int(),
  label: z.string().optional(), // e.g. '720p', 'poster', 'preview'
});

export const MediaOutSchema = z.object({
  id: IdSchema,
  type: z.enum(['IMAGE', 'VIDEO', 'AUDIO']),
  status: z.enum(['UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED']),
  url: z.string(), // best default rendition
  /** image: srcset map width→url (jpeg fallback) and per-format */
  sources: z.record(z.string(), z.array(z.object({ width: z.number().int(), url: z.string() }))).optional(),
  posterUrl: z.string().nullable().optional(),
  previewUrl: z.string().nullable().optional(),
  hlsUrl: z.string().nullable().optional(),
  blurhash: z.string().nullable().optional(),
  thumbhash: z.string().nullable().optional(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  durationMs: z.number().int().nullable().optional(),
  waveform: z.array(z.number()).nullable().optional(),
  alt: z.string().nullable().optional(),
  focalX: z.number().min(0).max(1).nullable().optional(),
  focalY: z.number().min(0).max(1).nullable().optional(),
  role: z.string().nullable().optional(), // 'designer_note' | 'story' | null
});
export type MediaOut = z.infer<typeof MediaOutSchema>;
