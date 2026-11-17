/** The API is camelCase JSON; screens read it directly, like the app's JsonX helpers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export const str = (o: Json | null | undefined, k: string, d = ''): string => (typeof o?.[k] === 'string' ? (o[k] as string) : d);
export const strN = (o: Json | null | undefined, k: string): string | null => (typeof o?.[k] === 'string' ? (o[k] as string) : null);
export const int = (o: Json | null | undefined, k: string, d = 0): number => (typeof o?.[k] === 'number' ? Math.trunc(o[k] as number) : d);
export const intN = (o: Json | null | undefined, k: string): number | null => (typeof o?.[k] === 'number' ? Math.trunc(o[k] as number) : null);
export const num = (o: Json | null | undefined, k: string, d = 0): number => (typeof o?.[k] === 'number' ? (o[k] as number) : d);
export const flag = (o: Json | null | undefined, k: string): boolean => o?.[k] === true;
export const obj = (o: Json | null | undefined, k: string): Json | null => (o?.[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? (o[k] as Json) : null);
export const list = (o: Json | null | undefined, k: string): Json[] => (Array.isArray(o?.[k]) ? (o![k] as unknown[]).filter((x): x is Json => !!x && typeof x === 'object') : []);
