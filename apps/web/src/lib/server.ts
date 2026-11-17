import 'server-only';

const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:8030';

/** Anonymous server-side GET (SEO metadata, first paint). Retries blips; never throws — null on any failure. */
export async function serverGet<T = Record<string, unknown>>(path: string, revalidate = 60): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${API}/v1${path}`, { headers: { Accept: 'application/json' }, next: { revalidate }, signal: AbortSignal.timeout(6000) });
      if (res.ok) return (await res.json()) as T;
      if (res.status < 500) return null;
    } catch {
      /* retry once */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

type J = Record<string, unknown>;
const isMedia = (o: J) => typeof o.type === 'string' && ('sources' in o || 'thumbhash' in o) && ('status' in o || 'url' in o);

/**
 * Trims server-rendered data before it is embedded in the page (HTML + hydration payload): media keep their WebP
 * renditions and one JPEG fallback (every browser we serve decodes WebP), and fields screens never read go.
 * Keeps first-load HTML small — Core Web Vitals are a ranking factor.
 */
export function slim<T>(v: T): T {
  if (Array.isArray(v)) return v.map(slim) as T;
  if (!v || typeof v !== 'object') return v;
  const o = v as J;
  if (isMedia(o)) {
    const src = (o.sources ?? {}) as Record<string, { width: number; url: string }[]>;
    const jpeg = [...(src.jpeg ?? [])].sort((a, b) => a.width - b.width);
    const fallback = jpeg.find((x) => x.width >= 768) ?? jpeg[jpeg.length - 1];
    const out: J = { id: o.id, type: o.type, status: o.status, thumbhash: o.thumbhash, dominantColor: o.dominantColor, focalX: o.focalX, focalY: o.focalY, alt: o.alt, width: o.width, height: o.height };
    if (src.webp?.length || fallback) out.sources = { ...(src.webp?.length ? { webp: src.webp } : {}), ...(fallback ? { jpeg: [fallback] } : {}) };
    else if (o.url) out.url = o.url;
    if (o.type !== 'IMAGE') Object.assign(out, { url: o.url, posterUrl: o.posterUrl, hlsUrl: o.hlsUrl, durationMs: o.durationMs, waveform: o.waveform });
    return out as T;
  }
  const out: J = {};
  for (const [k, x] of Object.entries(o)) if (x !== null && k !== 'blurhash') out[k] = slim(x);
  return out as T;
}
