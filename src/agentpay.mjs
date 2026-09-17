import { createHash } from 'node:crypto';

export const agentPayProduct = {
  name: 'AgentPay / IOU Rails',
  category: 'proof-carrying agent payment rails',
  sourceSpec: 'docs/agentpay-breakthrough-spec.md',
  settlementStatus: 'implementation-skeleton-not-live-settlement'
};

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

export function canonicalDigest(value) {
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

function validDate(value) {
  return Number.isFinite(Date.parse(value));
}

export function evaluateSpendAuthority(authority, intent, context) {
  const reasons = [];
  const spentAmount = authority.spentAmount ?? 0;

  if (!Number.isFinite(authority.maxAmount) || authority.maxAmount <= 0 || !Number.isFinite(spentAmount) || spentAmount < 0) reasons.push('invalid_authority_amount');
  if (!Number.isFinite(intent.amount) || intent.amount <= 0) reasons.push('invalid_intent_amount');
  if (!validDate(authority.expiresAt)) reasons.push('invalid_authority_expiry');
  if (!validDate(context.now)) reasons.push('invalid_context_time');
  if (authority.authorityId !== intent.authorityId) reasons.push('authority_mismatch');
  if (authority.actor !== intent.actor) reasons.push('actor_mismatch');
  if (authority.currency !== intent.currency) reasons.push('currency_mismatch');
  if (spentAmount + intent.amount > authority.maxAmount) reasons.push('amount_exceeds_authority');
  if (validDate(context.now) && validDate(authority.expiresAt) && Date.parse(context.now) >= Date.parse(authority.expiresAt)) reasons.push('authority_expired');
  if (authority.merchantIds?.length && !authority.merchantIds.includes(intent.merchantId)) reasons.push('merchant_not_authorized');
  if (authority.categories?.length && (!intent.category || !authority.categories.includes(intent.category))) reasons.push('category_not_authorized');
  if (!intent.idempotencyKey) reasons.push('missing_idempotency_key');
  if (context.usedIdempotencyKeys?.has(intent.idempotencyKey)) reasons.push('idempotency_key_reused');
  if (authority.requiredHumanReview && !authority.approvedByHuman) reasons.push('human_review_required');

  return reasons.length ? { state: 'rejected', reasons: [...new Set(reasons)] } : { state: 'verified', reasons: [] };
}
export function bindReceipt(intent, providerReceipt) {
  const receipt = {
    ...providerReceipt,
    intentId: intent.intentId,
    authorityId: intent.authorityId,
    intentDigest: canonicalDigest(intent)
  };
  return {
    ...receipt,
    receiptId: `apay_${canonicalDigest(receipt).slice(0, 24)}`
  };
}

export async function executeAgentPayment({ authority, intent, adapter, context }) {
  const decision = evaluateSpendAuthority(authority, intent, context);
  if (decision.state !== 'verified') throw new Error(`authority_rejected:${decision.reasons.join(',')}`);
  const authorization = await adapter.authorize(intent, context);
  if (authorization.intentId !== intent.intentId) throw new Error('provider_authorization_intent_mismatch');
  const providerReceipt = await adapter.execute(intent, authorization, context);
  return bindReceipt(intent, providerReceipt);
}

export function createProofEnvelope(input) {
  const evidence = [...(input.evidence ?? [])];
  if (input.paymentReceipt) {
    evidence.push({ type: 'payment', ref: input.paymentReceipt.receiptId, digest: canonicalDigest(input.paymentReceipt) });
  }
  return {
    version: '1.0.0',
    subject: input.subject,
    claim: input.claim,
    createdAt: input.createdAt,
    evidence,
    paymentIntent: input.paymentIntent,
    paymentReceipt: input.paymentReceipt
  };
}

export function verifyProofEnvelope(envelope, policy = {}) {
  if (!envelope.evidence?.length) return { state: 'unknown', reasons: ['missing_evidence'] };
  if (policy.requirePaymentReceipt && !envelope.paymentReceipt) return { state: 'rejected', reasons: ['payment_receipt_required'] };

  if (envelope.paymentReceipt) {
    if (!envelope.paymentIntent) return { state: 'rejected', reasons: ['payment_intent_required'] };
    const receipt = envelope.paymentReceipt;
    const intent = envelope.paymentIntent;
    if (receipt.intentId !== intent.intentId || receipt.authorityId !== intent.authorityId) return { state: 'rejected', reasons: ['payment_intent_identity_mismatch'] };
    if (receipt.intentDigest !== canonicalDigest(intent)) return { state: 'rejected', reasons: ['payment_intent_digest_mismatch'] };
    if (receipt.amount !== intent.amount || receipt.currency !== intent.currency || receipt.merchantId !== intent.merchantId) return { state: 'rejected', reasons: ['payment_intent_terms_mismatch'] };
    const paymentEvidence = envelope.evidence.find((item) => item.type === 'payment' && item.ref === receipt.receiptId);
    if (!paymentEvidence) return { state: 'rejected', reasons: ['payment_receipt_not_bound'] };
    if (paymentEvidence.digest !== canonicalDigest(receipt)) return { state: 'rejected', reasons: ['payment_receipt_digest_mismatch'] };
  }

  return { state: 'verified', reasons: [] };
}
