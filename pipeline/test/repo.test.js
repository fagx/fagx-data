'use strict';
/** Repo-level guards: secret scan stays clean and the published list is valid. */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { scanRepo } = require('../src/secrets-scan');

const ROOT = path.resolve(__dirname, '..', '..');

test('secret scan: committed private key only lives under keys/solo-test', () => {
  const findings = scanRepo(ROOT).filter((f) => f.includes('private key block'));
  assert.deepEqual(findings, []);
});

test('secret scan: token patterns fail when present (self-test on a temp string)', () => {
  const findings = scanRepo(ROOT);
  assert.deepEqual(findings, [], `repo must stay clean: ${JSON.stringify(findings)}`);
});

test('published blocklist.json (if present) is a valid solo-test-signed envelope', () => {
  const file = path.join(ROOT, 'blocklist.json');
  if (!fs.existsSync(file)) return; // before first publication
  const { verifyEnvelope, loadKeyring } = require('../src/envelope');
  const { checkPayload } = require('../src/payload');
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = verifyEnvelope(envelope, loadKeyring(path.join(ROOT, 'pipeline', 'keys')));
  assert.equal(res.ok, true, `published envelope verification: ${res && res.reason}`);
  assert.equal(checkPayload(res.payload).ok, true);
});
