# PayBox Platform

A PromptPay payment terminal system for Thai merchants. An ESP32-S3 countertop device
displays a QR code, the customer scans it with any Thai banking app, and the merchant is
paid. This repository holds the API, the merchant portal, and the admin portal; they build
into a single Docker image.

Thai-language documentation is in [`README.md`](README.md). Source comments are in Thai.

## What problem it solves

Thai merchants who want to accept PromptPay have two bad options: print a static QR (no
way to reconcile which payment belongs to which sale) or buy a bank terminal (long
onboarding, per-bank lock-in). PayBox generates a **fresh QR per transaction**, confirms
payment in real time, and gives the merchant a dashboard and payout history.

## Layout

```
backend/     Node 22, TypeScript, Express, MySQL 8.4 — API and static host for the SPA
  src/routes/      endpoints grouped by caller: device / merchant / admin
  src/lib/         logic with no HTTP or DB coupling — fees, command queue, alerts, audit
  src/middleware/  authentication and rate limiting
  db/              schema and numbered migrations
  test/            30 tests covering money handling and signature verification
frontend/    React 19, Vite, Tailwind — merchant and admin portals in one bundle
ops/         server-side scripts: backup, restore drill, monitoring, alerting, deploy
docs/        architecture, deployment, and security hardening
```

Device firmware lives in a separate repository (`paybox-firmware`) because it ships on a
different cycle and is written in C++ for PlatformIO.

## Capabilities

**Payments** — per-transaction PromptPay QR via Stripe, live status polling from the
device, and a background reconciler that recovers payments completed after the device
stopped asking. Percentage and flat fee tiers, settlement batches with proof-of-transfer
upload.

**Fleet** — device registration and provisioning, remote firmware updates queued until the
device has been idle for five minutes, immediate remote restart, per-device banner videos
transcoded server-side with ffmpeg, and heartbeat tracking.

**Operations** — nightly database and upload backups with a weekly automated restore drill
that verifies row counts and financial totals, host-level monitoring that alerts to
Telegram or LINE when the site, database, or a device goes quiet, and an audit log of every
administrative action that touches money or access.

**Security** — TOTP two-factor for administrators, session management, rate limiting,
HMAC verification of Stripe and LINE webhooks with replay protection, and secrets kept out
of the repository entirely.

## Setting it up

See [SETUP.md](SETUP.md) for a walkthrough from a bare server to a working terminal (Thai).

## Getting started

```sh
cd backend  && npm ci && npm test && npm run typecheck
cd frontend && npm ci && npm run lint && npm run build
```

Copy `.env.example` to `.env` and fill it in. Real credentials exist only on the server.

## Deployment

The server holds a bare git repository; deployment is a pull and rebuild.

```sh
git push
ssh root@$PAYBOX_HOST /opt/paybox/scripts/deploy.sh
```

The deploy script refuses to run if the server working tree has uncommitted changes, and
the Docker build fails if lint or tests fail — so a red test cannot reach production.
See [`ops/README.md`](ops/README.md).

## Requirements

- A Linux host with Docker and a reverse proxy that terminates TLS (Traefik in production)
- MySQL 8.4 (runs as a container in the provided compose file)
- A Stripe account with PromptPay enabled
- One or more ESP32-S3 devices running the companion firmware
