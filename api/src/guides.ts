import type { Input, S } from './contract.js';
export function guide(input: Input<'getGuide'>): S<'Guide'> {
  const steps = input.platform === 'AMAZON' ? ['Open Amazon and go to Your Orders.', 'Select your purchase and copy the merchant order ID from order details.'] : input.platform === 'FLIPKART' ? ['Open Flipkart and choose My Orders.', 'Open the order details and copy the order ID.'] : input.platform === 'MYNTRA' ? ['Open Myntra and choose Orders.', 'Open the purchase details and copy the order ID.'] : ['Open the merchant order details.', 'Copy the merchant order ID; OTHER requires mailroom review.'];
  return { platform: input.platform, title: `Find your ${input.platform.toLowerCase()} order ID`, steps, caution: 'Guidance is illustrative. No merchant integration exists. An order ID does not verify ownership.' };
}
