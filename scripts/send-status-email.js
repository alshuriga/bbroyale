const fs = require('fs');
const { execSync } = require('child_process');

const RESEND_API_URL = 'https://api.resend.com/emails';

function readFileTrim(path) {
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

function readLatestChanges() {
  const fromEnv = (process.env.STATUS_LATEST_CHANGES || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const lines = execSync('git log --pretty=format:%s -n 5', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    if (lines.length > 0) {
      return lines.map((x) => `- ${x}`).join('\n');
    }
  } catch {}
  const fromFile = readFileTrim('status-latest.txt');
  if (fromFile) return fromFile;
  return '- No change notes provided for this deploy.';
}

async function main() {
  const apiKey = process.env.RESEND_API_KEY || readFileTrim('resend-api-key.txt');
  const to = process.env.REPORT_EMAIL_TO || 'alshuriga@gmail.com';
  const from = process.env.REPORT_EMAIL_FROM || 'BBRoyale <onboarding@resend.dev>';
  const subject = process.env.STATUS_EMAIL_SUBJECT || 'BBRoyale status now';
  const screenshotUrl = process.env.STATUS_SCREENSHOT_URL || 'https://image.thum.io/get/https://bbroyale.onrender.com';
  const latestChanges = readLatestChanges();

  if (!apiKey) {
    throw new Error('Missing RESEND_API_KEY (env or resend-api-key.txt).');
  }

  const text = [
    'Current status:',
    '- Production URL: https://bbroyale.onrender.com',
    '- Health endpoint: https://bbroyale.onrender.com/health (returns {"ok":true}).',
    `- Screenshot: ${screenshotUrl}`,
    '- Source repo: https://github.com/alshuriga/bbroyale',
    '- Render deployment completed before this report.',
    '',
    'Latest update:',
    latestChanges,
  ].join('\n');

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Resend API failed (${response.status}): ${body}`);
  }

  console.log('Status email sent successfully.');
  console.log(body);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
