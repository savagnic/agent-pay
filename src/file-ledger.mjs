import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createIouLedger } from './ledger.mjs';

const EMPTY_LEDGER = Object.freeze({ ious: [], settlements: [] });

export async function loadLedgerFile(path) {
  try {
    const text = await readFile(path, 'utf8');
    const parsed = JSON.parse(text);
    return createIouLedger(parsed);
  } catch (error) {
    if (error.code === 'ENOENT') return createIouLedger(EMPTY_LEDGER);
    if (error instanceof SyntaxError) throw new Error(`ledger_file_invalid_json:${path}`);
    throw error;
  }
}

export async function saveLedgerFile(path, ledger) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  const payload = `${JSON.stringify({ ious: ledger.ious, settlements: ledger.settlements }, null, 2)}\n`;
  await writeFile(tempPath, payload, 'utf8');
  await rename(tempPath, path);
  return path;
}

export function createFileLedgerStore(path) {
  return {
    path,
    async load() {
      return loadLedgerFile(path);
    },
    async save(ledger) {
      return saveLedgerFile(path, ledger);
    }
  };
}
