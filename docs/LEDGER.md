# Agent Pay IOU Ledger

The ledger layer records proof-carrying IOUs without pretending to move real money.

## Current capability

- issue IOUs only after spend authority verification
- reject reused idempotency keys
- bind mock provider settlement receipts to original payment intents
- summarize outstanding and settled totals by currency
- create proof envelopes for issued and settled IOUs
- verify those envelopes and reject tampered settlement evidence

## Safety boundary

This is not a wallet, custodian, payment processor, or live blockchain settlement rail.
It is an auditable data model for deferred settlement experiments.

## Source files
- `src/ledger.mjs`
- `test/ledger.test.mjs`
- `src/agentpay.mjs`

## Verification

```text
npm test
12 tests
12 pass
0 fail
```

## Next implementation seam

The next useful seam is a file-backed or database-backed ledger adapter so IOUs survive process restart.
That adapter should preserve the same proof and idempotency behavior before any live settlement integration is considered.
