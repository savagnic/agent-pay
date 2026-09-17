import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  agentPayProduct,
  createProofEnvelope,
  evaluateSpendAuthority,
  executeAgentPayment,
  verifyProofEnvelope
} from '../src/agentpay.mjs';

const authority = {
  authorityId: 'auth-1',
  actor: 'agent:sav-test',
  currency: 'USD',
  maxAmount: 25,
  merchantIds: ['provider:higgsfield'],
  categories: ['render-credit'],
  expiresAt: '2026-12-31T00:00:00Z',
  idempotencyScope: 'render-job'
};

const intent = {
  intentId: 'intent-1',
  authorityId: 'auth-1',
  actor: 'agent:sav-test',
  merchantId: 'provider:higgsfield',
  category: 'render-credit',
  amount: 10,
  currency: 'USD',
  resource: 'video-render-credit',
  idempotencyKey: 'idem-1',
  createdAt: '2026-09-16T00:00:00Z'
};

const mockAdapter = {
  async authorize(i) {
    return { authorizationId: 'mock-authz-1', intentId: i.intentId };
  },
  async execute(i) {
    return {
      provider: 'mock-deferred-settlement',
      providerReference: 'mock-ref-1',
      amount: i.amount,
      currency: i.currency,
      merchantId: i.merchantId,
      settledAt: '2026-09-16T00:00:01Z'
    };
  }
};

test('AgentPay public repo preserves the IOU Rails source spec without claiming live settlement', async () => {
  const spec = await readFile(new URL('../docs/agentpay-breakthrough-spec.md', import.meta.url), 'utf8');
  assert.match(spec, /Proof-Carrying IOUs/);
  assert.match(spec, /deferred settlement/i);
  assert.equal(agentPayProduct.settlementStatus, 'implementation-skeleton-not-live-settlement');
});

test('evaluates explicit spend authority before provider execution', () => {
  assert.deepEqual(evaluateSpendAuthority(authority, intent, { now: intent.createdAt }), { state: 'verified', reasons: [] });
  const rejected = evaluateSpendAuthority(authority, { ...intent, amount: 100 }, { now: intent.createdAt });
  assert.equal(rejected.state, 'rejected');
  assert.match(rejected.reasons.join(','), /amount_exceeds_authority/);
});

test('executes a mock deferred payment and binds a receipt to the intent', async () => {
  const receipt = await executeAgentPayment({ authority, intent, adapter: mockAdapter, context: { now: intent.createdAt } });
  assert.equal(receipt.intentId, intent.intentId);
  assert.equal(receipt.authorityId, authority.authorityId);
  assert.equal(receipt.amount, intent.amount);
  assert.equal(receipt.provider, 'mock-deferred-settlement');
  assert.match(receipt.receiptId, /^apay_/);
});

test('does not call the provider when authority rejects', async () => {
  let called = false;
  const rejectingAdapter = {
    async authorize(i) {
      called = true;
      return { authorizationId: 'bad', intentId: i.intentId };
    },
    async execute() {
      throw new Error('unreachable');
    }
  };
  await assert.rejects(
    () => executeAgentPayment({ authority, intent: { ...intent, amount: 100 }, adapter: rejectingAdapter, context: { now: intent.createdAt } }),
    /authority_rejected/
  );
  assert.equal(called, false);
});

test('builds and verifies proof-carrying payment evidence', async () => {
  const receipt = await executeAgentPayment({ authority, intent, adapter: mockAdapter, context: { now: intent.createdAt } });
  const envelope = createProofEnvelope({
    subject: 'agent-pay:mock-payment',
    claim: 'mock provider receipt is bound to the approved intent',
    createdAt: '2026-09-16T00:00:02Z',
    paymentIntent: intent,
    paymentReceipt: receipt
  });
  assert.equal(verifyProofEnvelope(envelope, { requirePaymentReceipt: true }).state, 'verified');
  assert.equal(verifyProofEnvelope({ ...envelope, paymentReceipt: { ...receipt, amount: 11 } }, { requirePaymentReceipt: true }).state, 'rejected');
});

test('rejects reused idempotency keys', () => {
  const result = evaluateSpendAuthority(authority, intent, { now: intent.createdAt, usedIdempotencyKeys: new Set(['idem-1']) });
  assert.equal(result.state, 'rejected');
  assert.match(result.reasons.join(','), /idempotency_key_reused/);
});
