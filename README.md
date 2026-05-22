# Pixel Deathmatch (Top-Down)

Multiplayer top-down pixel deathmatch shooter (FFA) with room URLs.

## Rules
- Mode: free-for-all, every player against every player.
- Max players per room: 5.
- Start HP: 100.
- Respawn: 3 seconds after death.
- Weapons:
  - `1`: Pistol (high damage, slower fire rate)
  - `2`: Rifle (lower damage, fast fire rate)
- Controls:
  - `WASD`: move
  - Mouse: aim
  - Hold left click: fire

## Run locally
```bash
npm install
npm run dev
```
Open `http://localhost:3000`.

## Room sharing
After join/create, URL contains `?room=<id>`. Share this URL so others join the same room.

## Deploy to Vercel
```bash
npm i -g vercel
vercel login
vercel --prod
```
Or with token:
```bash
vercel --prod --token "$VERCEL_TOKEN"
```

Project helper (reads `VERCEL_TOKEN` or `vercel-token.txt`):
```bash
npm run deploy:vercel
```

## 30-minute Email Reports
Server can send a runtime report every 30 minutes via Resend.

Required environment variables:
- `RESEND_API_KEY`
- `REPORT_EMAIL_FROM` (must be a verified sender in Resend)

Optional:
- `REPORT_EMAIL_TO` (default: `alshuriga@gmail.com`)
- `REPORT_EMAIL_SUBJECT` (default: `BBRoyale 30-min report`)

Example with `.env`:
```bash
cp .env.example .env
# edit .env and set real RESEND_API_KEY / REPORT_EMAIL_FROM
set -a
source .env
set +a
npm run dev
```

In local non-production mode, if `RESEND_API_KEY` is missing, server also tries `resend-api-key.txt`.

## Send One-Time Status Email
Send current project status to the configured recipient:
```bash
npm run send:status
```

Environment overrides:
- `REPORT_EMAIL_TO`
- `REPORT_EMAIL_FROM`
- `STATUS_EMAIL_SUBJECT`
