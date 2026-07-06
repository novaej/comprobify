#!/usr/bin/env node
/**
 * Triggers an admin scheduled job over HTTP. Used as the Render Cron Job
 * command for both /v1/admin/jobs/notifications and /v1/admin/jobs/subscriptions
 * so the job's logic lives in a reviewable file instead of a Docker Command
 * text box (which has no shell/quoting support and silently truncates on
 * embedded whitespace).
 *
 * Usage: node scripts/run-admin-job.js <path>
 *   e.g. node scripts/run-admin-job.js /v1/admin/jobs/notifications
 *
 * Requires env vars: API_BASE_URL, ADMIN_SECRET
 */

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/run-admin-job.js <path>');
  process.exit(1);
}

const baseUrl = process.env.API_BASE_URL;
const adminSecret = process.env.ADMIN_SECRET;
if (!baseUrl || !adminSecret) {
  console.error('Missing required env var: API_BASE_URL and/or ADMIN_SECRET');
  process.exit(1);
}

fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${adminSecret}` },
})
  .then(async (res) => {
    const body = await res.text();
    console.log(res.status, body);
    process.exit(res.ok ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
