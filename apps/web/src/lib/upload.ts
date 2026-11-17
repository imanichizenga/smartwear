'use client';

import { api, ApiException } from './api';
import type { Json } from './json';

/** Downscale big photos in the browser (like image_picker's maxWidth) before upload. */
async function shrink(file: File, max: number): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k >= 1) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((r) => c.toBlob((b) => r(b ?? file), 'image/jpeg', 0.86));
  } catch {
    return file;
  }
}

/** Direct-to-storage upload: presign → POST to the bucket (with progress) → complete. Returns the media JSON. */
export async function uploadImage(file: File, purpose: string, onProgress?: (p: number) => void, max = 1600): Promise<Json> {
  const blob = await shrink(file, max);
  const contentType = blob.type || 'image/jpeg';
  const name = file.name.replace(/\.[^.]+$/, '') + (contentType === 'image/png' ? '.png' : contentType === 'image/webp' ? '.webp' : '.jpg');
  const p = await api.post<Json>('/media/presign', { type: 'IMAGE', contentType, bytes: blob.size, fileName: name, purpose });
  const single = p.single as Json | undefined;
  if (!single) throw new ApiException(400, 'upload_too_large', 'That photo is too large');
  const form = new FormData();
  for (const [k, v] of Object.entries((single.fields as Record<string, string>) ?? {})) form.append(k, v);
  form.append('file', blob, name);
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', String(single.url));
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => (x.status < 300 ? resolve() : reject(new ApiException(x.status, 'upload_failed', 'Upload failed — please try again')));
    x.onerror = () => reject(new ApiException(0, 'offline', 'Upload failed — please try again'));
    x.send(form);
  });
  onProgress?.(1);
  return api.post<Json>('/media/complete', { mediaId: p.mediaId });
}
