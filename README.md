# Agent Pay

Public AgentPay / IOU Rails repository for proof-carrying agent payment rails.

## Source

Seeded from `savagnic/SIA-V6-CEROS:analysis/products/agentpay-breakthrough-spec.md`.

## Current scope

This repo now contains a conservative implementation skeleton:

- spend authority evaluation
- idempotency-key rejection
- mock provider authorization and execution boundary
- receipt binding to the original payment intent
- proof envelope creation and verification
- IOU ledger issuance and mock settlement records
- file-backed ledger persistence for restart-safe IOU records
- outstanding and settled totals by currency

It still does **not** claim live settlement, wallet custody, or production payment processing.

## Verification
```text
npm test
```

Expected proof after the IOU ledger layer:

```text
16 tests
16 pass
0 fail
```

See `docs/LEDGER.md` for the ledger boundary and next adapter seam.

## Relationship to Savage Agent Protocol

`savagnic/savage-agent-protocol` is the private package boundary for the deeper proof, authority, receipt, and Agent Pay primitives. This public repo mirrors a minimal dependency-free subset until that private API stabilizes under real usage.
