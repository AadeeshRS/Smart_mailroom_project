import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

// scrypt N=2^14, r=8, p=5 (OWASP's equivalent of N=2^17, p=1): 16 MiB per hash, so Node's 4 thread-pool workers
// use at most 64 MiB together and a 512 MB instance is enough. Node's default 32 MiB maxmem cap also stops a stored
// hash with bigger parameters from allocating more.
const scrypt = (password: string, salt: string, options: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password, salt, 64, options, (error, key) => (error ? reject(error) : resolve(key))),
  );
export const id = (prefix: string) => `${prefix}_${randomBytes(16).toString('base64url')}`;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const secretDigest = (pepper: string, credentialId: string, kind: string, value: string) =>
  createHmac('sha256', pepper).update(`${credentialId}:${kind}:${value}`).digest('hex');
export const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const otp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const token = () => randomBytes(32).toString('base64url');
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const result = await scrypt(password, salt, { N: 16384, r: 8, p: 5 });
  return `scrypt$16384$8$5$${salt}$${result.toString('hex')}`;
}
export async function passwordValid(password: string, hash: string) {
  const [, n, r, p, salt, expected] = hash.split('$');
  const result = await scrypt(password, salt, { N: Number(n), r: Number(r), p: Number(p) });
  return equal(result.toString('hex'), expected);
}
