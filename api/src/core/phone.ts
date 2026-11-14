/** Normalise a phone number to E.164, assuming India (+91) for national numbers.
 * Returns null for anything that isn't a plausible number, including masked labels like 98XXXXXX10. */
export function phone(raw: string): string | null {
  const text = raw.trim().replace(/[\s\-().]/g, '');
  if (!/^(\+|00)?\d+$/.test(text)) return null;
  if (text.startsWith('+')) return /^\+[1-9]\d{7,14}$/.test(text) ? text : null;
  if (text.startsWith('00')) return phone('+' + text.slice(2));
  if (/^[6-9]\d{9}$/.test(text)) return '+91' + text;
  if (/^0[6-9]\d{9}$/.test(text)) return '+91' + text.slice(1);
  if (/^91[6-9]\d{9}$/.test(text)) return '+' + text;
  return null;
}
