import { createRequire } from 'node:module';
import { expect, test } from 'vitest';

// Plan §0 rule 8: the app only ever runs in Expo Go, so it can use only the native modules Expo Go ships.
const load = createRequire(import.meta.url);
const bundled = load('expo/bundledNativeModules.json') as Record<string, string>;
const { dependencies } = load('../package.json') as { dependencies: Record<string, string> };
/** Packages with no native code of their own: the SDK itself, and the QR encoder (plain JS, drawn with Views). */
const JS_ONLY = ['expo', 'qrcode-generator'];

test('every dependency ships in Expo Go or is JS-only', () => {
  expect(Object.keys(dependencies).filter(name => !(name in bundled) && !JS_ONLY.includes(name))).toEqual([]);
});
