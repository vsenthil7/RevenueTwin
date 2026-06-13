/** Shared CLI money formatter: integer minor units (pence) -> £ with thousands separators. */
export function fmtMinor(minor: number, symbol = '£'): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const pounds = Math.floor(abs / 100);
  const pence = (abs % 100).toString().padStart(2, '0');
  const s = pounds.toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return (neg ? '-' : '') + symbol + out + '.' + pence;
}
