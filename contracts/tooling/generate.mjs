import { mkdir, writeFile } from 'node:fs/promises';
import { generatedSource } from './source.mjs';
await mkdir(new URL('../generated/', import.meta.url), { recursive: true });
await writeFile(new URL('../generated/api.d.ts', import.meta.url), await generatedSource());
console.log('Generated API declarations');
