import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { agentPayProduct } from '../src/agentpay.mjs';

test('AgentPay public repo preserves the IOU Rails source spec without claiming live settlement', async () => {
  const spec = await readFile(new URL('../docs/agentpay-breakthrough-spec.md', import.meta.url), 'utf8');
  assert.match(spec, /Proof-Carrying IOUs/);
  assert.match(spec, /deferred settlement/i);
  assert.equal(agentPayProduct.settlementStatus, 'specification-preserved-not-live-settlement');
});
