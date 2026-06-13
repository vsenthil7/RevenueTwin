/**
 * Minimal, dependency-free CSV parser (RFC-4180-ish): handles quoted fields, embedded commas,
 * escaped double-quotes (""), and CRLF or LF line endings. Returns rows of string cells. The
 * first row is treated as a header by parseCsvRecords, which yields objects keyed by header.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      cell += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; continue; }
    cell += ch; i += 1;
  }
  // Flush the final cell/row if the file did not end with a newline.
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** Parse CSV into header-keyed records. Throws on duplicate or empty headers. */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text.trim());
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  const seen = new Set<string>();
  for (const h of header) {
    if (h === '') throw new Error('CSV header has an empty column name');
    if (seen.has(h)) throw new Error('CSV header has a duplicate column: ' + h);
    seen.add(h);
  }
  const out: Array<Record<string, string>> = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const rec: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) rec[header[c]!] = (cells[c] ?? '').trim();
    out.push(rec);
  }
  return out;
}
