import {
  bindReceipt,
  canonicalDigest,
  createProofEnvelope,
  evaluateSpendAuthority,
  verifyProofEnvelope
} from './agentpay.mjs';

export function createIouLedger(seed = {}) {
  return {
    ious: [...(seed.ious ?? [])],
    settlements: [...(seed.settlements ?? [])]
  };
}

function ensureLedger(ledger) {
  if (!ledger || !Array.isArray(ledger.ious) || !Array.isArray(ledger.settlements)) {
    throw new Error('invalid_iou_ledger');
  }
}

export function issueIou({ ledger, authority, intent, context, counterparty, dueAt, terms = {} }) {
  ensureLedger(ledger);
  const decision = evaluateSpendAuthority(authority, intent, context);
  if (decision.state !== 'verified') throw new Error(`authority_rejected:${decision.reasons.join(',')}`);
  if (ledger.ious.some((iou) => iou.idempotencyKey === intent.idempotencyKey)) throw new Error('idempotency_key_reused');
  const base = {
    intent,
    authorityId: authority.authorityId,
    actor: intent.actor,
    counterparty,
    dueAt,
    terms: { mode: 'deferred-settlement', ...terms }
  };
  const iou = {
    iouId: `iou_${canonicalDigest(base).slice(0, 24)}`,
    issuedAt: context.now,
    state: 'issued',
    amount: intent.amount,
    currency: intent.currency,
    merchantId: intent.merchantId,
    idempotencyKey: intent.idempotencyKey,
    intentDigest: canonicalDigest(intent),
    ...base
  };
  ledger.ious.push(iou);
  return iou;
}

export function settleIou({ ledger, iouId, providerReceipt, settledAt }) {
  ensureLedger(ledger);
  const iou = ledger.ious.find((entry) => entry.iouId === iouId);
  if (!iou) throw new Error('iou_not_found');
  if (ledger.settlements.some((entry) => entry.iouId === iouId)) throw new Error('iou_already_settled');
  const receipt = bindReceipt(iou.intent, providerReceipt);
  if (receipt.amount !== iou.amount || receipt.currency !== iou.currency || receipt.merchantId !== iou.merchantId) {
    throw new Error('settlement_terms_mismatch');
  }
  const settlement = {
    settlementId: `set_${canonicalDigest({ iouId, receipt, settledAt }).slice(0, 24)}`,
    iouId,
    state: 'settled',
    settledAt,
    receipt,
    receiptDigest: canonicalDigest(receipt)
  };
  ledger.settlements.push(settlement);
  return settlement;
}

export function iouStatus(ledger, iouId) {
  ensureLedger(ledger);
  const iou = ledger.ious.find((entry) => entry.iouId === iouId);
  if (!iou) return { state: 'unknown', reasons: ['iou_not_found'] };
  const settlement = ledger.settlements.find((entry) => entry.iouId === iouId);
  if (settlement) return { state: 'settled', iou, settlement, reasons: [] };
  return { state: 'issued', iou, reasons: [] };
}

function addAmount(target, currency, amount) {
  target[currency] = Number(((target[currency] ?? 0) + amount).toFixed(12));
}

export function ledgerSnapshot(ledger) {
  ensureLedger(ledger);
  const settledIds = new Set(ledger.settlements.map((entry) => entry.iouId));
  const outstandingAmountByCurrency = {};
  const settledAmountByCurrency = {};
  for (const iou of ledger.ious) {
    if (settledIds.has(iou.iouId)) addAmount(settledAmountByCurrency, iou.currency, iou.amount);
    else addAmount(outstandingAmountByCurrency, iou.currency, iou.amount);
  }
  return {
    issuedCount: ledger.ious.length,
    settledCount: ledger.settlements.length,
    outstandingCount: ledger.ious.length - ledger.settlements.length,
    outstandingAmountByCurrency,
    settledAmountByCurrency
  };
}

export function createIouProof({ iou, settlement, createdAt }) {
  return createProofEnvelope({
    subject: iou.iouId,
    claim: settlement ? 'IOU has a bound settlement receipt' : 'IOU was issued under verified spend authority',
    createdAt,
    paymentIntent: iou.intent,
    paymentReceipt: settlement?.receipt,
    evidence: [{ type: 'payment', ref: iou.iouId, digest: canonicalDigest(iou) }]
  });
}

export function verifyIouProof(envelope, policy = {}) {
  return verifyProofEnvelope(envelope, policy);
}
