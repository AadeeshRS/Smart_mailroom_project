import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

/** At most `max` tasks run at once; the rest wait in order. */
export function semaphore(max: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running < max) running++;
    else await new Promise<void>(resolve => waiting.push(resolve)); // a finishing task hands over its slot
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}

// Each scrypt run (N=2^17, r=8) takes 128 MiB, and Node's thread pool runs 4 at once: 4 simultaneous logins would
// need 512 MiB on top of the API. Two at a time caps it at 256 MiB; extra logins queue for ~0.3 s each.
// ponytail: per process; with several API instances each gets its own two slots.
const scryptSlot = semaphore(2);
const scrypt = (password: string, salt: string, options: { N: number; r: number; p: number; maxmem: number }) =>
  scryptSlot(
    () =>
      new Promise<Buffer>((resolve, reject) =>
        scryptCallback(password, salt, 64, options, (error, key) => (error ? reject(error) : resolve(key))),
      ),
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
  const result = await scrypt(password, salt, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return `scrypt$131072$8$1$${salt}$${result.toString('hex')}`;
}
export async function passwordValid(password: string, hash: string) {
  const [, n, r, p, salt, expected] = hash.split('$');
  const result = await scrypt(password, salt, { N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 });
  return equal(result.toString('hex'), expected);
}
