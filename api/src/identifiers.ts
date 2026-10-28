import { contract, type S } from './contract.js';
import { fail } from './errors.js';
export function identifier(input: S<'Identifier'>): S<'Identifier'> {
  const catalog: string[] = contract.components.schemas[input.kind === 'ORDER_ID' ? 'Platform' : 'Carrier'].enum;
  if (!catalog.includes(input.namespace)) fail('UNKNOWN_NAMESPACE', 'Use an approved platform/carrier namespace.');
  let value = input.value.trim();
  if (!value) fail('VALIDATION', 'Identifier value must not be blank.');
  if (input.kind === 'TRACKING' && input.namespace === 'BLUEDART') {
    value = value.replaceAll(' ', ''); if (!/^\d+$/.test(value)) fail('VALIDATION', 'BLUEDART references require digits.');
  } else if (input.kind === 'ORDER_ID' && input.namespace === 'FLIPKART' || input.kind === 'TRACKING' && ['DELHIVERY', 'EKART'].includes(input.namespace)) value = value.toUpperCase();
  return { ...input, value };
}
export const same = (a: { kind: string; namespace: string; value: string }, b: { kind: string; namespace: string; value: string }) => a.kind === b.kind && a.namespace === b.namespace && a.value === b.value;
export const upper = (value: string) => value.trim().toUpperCase();
