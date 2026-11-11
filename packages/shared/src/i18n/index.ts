import { en } from './en';
import { sw } from './sw';
import type { Locale } from '../enums';

export type MessageKey = keyof typeof en;
export const messages: Record<Locale, Record<MessageKey, string>> = { en, sw: { ...en, ...sw } };

/** Tiny interpolation: "Hello {{name}}" */
export function t(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const raw = messages[locale]?.[key] ?? en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (vars[k] == null ? '' : String(vars[k])));
}

export { en, sw };
