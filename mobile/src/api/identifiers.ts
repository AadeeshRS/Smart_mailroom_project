import { ServiceError, type Schema } from './service';

export const PLATFORMS = ['AMAZON', 'FLIPKART', 'MYNTRA', 'OTHER'] as const satisfies readonly Schema<'Platform'>[];
export const CARRIERS = ['DELHIVERY', 'BLUEDART', 'EKART', 'OTHER'] as const satisfies readonly Schema<'Carrier'>[];
export function checkedIdentifier(input: Schema<'Identifier'>, trackingOnly = false): Schema<'Identifier'> {
  if (!input || !['ORDER_ID', 'TRACKING'].includes(input.kind) || trackingOnly && input.kind !== 'TRACKING') throw new ServiceError('VALIDATION', 'Classify each reference as merchant order ID or tracking/AWB.');
  const catalog: readonly string[] = input.kind === 'ORDER_ID' ? PLATFORMS : CARRIERS;
  if (!catalog.includes(input.namespace)) throw new ServiceError('UNKNOWN_NAMESPACE', 'Use a canonical approved platform/carrier namespace. OTHER requires review.');
  if (typeof input.value !== 'string' || !input.value.trim() || input.value.trim().length > 100) throw new ServiceError('VALIDATION', 'Identifier value must contain 1 to 100 characters.');
  let value = input.value.trim();
  if (input.kind === 'TRACKING' && input.namespace === 'BLUEDART') {
    value = value.replaceAll(' ', '');
    if (!/^\d+$/.test(value)) throw new ServiceError('VALIDATION', 'BLUEDART references use digits; ASCII spaces are ignored and leading zeros are retained.');
  } else if (input.kind === 'ORDER_ID' && input.namespace === 'FLIPKART' || input.kind === 'TRACKING' && ['DELHIVERY', 'EKART'].includes(input.namespace)) value = value.toUpperCase();
  return { ...input, value };
}
export function sameIdentifier(a: Schema<'Identifier'>, b: Schema<'Identifier'>) {
  const left = checkedIdentifier(a); const right = checkedIdentifier(b);
  return left.kind === right.kind && left.namespace === right.namespace && left.value === right.value;
}
export function automaticNamespace(input: Schema<'Identifier'>) {
  const catalog: readonly string[] = input.kind === 'ORDER_ID' ? PLATFORMS : CARRIERS;
  return input.namespace !== 'OTHER' && catalog.includes(input.namespace);
}
