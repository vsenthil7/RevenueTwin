/**
 * Connector import (S75).
 *
 * Pull billing data directly from a source (a Stripe export URL, an HTTPS CSV endpoint, or an
 * SFTP-fetched file) instead of a manual upload. All of these reduce to: a fetcher that returns
 * CSV text. The fetcher is injected, so production wires a real Stripe/HTTPS/SFTP client while
 * tests supply a stub - and the fetched CSV flows through the SAME deterministic import engine.
 */
import { importCsv, type ImportOptions, type ImportResult, ImportError } from './importer.ts';
export { ImportError } from './importer.ts';

/** A source that yields CSV text. Real impls: HTTPS GET, Stripe export, SFTP download. */
export type CsvSource = () => Promise<string>;

export interface SourceImportResult {
  readonly source: string;
  readonly fetchedBytes: number;
  readonly csv: string;
  readonly result: ImportResult;
}

/** Fetch CSV from a source and run it through the import engine. */
export async function importFromSource(
  sourceName: string, fetcher: CsvSource, opts: ImportOptions = {},
): Promise<SourceImportResult> {
  let csv: string;
  try {
    csv = await fetcher();
  } catch (e) {
    throw new ImportError('source ' + sourceName + ' fetch failed: ' + (e as Error).message);
  }
  if (typeof csv !== 'string' || csv.trim().length === 0) {
    throw new ImportError('source ' + sourceName + ' returned no data');
  }
  return { source: sourceName, csv, fetchedBytes: csv.length, result: importCsv(csv, opts) };
}
