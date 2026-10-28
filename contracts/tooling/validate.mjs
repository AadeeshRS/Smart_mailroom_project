import SwaggerParser from '@apidevtools/swagger-parser';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
const source = YAML.parse(await readFile(new URL('../openapi.yaml', import.meta.url), 'utf8'));
await SwaggerParser.validate(structuredClone(source));
const ids = Object.values(source.paths).flatMap(path => Object.values(path).map(op => op.operationId));
if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('Missing or duplicate operationId');
console.log(`PASS: OpenAPI validation; ${ids.length} unique operations`);
const ajv = new Ajv({ strict: false, allErrors: true }); addFormats(ajv);
ajv.addSchema({ $id: 'mailroom', components: source.components });
for (const [name, example] of Object.entries(source.components.examples)) {
  const validate = ajv.compile({ $ref: `mailroom#/components/schemas/${example['x-schema']}` });
  if (!validate(example.value)) throw new Error(`${name}: ${JSON.stringify(validate.errors)}`);
}
for (const example of source['x-invalid-examples']) {
  if (ajv.compile({ $ref: `mailroom#/components/schemas/${example.schema}` })(example.value)) throw new Error('Invalid example unexpectedly accepted');
}
for (const path of Object.values(source.paths)) for (const operation of Object.values(path)) {
  const media = [operation.requestBody?.content, ...Object.values(operation.responses).map(response => response.content)].filter(Boolean);
  for (const content of media) for (const representation of Object.values(content)) {
    for (const example of Object.values(representation.examples ?? {})) {
      const resolved = example.$ref ? source.components.examples[example.$ref.split('/').at(-1)] : example;
      const schema = JSON.parse(JSON.stringify(representation.schema).replaceAll('"#/components/', '"mailroom#/components/'));
      const validate = ajv.compile(schema);
      if (!validate(resolved.value)) throw new Error(`Attached example in ${operation.operationId}: ${JSON.stringify(validate.errors)}`);
    }
  }
}
console.log(`PASS: ${Object.keys(source.components.examples).length} positive examples, ${source['x-invalid-examples'].length} negative examples, and attached operation examples`);
