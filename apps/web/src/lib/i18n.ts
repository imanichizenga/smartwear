'use client';

// Imported straight from the shared catalog (the same source the mobile app's messages.g.dart is generated from),
// without pulling the rest of @smartwear/shared (zod, phone metadata) into the browser bundle.
import { en } from '../../../../packages/shared/src/i18n/en';
import { sw } from '../../../../packages/shared/src/i18n/sw';

export type Locale = 'en' | 'sw';
const EN = en as Record<string, string>;
const SW = sw as Record<string, string>;

export type Vars = Record<string, string | number | null | undefined>;
export type Translate = (key: string, vars?: Vars) => string;

/** Message lookup with {{var}} interpolation; `key.one` when count == 1; missing Swahili falls back to English. */
export function translate(locale: Locale, key: string, vars?: Vars): string {
  const oneKey = `${key}.one`;
  const k = vars?.count === 1 && (oneKey in EN || oneKey in SW) ? oneKey : key;
  const raw = (locale === 'sw' ? SW[k] ?? SW[key] : undefined) ?? EN[k] ?? EN[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (_, n: string) => (vars[n] == null ? '' : String(vars[n])));
}
