import SwaggerParser from '@apidevtools/swagger-parser';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
const source = YAML.parse(await readFile(new URL('../openapi.yaml', import.meta.url), 'utf8'));
await SwaggerParser.validate(source);
const ids = Object.values(source.paths).flatMap(path => Object.values(path).map(op => op.operationId));
if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('Missing or duplicate operationId');
console.log(`PASS: OpenAPI validation; ${ids.length} unique operations`);
