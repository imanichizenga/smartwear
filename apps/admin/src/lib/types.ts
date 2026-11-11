export interface MediaOut {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'AUDIO';
  status: 'UPLOADING' | 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';
  url: string;
  sources: Partial<Record<'avif' | 'webp' | 'jpeg' | 'mp4', { width: number; url: string }[]>> | null;
  posterUrl: string | null;
  previewUrl: string | null;
  hlsUrl: string | null;
  blurhash: string | null;
  thumbhash: string | null;
  dominantColor: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  waveform: number[] | null;
  alt: string | null;
  focalX: number;
  focalY: number;
  role: string | null;
}
export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
  total?: number;
}
