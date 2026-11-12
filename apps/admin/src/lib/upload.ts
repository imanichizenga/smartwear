'use client';

import { api } from './api';
import type { MediaOut } from './types';

interface Presign {
  mediaId: string;
  single: { url: string; fields: Record<string, string> } | null;
  multipart: { uploadId: string; partSizeBytes: number; parts: { partNumber: number; url: string }[] } | null;
}

/** Direct-to-S3 upload: presign → POST/multipart PUT straight to the bucket → complete (server sniffs magic bytes). */
export async function uploadFile(file: Blob & { name?: string }, purpose: string, onProgress?: (pct: number) => void, options?: { trim?: { startMs: number; endMs: number } }): Promise<MediaOut> {
  const type = file.type.startsWith('image/') ? 'IMAGE' : file.type.startsWith('video/') ? 'VIDEO' : file.type.startsWith('audio/') ? 'AUDIO' : null;
  if (!type) throw new Error('Choose an image, video or audio file');
  const p = await api<Presign>('/media/presign', { body: { type, contentType: file.type, bytes: file.size, fileName: file.name ?? `${purpose}.${file.type.split('/')[1]}`, purpose } });
  if (p.single) {
    const fd = new FormData();
    Object.entries(p.single.fields).forEach(([k, v]) => fd.append(k, v));
    fd.append('file', file);
    await xhr('POST', p.single.url, fd, onProgress);
    return api<MediaOut>('/media/complete', { body: { mediaId: p.mediaId, options } });
  }
  const m = p.multipart!;
  const parts: { partNumber: number; etag: string }[] = [];
  for (const part of m.parts) {
    const blob = file.slice((part.partNumber - 1) * m.partSizeBytes, part.partNumber * m.partSizeBytes);
    const etag = await xhr('PUT', part.url, blob, (pct) => onProgress?.(((part.partNumber - 1 + pct / 100) / m.parts.length) * 100));
    parts.push({ partNumber: part.partNumber, etag });
  }
  return api<MediaOut>('/media/complete', { body: { mediaId: p.mediaId, parts, options } });
}

function xhr(method: string, url: string, body: XMLHttpRequestBodyInit, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new XMLHttpRequest();
    r.open(method, url);
    r.upload.onprogress = (e) => e.lengthComputable && onProgress?.((e.loaded / e.total) * 100);
    r.onload = () => (r.status < 300 ? resolve(r.getResponseHeader('ETag') ?? '') : reject(new Error(`Upload failed (${r.status})`)));
    r.onerror = () => reject(new Error('Upload failed — check the bucket CORS settings'));
    r.send(body);
  });
}

/** Downloads an authenticated API file (CSV export, PDF) through the same-origin proxy. */
export async function downloadApiFile(path: string, fallbackName: string) {
  const res = await fetch(`/api/v1${path}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'SmartWearAdmin' } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const name = /filename="?([^"]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
