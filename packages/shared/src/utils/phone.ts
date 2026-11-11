import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

export interface NormalizedPhone { e164: string; national: string; country: string }

/** Normalise user input into E.164 using a default country (DB-configurable, default TZ). */
export function normalizePhone(input: string, defaultCountry: string = 'TZ'): NormalizedPhone | null {
  const cleaned = input.trim().replace(/[^\d+]/g, '');
  if (!cleaned) return null;
  const p = parsePhoneNumberFromString(cleaned, defaultCountry.toUpperCase() as CountryCode);
  if (!p || !p.isValid()) return null;
  return { e164: p.number, national: p.formatNational(), country: p.country ?? defaultCountry.toUpperCase() };
}

/** Beem wants international format without "+" (e.g. 255700000001). */
export const toBeemMsisdn = (e164: string) => e164.replace(/^\+/, '');

export function maskPhone(e164: string): string {
  return e164.replace(/^(\+\d{3})\d+(\d{3})$/, '$1 ••• ••• $2');
}

export function formatPhoneLive(input: string, defaultCountry = 'TZ'): string {
  const p = parsePhoneNumberFromString(input, defaultCountry.toUpperCase() as CountryCode);
  return p ? p.formatInternational() : input;
}
