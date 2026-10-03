#!/usr/bin/env node
/**
 * Wraps `npm audit --omit=dev --audit-level=high` with a small allowlist for
 * advisories that have no patched version available upstream yet - so CI
 * stays genuinely blocking for every NEW production vulnerability instead of
 * going permanently red over one nobody can act on (the same reasoning
 * ci.yml already applies to dev-only tooling, scoped here to a single
 * production advisory instead of a whole dependency).
 *
 * Each entry must name why it's here and when to remove it. Removing an
 * entry is as simple as deleting its line once `npm audit` stops reporting
 * it (i.e. a patched version has shipped and been installed).
 */

const { execSync } = require('child_process');

// GHSA ID -> reason it's allowed through. See docs/security-audit-2026-09-12.md
// finding #6 for the full writeup of each entry.
const ALLOWED_ADVISORIES = {
  'GHSA-86w9-cpqp-85rv':
    'node-forge RSA PKCS#1 v1.5 signature verification - no patched version ' +
    'exists (1.4.0 is latest). A direct, load-bearing dependency (P12 parsing ' +
    '+ XAdES-BES signing in helpers/signer.js and certificate.service.js); ' +
    'neither of those call the vulnerable verify() path - only the standalone ' +
    'scripts/verify-signature.js debug CLI does, which isn\'t part of the ' +
    'deployed API/worker runtime. Revisit when node-forge ships a fix.',
};

function run() {
  try {
    execSync('npm audit --omit=dev --audit-level=high --json', { stdio: 'pipe' });
    console.log('npm audit: no high/critical vulnerabilities in production dependencies.');
    return true;
  } catch (err) {
    // npm audit exits non-zero whenever it finds something at/above --audit-level,
    // with the actual report on stdout (not a thrown-away error) - fall through.
    return err.stdout ? JSON.parse(err.stdout.toString()) : (() => { throw err; })();
  }
}

const report = run();
if (report === true) {
  process.exit(0);
}

const findings = Object.values(report.vulnerabilities || {}).flatMap((v) => v.via)
  .filter((v) => typeof v === 'object' && v.url);

const unresolved = [];
const allowed = [];
for (const finding of findings) {
  const ghsaId = (finding.url.match(/GHSA-[a-z0-9-]+$/i) || [])[0];
  if (ghsaId && ALLOWED_ADVISORIES[ghsaId]) {
    allowed.push({ ghsaId, finding });
  } else {
    unresolved.push(finding);
  }
}

if (allowed.length > 0) {
  console.log('npm audit: allow-listed advisories present (see reason below) -');
  for (const { ghsaId, finding } of allowed) {
    console.log(`  - ${finding.title} (${ghsaId})`);
    console.log(`    ${ALLOWED_ADVISORIES[ghsaId]}`);
  }
}

if (unresolved.length > 0) {
  console.error('npm audit: unresolved high/critical vulnerabilities in production dependencies -');
  for (const finding of unresolved) {
    console.error(`  - ${finding.title} (${finding.url})`);
  }
  process.exit(1);
}

console.log('npm audit: no unresolved high/critical vulnerabilities (allow-listed entries excepted).');
process.exit(0);
