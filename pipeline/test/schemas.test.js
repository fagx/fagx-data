'use strict';
/** Schema validation tests for the institutional allowlist (data file). */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { validateInstitutional } = require('../src/validate-schemas');

const DATA = path.resolve(__dirname, '..', '..', 'data', 'institutional-allowlist.json');

function problemsFor(data) {
  const problems = [];
  // validateInstitutional reads a path; reuse the schema through the repo file
  // for the committed state and validate variants via a temp copy is overkill:
  // assert schema semantics through the schema-loading path directly.
  const Ajv = require('ajv/dist/2020');
  const fs = require('fs');
  const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'schemas', 'institutional-allowlist.schema.json'), 'utf8'));
  const ajv = new Ajv({ allErrors: true });
  ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
  const validate = ajv.compile(schema);
  return validate(data) ? [] : validate.errors.map((e) => `${e.instancePath} ${e.message}`);
}

test('committed data/institutional-allowlist.json validates (empty seed)', () => {
  const problems = [];
  validateInstitutional(DATA, problems);
  assert.deepEqual(problems, []);
});

test('schema accepts a well-formed fictitious entry', () => {
  const problems = problemsFor({
    schema_version: 1,
    updated_at: '2026-11-21',
    entries: [{
      numero: '600123456', // fictitious
      nombre: 'Banco de prueba',
      categoria: 'banco',
      fuente: 'https://example.invalid/fuente-publica',
      verificado_en: '2026-11-21',
    }],
  });
  assert.deepEqual(problems, []);
});

test('schema rejects non-600 numbers and missing source', () => {
  const problems = problemsFor({
    schema_version: 1,
    updated_at: '2026-11-21',
    entries: [{ numero: '56912345678', nombre: 'Movil', categoria: 'otro', verificado_en: '2026-11-21' }],
  });
  assert.ok(problems.length >= 2, JSON.stringify(problems));
});

test('schema rejects unknown categories and extra fields', () => {
  const problems = problemsFor({
    schema_version: 1,
    updated_at: '2026-11-21',
    entries: [{
      numero: '600123456',
      nombre: 'X',
      categoria: 'desconocida',
      fuente: 'f',
      verificado_en: '2026-11-21',
      extra: true,
    }],
  });
  assert.ok(problems.length >= 2, JSON.stringify(problems));
});
