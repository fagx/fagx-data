'use strict';
/**
 * Lightweight secret scan for a public repository.
 *
 * Baseline guard (rules transversales: no secrets in repos, docs or logs).
 * It is not a substitute for review; it catches obvious accidental
 * commits of credentials.
 *
 * Rules:
 * - PEM private key blocks are only allowed under pipeline/keys/solo-test/
 *   (committed on purpose, marked solo-test, disposable).
 * - Known token shapes (GitHub PATs, AWS keys, Google API keys, Slack
 *   tokens, generic api_key/secret assignments with literal values)
 *   fail anywhere in tracked text files.
 */

const fs = require('fs');
const path = require('path');

const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const TOKEN_PATTERNS = [
  [/ghp_[A-Za-z0-9]{36}/, 'github PAT'],
  [/github_pat_[A-Za-z0-9_]{22,}/, 'github fine-grained PAT'],
  [/AKIA[0-9A-Z]{16}/, 'aws access key'],
  [/AIza[0-9A-Za-z_-]{35}/, 'google api key'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'slack token'],
  [/\b(api_key|apikey|api_secret|client_secret|password)\s*[=:]\s*['"][^'"]{8,}['"]/i, 'literal secret assignment'],
];

const ALLOWED_PRIVATE_KEY_PREFIXES = ['pipeline/keys/solo-test/'];

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const SKIP_FILES = new Set(['package-lock.json']);

function* walk(dir, root) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full, root);
    } else {
      if (SKIP_FILES.has(entry.name)) continue;
      yield full;
    }
  }
}

/** @returns {string[]} findings (empty = clean) */
function scanRepo(rootDir) {
  const findings = [];
  for (const file of walk(rootDir, rootDir)) {
    const rel = path.relative(rootDir, file).split(path.sep).join('/');
    const ext = path.extname(rel);
    if (!['.js', '.json', '.md', '.yml', '.yaml', '.txt', '.sh', '.pem'].includes(ext)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (PRIVATE_KEY_BLOCK.test(line)) {
        if (!ALLOWED_PRIVATE_KEY_PREFIXES.some((p) => rel.startsWith(p))) {
          findings.push(`${rel}:${i + 1}: private key block outside ${ALLOWED_PRIVATE_KEY_PREFIXES.join(', ')}`);
        }
      }
      for (const [pattern, label] of TOKEN_PATTERNS) {
        if (pattern.test(line)) {
          findings.push(`${rel}:${i + 1}: ${label}`);
        }
      }
    });
  }
  return findings;
}

module.exports = { scanRepo };
