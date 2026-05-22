const fs = require('fs');

const RESEND_API_URL = 'https://api.resend.com/emails';

function readFileTrim(path) {
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

async function main() {
  const apiKey = process.env.RESEND_API_KEY || readFileTrim('resend-api-key.txt');
  const to = process.env.REPORT_EMAIL_TO || 'alshuriga@gmail.com';
  const from = process.env.REPORT_EMAIL_FROM || 'BBRoyale <onboarding@resend.dev>';
  const subject = process.env.STATUS_EMAIL_SUBJECT || 'BBRoyale status now';
  const screenshotUrl = process.env.STATUS_SCREENSHOT_URL || 'https://image.thum.io/get/https://bbroyale.onrender.com';

  if (!apiKey) {
    throw new Error('Missing RESEND_API_KEY (env or resend-api-key.txt).');
  }

  const text = [
    'Current status:',
    '- Production URL: https://bbroyale.onrender.com',
    '- Health endpoint: https://bbroyale.onrender.com/health (returns {"ok":true}).',
    `- Screenshot: ${screenshotUrl}`,
    '- Source repo: https://github.com/alshuriga/bbroyale',
    '- Render web service created and deployed successfully.',
    '- Multiplayer game implemented (rooms, max 5 players, FFA, 2 weapons, respawn).',
    '- Vercel deploy is kept, but realtime hosting is now on Render for WebSocket compatibility.',
    '- 30-minute email reporting implemented in server.js.',
    '- Default report recipient: alshuriga@gmail.com.',
    '- Added .gitignore and .env.example for safer secret handling.',
    '- README updated with setup instructions.',
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
