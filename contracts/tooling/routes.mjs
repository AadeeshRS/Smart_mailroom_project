import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
export async function routeSource() {
  const source = YAML.parse(await readFile(new URL('../openapi.yaml', import.meta.url), 'utf8'));
  const routes = Object.fromEntries(Object.entries(source.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, operation]) => [operation.operationId, { method: method.toUpperCase(), path, query: operation.parameters.filter(p => p.in === 'query').map(p => p.name), body: !!operation.requestBody }])));
  return '// Generated from contracts/openapi.yaml. Do not edit.\nexport const routes = ' + JSON.stringify(routes, null, 2) + ' as const;\n';
}
