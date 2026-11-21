'use strict';
/** Schema validation tests for the institutional allowlist (SEC-01 schema). */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { validateInstitutional } = require('../src/validate-schemas');

const DATA = path.resolve(__dirname, '..', '..', 'data', 'institutional-allowlist.json');
const SCHEMA = path.resolve(__dirname, '..', '..', 'schemas', 'institutional-allowlist.schema.json');

function problemsFor(data) {
  const problems = [];
  const Ajv = require('ajv/dist/2020');
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  const ajv = new Ajv({ allErrors: true });
  ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
  ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
  ajv.addFormat('uri', /^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i);
  const validate = ajv.compile(schema);
  return validate(data) ? [] : validate.errors.map((e) => `${e.instancePath} ${e.message}`);
}

function fictitiousEntry() {
  return {
    institucion: 'Institucion Ejemplo',
    categoria: 'banco',
    rol: 'atencion-clientes',
    numero_display: '600 123 4567',
    numero: '6001234567', // ficticio (600 + 7)
    numero_e164: '566001234567',
    fuente: {
      tipo: 'sitio-oficial',
      url: 'https://example.invalid/fuente-publica',
      verificado_en: '2026-11-21',
      metodo: 'contenido-indexado-del-dominio-oficial',
    },
  };
}

test('committed data/institutional-allowlist.json validates (SEC-01 seed, 45 entries)', () => {
  const problems = [];
  validateInstitutional(DATA, problems);
  assert.deepEqual(problems, []);
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  assert.equal(data.criterio_version, 2);
  assert.equal(data.entradas.length, 45);
});

test('schema accepts a well-formed fictitious entry', () => {
  const problems = problemsFor({
    formato: 'fagx-institutional-allowlist/1',
    pais: 'CL',
    criterio_version: 2,
    criterio: 'docs/institutional-allowlist-criteria.md',
    actualizado_en: '2026-11-21T14:19:00Z',
    entradas: [fictitiousEntry()],
  });
  assert.deepEqual(problems, []);
});

test('schema rejects non-600 numbers and missing source', () => {
  const bad = fictitiousEntry();
  bad.numero = '56912345678'; // movil, patrón no permitido
  const bad2 = fictitiousEntry();
  delete bad2.fuente;
  const p1 = problemsFor(topLevel([bad]));
  const p2 = problemsFor(topLevel([bad2]));
  assert.ok(p1.length >= 1, JSON.stringify(p1));
  assert.ok(p2.length >= 1, JSON.stringify(p2));
});

test('schema rejects unknown categories/roles, http sources and extra fields', () => {
  const badCat = fictitiousEntry();
  badCat.categoria = 'desconocida';
  const badRol = fictitiousEntry();
  badRol.rol = 'cobranza';
  const badUrl = fictitiousEntry();
  badUrl.fuente.url = 'http://example.invalid/inseguro';
  const badExtra = fictitiousEntry();
  badExtra.telefono_extra = '123';
  const badE164 = fictitiousEntry();
  badE164.numero_e164 = '56912345678';
  for (const entry of [badCat, badRol, badUrl, badExtra, badE164]) {
    const problems = problemsFor(topLevel([entry]));
    assert.ok(problems.length >= 1, JSON.stringify(problems));
  }
});

test('schema enforces numero_e164 = 56 + numero consistency via pattern', () => {
  const bad = fictitiousEntry();
  bad.numero = '6001234567';
  bad.numero_e164 = '56912345678'; // no deriva de numero
  const problems = problemsFor(topLevel([bad]));
  assert.ok(problems.length >= 1, JSON.stringify(problems));
});

function topLevel(entries) {
  return {
    formato: 'fagx-institutional-allowlist/1',
    pais: 'CL',
    criterio_version: 2,
    criterio: 'docs/institutional-allowlist-criteria.md',
    actualizado_en: '2026-11-21T14:19:00Z',
    entradas: entries,
  };
}
