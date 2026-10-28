import openapiTS, { astToString } from 'openapi-typescript';
export async function generatedSource() {
  return '/** Generated from contracts/openapi.yaml. Do not edit manually. */\n\n' + astToString(await openapiTS(new URL('../openapi.yaml', import.meta.url)));
}
