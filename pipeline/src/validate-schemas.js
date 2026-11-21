'use strict';
/**
 * JSON Schema validation (schemas/) with ajv.
 * Collects problems into an array instead of throwing, so `ci` can
 * report everything at once.
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv/dist/2020');
const { checkPayload } = require('./payload');

const SCHEMAS = path.resolve(__dirname, '..', '..', 'schemas');

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMAS, name), 'utf8'));
}

function makeAjv() {
  const ajv = new Ajv({ allErrors: true });
  ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
  return ajv;
}

function validateInstitutional(filePath, problems) {
  try {
    const ajv = makeAjv();
    const validate = ajv.compile(loadSchema('institutional-allowlist.schema.json'));
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!validate(data)) {
      for (const err of validate.errors) problems.push(`institutional allowlist: ${err.instancePath} ${err.message}`);
    }
  } catch (err) {
    problems.push(`institutional allowlist: ${err.message}`);
  }
}

function validateEnvelope(envelope) {
  const problems = [];
  try {
    const ajv = makeAjv();
    const validate = ajv.compile(loadSchema('blocklist-envelope.schema.json'));
    if (!validate(envelope)) {
      for (const err of validate.errors) problems.push(`blocklist envelope: ${err.instancePath} ${err.message}`);
    }
  } catch (err) {
    problems.push(`blocklist envelope: ${err.message}`);
  }
  return problems;
}

function validatePayload(payload) {
  const problems = [];
  try {
    const ajv = makeAjv();
    const validate = ajv.compile(loadSchema('blocklist-payload.schema.json'));
    if (!validate(payload)) {
      for (const err of validate.errors) problems.push(`blocklist payload: ${err.instancePath} ${err.message}`);
    }
    const semantic = checkPayload(payload);
    if (!semantic.ok) problems.push(`blocklist payload: semantic check failed (${semantic.reason})`);
  } catch (err) {
    problems.push(`blocklist payload: ${err.message}`);
  }
  return problems;
}

module.exports = { validateInstitutional, validateEnvelope, validatePayload };
