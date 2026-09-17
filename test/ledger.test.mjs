import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createIouLedger,
  createIouProof,
  iouStatus,
  issueIou,
  ledgerSnapshot,
  settleIou,
  verifyIouProof
} from '../src/ledger.mjs';

const authority = {
  authorityId: 'auth-ledger-1',
  actor: 'agent:ledger-test',
  currency: 'USD',
  maxAmount: 50,
  merchantIds: ['provider:higgsfield'],
  categories: ['render-credit'],
  expiresAt: '2026-12-31T00:00:00Z',
  idempotencyScope: 'render-job'
};

const intent = {
  intentId: 'intent-ledger-1',
  authorityId: 'auth-ledger-1',
  actor: 'agent:ledger-test',
  merchantId: 'provider:higgsfield',
  category: 'render-credit',
  amount: 12.5,
  currency: 'USD',
  resource: 'video-render-credit',
  idempotencyKey: 'ledger-idem-1',
  createdAt: '2026-09-16T00:00:00Z'
};

const providerReceipt = {
  provider: 'mock-deferred-settlement',
  providerReference: 'mock-ledger-ref-1',
  amount: 12.5,
  currency: 'USD',
  merchantId: 'provider:higgsfield',
  settledAt: '2026-09-16T00:05:00Z'
};

test('issues an IOU only after authority verification', () => {
  const ledger = createIouLedger();
  const iou = issueIou({
    ledger,
    authority,
    intent,
    counterparty: 'provider:higgsfield',
    dueAt: '2026-09-30T00:00:00Z',
    context: { now: intent.createdAt }
  });
  assert.match(iou.iouId, /^iou_/);
  assert.equal(iou.state, 'issued');
  assert.equal(iou.amount, 12.5);
  assert.equal(iouStatus(ledger, iou.iouId).state, 'issued');
});

test('rejects duplicate IOUs for the same idempotency key', () => {
  const ledger = createIouLedger();
  const input = { ledger, authority, intent, counterparty: 'provider:higgsfield', dueAt: '2026-09-30T00:00:00Z', context: { now: intent.createdAt } };
  issueIou(input);
  assert.throws(() => issueIou(input), /idempotency_key_reused/);
});
test('records a settlement receipt without claiming live payment processing', () => {
  const ledger = createIouLedger();
  const iou = issueIou({ ledger, authority, intent, counterparty: 'provider:higgsfield', dueAt: '2026-09-30T00:00:00Z', context: { now: intent.createdAt } });
  const settlement = settleIou({ ledger, iouId: iou.iouId, providerReceipt, settledAt: providerReceipt.settledAt });

  assert.match(settlement.settlementId, /^set_/);
  assert.equal(settlement.receipt.intentId, intent.intentId);
  assert.equal(iouStatus(ledger, iou.iouId).state, 'settled');
  assert.throws(() => settleIou({ ledger, iouId: iou.iouId, providerReceipt, settledAt: providerReceipt.settledAt }), /iou_already_settled/);
});

test('summarizes outstanding and settled ledger totals by currency', () => {
  const ledger = createIouLedger();
  const first = issueIou({ ledger, authority, intent, counterparty: 'provider:higgsfield', dueAt: '2026-09-30T00:00:00Z', context: { now: intent.createdAt } });
  const secondIntent = { ...intent, intentId: 'intent-ledger-2', idempotencyKey: 'ledger-idem-2', amount: 7.5 };
  issueIou({ ledger, authority, intent: secondIntent, counterparty: 'provider:higgsfield', dueAt: '2026-09-30T00:00:00Z', context: { now: intent.createdAt } });
  settleIou({ ledger, iouId: first.iouId, providerReceipt, settledAt: providerReceipt.settledAt });

  assert.deepEqual(ledgerSnapshot(ledger), {
    issuedCount: 2,
    settledCount: 1,
    outstandingCount: 1,
    outstandingAmountByCurrency: { USD: 7.5 },
    settledAmountByCurrency: { USD: 12.5 }
  });
});

test('creates proof envelopes for issued and settled IOUs', () => {
  const ledger = createIouLedger();
  const iou = issueIou({ ledger, authority, intent, counterparty: 'provider:higgsfield', dueAt: '2026-09-30T00:00:00Z', context: { now: intent.createdAt } });
  const issuedEnvelope = createIouProof({ iou, createdAt: '2026-09-16T00:01:00Z' });
  assert.equal(verifyIouProof(issuedEnvelope).state, 'verified');

  const settlement = settleIou({ ledger, iouId: iou.iouId, providerReceipt, settledAt: providerReceipt.settledAt });
  const settledEnvelope = createIouProof({ iou, settlement, createdAt: '2026-09-16T00:06:00Z' });
  assert.equal(verifyIouProof(settledEnvelope, { requirePaymentReceipt: true }).state, 'verified');

  const tampered = { ...settledEnvelope, paymentReceipt: { ...settledEnvelope.paymentReceipt, amount: 99 } };
  assert.equal(verifyIouProof(tampered, { requirePaymentReceipt: true }).state, 'rejected');
});

test('rejects settlement receipts with mismatched terms', () => {
  const ledger = createIouLedger();
  const iou = issueIou({ ledger, authority, intent, counterparty: 'provider:higgsfield', dueAt: '2026-09-30T00:00:00Z', context: { now: intent.createdAt } });
  assert.throws(() => settleIou({ ledger, iouId: iou.iouId, providerReceipt: { ...providerReceipt, amount: 13 }, settledAt: providerReceipt.settledAt }), /settlement_terms_mismatch/);
});
