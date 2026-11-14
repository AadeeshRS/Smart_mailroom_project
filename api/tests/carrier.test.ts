import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/modules/parcels/carrier.js';

// Synthetic codes in each carrier's published format. No real labels were available; replace or extend
// these with real (redacted) samples from the mailroom.
test('order IDs, AWBs with a distinctive format, and numeric AWBs left for the operator', () => {
  for (const [raw, kind, carrier] of [
    ['403-1234567-1234567', 'ORDER_ID', null],
    [' od 4321 0987 6543 2109 87 ', 'ORDER_ID', null],
    ['EE123456789IN', 'AWB', 'INDIA_POST'],
    ['rn 123 456 789 in', 'AWB', 'INDIA_POST'],
    ['TBA123456789012', 'AWB', 'AMAZON'],
    ['FMPC1234567890', 'AWB', 'EKART'],
    ['SF1234567890FPL', 'AWB', 'SHADOWFAX'],
    ['D12345678', 'AWB', 'DTDC'],
    ['12345678901', 'AWB', null], // 11 digits: Blue Dart, or Xpressbees
    ['1234567890123', 'AWB', null], // 13 digits: Delhivery, or Xpressbees
    ['QR-OR-JUNK', 'AWB', null],
  ] as const) {
    const result = classify(raw);
    assert.deepEqual([result.kind, result.carrier], [kind, carrier], raw);
  }
  assert.equal(classify(' rn 123 456 789 in ').code, 'RN123456789IN');
});
