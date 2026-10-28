import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
const scrypt = (password: string, salt: string, options: { N: number; r: number; p: number; maxmem: number }) => new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key)));
export const id = (prefix: string) => `${prefix}_${randomBytes(16).toString('base64url')}`;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const secretDigest = (pepper: string, credentialId: string, kind: string, value: string) => createHmac('sha256', pepper).update(`${credentialId}:${kind}:${value}`).digest('hex');
export const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const otp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const token = () => randomBytes(32).toString('base64url');
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const result = await scrypt(password, salt, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return `scrypt$131072$8$1$${salt}$${result.toString('hex')}`;
}
export async function passwordValid(password: string, hash: string) {
  const [, n, r, p, salt, expected] = hash.split('$');
  const result = await scrypt(password, salt, { N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 });
  return equal(result.toString('hex'), expected);
}
