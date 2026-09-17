import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createFileLedgerStore, loadLedgerFile, saveLedgerFile } from '../src/file-ledger.mjs';
import { issueIou, ledgerSnapshot, settleIou } from '../src/ledger.mjs';

const authority = {
  authorityId: 'auth-file-1',
  actor: 'agent:file-test',
  currency: 'USD',
  maxAmount: 100,
  merchantIds: ['provider:higgsfield'],
  categories: ['render-credit'],
  expiresAt: '2026-12-31T00:00:00Z',
  idempotencyScope: 'render-job'
};
const intent = {
  intentId: 'intent-file-1',
  authorityId: 'auth-file-1',
  actor: 'agent:file-test',
  merchantId: 'provider:higgsfield',
  category: 'render-credit',
  amount: 8,
  currency: 'USD',
  resource: 'video-render-credit',
  idempotencyKey: 'file-idem-1',
  createdAt: '2026-09-16T00:00:00Z'
};

const providerReceipt = {
  provider: 'mock-deferred-settlement',
  providerReference: 'mock-file-ref-1',
  amount: 8,
  currency: 'USD',
  merchantId: 'provider:higgsfield',
  settledAt: '2026-09-16T00:05:00Z'
};

async function tempLedgerPath() {
  const dir = await mkdtemp(join(tmpdir(), 'agent-pay-ledger-'));
  return { dir, path: join(dir, 'ledger.json') };
}

test('missing ledger file loads as an empty ledger', async () => {
  const { dir, path } = await tempLedgerPath();
  try {
    const ledger = await loadLedgerFile(path);
    assert.deepEqual(ledgerSnapshot(ledger), {
      issuedCount: 0,
      settledCount: 0,
      outstandingCount: 0,
      outstandingAmountByCurrency: {},
      settledAmountByCurrency: {}
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file ledger store persists issued and settled IOUs', async () => {
  const { dir, path } = await tempLedgerPath();
  try {
    const store = createFileLedgerStore(path);
    const ledger = await store.load();
    const iou = issueIou({ ledger, authority, intent, counterparty: 'provider:higgsfield', dueAt: '2026-09-30T00:00:00Z', context: { now: intent.createdAt } });
    settleIou({ ledger, iouId: iou.iouId, providerReceipt, settledAt: providerReceipt.settledAt });
    await store.save(ledger);

    const reloaded = await store.load();
    assert.deepEqual(ledgerSnapshot(reloaded), {
      issuedCount: 1,
      settledCount: 1,
      outstandingCount: 0,
      outstandingAmountByCurrency: {},
      settledAmountByCurrency: { USD: 8 }
    });
    assert.equal(reloaded.ious[0].iouId, iou.iouId);
    assert.equal(reloaded.settlements[0].iouId, iou.iouId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveLedgerFile writes stable JSON for audit review', async () => {
  const { dir, path } = await tempLedgerPath();
  try {
    const ledger = await loadLedgerFile(path);
    issueIou({ ledger, authority, intent, counterparty: 'provider:higgsfield', dueAt: '2026-09-30T00:00:00Z', context: { now: intent.createdAt } });
    await saveLedgerFile(path, ledger);
    const text = await readFile(path, 'utf8');
    assert.match(text, /"ious"/);
    assert.match(text, /"settlements"/);
    assert.match(text, /intent-file-1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('invalid ledger JSON fails closed', async () => {
  const { dir, path } = await tempLedgerPath();
  try {
    await writeFile(path, '{not json', 'utf8');
    await assert.rejects(() => loadLedgerFile(path), /ledger_file_invalid_json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
