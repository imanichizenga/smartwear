const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Human-friendly order numbers: SW-7K3M-Q9. Not for security. */
export function orderNumberFromSeq(seq: number, prefix = 'SW'): string {
  let n = seq;
  let s = '';
  do { s = ALPHABET[n % ALPHABET.length] + s; n = Math.floor(n / ALPHABET.length); } while (n > 0);
  s = s.padStart(6, '2');
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4)}`;
}
