import { mkdir, writeFile } from 'node:fs/promises';
import { generatedSource } from './source.mjs';
import { routeSource } from './routes.mjs';
await mkdir(new URL('../generated/', import.meta.url), { recursive: true });
await writeFile(new URL('../generated/api.d.ts', import.meta.url), await generatedSource());
await writeFile(new URL('../../mobile/src/api/routes.generated.ts', import.meta.url), await routeSource());
console.log('Generated API declarations');
