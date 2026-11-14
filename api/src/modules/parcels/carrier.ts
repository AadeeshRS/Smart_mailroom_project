import type { S } from '../../contract.js';

export type Carrier = S<'Carrier'>;

/** Trim, uppercase and drop spaces, so the same code always compares equal. */
export const normalCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, '');

const ORDER_IDS = [
  /^\d{3}-\d{7}-\d{7}$/, // Amazon: 403-1234567-1234567
  /^OD\d{12,21}$/, // Flipkart: OD followed by digits
];

/** Formats with a distinctive structure. Purely numeric AWBs (Delhivery, Blue Dart, Xpressbees, Ecom Express)
 * overlap in length, so they aren't guessed: the operator picks the carrier.
 * ponytail: add length rules for numeric AWBs once real labels from this mailroom confirm them. */
const AWBS: { carrier: Carrier; pattern: RegExp }[] = [
  { carrier: 'INDIA_POST', pattern: /^[A-Z]{2}\d{9}IN$/ }, // UPU S10, e.g. EE123456789IN
  { carrier: 'AMAZON', pattern: /^TBA\d{12}$/ },
  { carrier: 'EKART', pattern: /^[A-Z]{4}\d{8,12}$/ }, // e.g. FMPC1234567890
  { carrier: 'SHADOWFAX', pattern: /^SF\d{8,14}[A-Z]{0,4}$/ },
  { carrier: 'DTDC', pattern: /^[A-Z]\d{8}$/ }, // e.g. D12345678
];

/** What a scanned code most likely is. `carrier` is null when the format doesn't say. */
export function classify(raw: string): { code: string; kind: 'AWB' | 'ORDER_ID'; carrier: Carrier | null } {
  const code = normalCode(raw);
  if (ORDER_IDS.some(pattern => pattern.test(code))) return { code, kind: 'ORDER_ID', carrier: null };
  return { code, kind: 'AWB', carrier: AWBS.find(a => a.pattern.test(code))?.carrier ?? null };
}
