import { readFile } from 'node:fs/promises';
import { generatedSource } from './source.mjs';
import { routeSource } from './routes.mjs';
const generated = await generatedSource();
const current = await readFile(new URL('../generated/api.d.ts', import.meta.url), 'utf8');
if (generated.replaceAll('\r\n', '\n') !== current.replaceAll('\r\n', '\n')) throw new Error('Generated types drifted. Run npm run generate in contracts.');
if ((await routeSource()).replaceAll('\r\n', '\n') !== (await readFile(new URL('../../mobile/src/api/routes.generated.ts', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')) throw new Error('Generated HTTP route metadata drifted.');
console.log('PASS: generated declarations match canonical OpenAPI');
