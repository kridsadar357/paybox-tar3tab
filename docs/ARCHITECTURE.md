# Architecture

## Shape of the system

```
   ESP32-S3 device                    VPS (Docker)                    Stripe
   ┌──────────────┐    HTTPS poll     ┌──────────────────┐
   │ LVGL UI      │ ────────────────► │ Express API      │ ──────────► PaymentIntent
   │ QR display   │ ◄──────────────── │  + React SPA     │ ◄────────── webhook
   │ OTA client   │    commands       │  + MySQL 8.4     │
   └──────────────┘                   └──────────────────┘
         ▲                                     ▲
         │ heartbeat every 60s                 │ cron on the host
         └─────────────────────────────────────┘  backup · restore drill · monitoring
```

## Decisions worth knowing

**Devices poll; the server never connects to them.** Terminals sit behind consumer NAT at
merchant sites, so there is no inbound path. Every remote action — firmware update,
restart, configuration change — is queued server-side and collected on the next heartbeat.
The heartbeat interval is therefore the worst-case latency of every remote action, which is
why it is 60 seconds rather than the 5 minutes it started at.

**Firmware updates wait for the device to be idle; restarts do not.** A forced update
during a transaction would drop a customer's payment mid-scan, so updates are held until
five quiet minutes have passed since the last transaction, and the timer restarts if
activity resumes. Restart is exempt: a device stuck badly enough to need a restart may
never satisfy a quiet timer.

**The payment webhook is the source of truth, not the device.** A PromptPay QR stays
payable after the device stops polling, so a customer can pay after the terminal has given
up. The Stripe webhook records those, and a periodic reconciler sweeps up anything the
webhook missed. This recovered three real payments that had been stuck as pending for five
days.

**Monitoring runs on the host, not in the container.** One of the things being watched is
the backend itself. A watcher living inside it dies with it and reports nothing.

**Alert credentials live in a file, not the database.** One job of the watcher is to report
"cannot reach the database". Credentials stored in that database would be unreadable at
exactly the moment they are needed.

**Money is computed in pure functions.** Fee tiers, settlement splits, and rounding live in
`backend/src/lib/money.ts` with no database or HTTP coupling, so they are covered by tests.
All rounding is to two decimals in code rather than left to MySQL, so displayed and stored
figures cannot drift by a satang.

## Data model

`customers` own `devices`. Each scan creates a `transaction` holding the Stripe
PaymentIntent id, the amount, and a snapshot of the fee tier at that moment — snapshotted
because changing a merchant's rate must not retroactively rewrite past payouts. Completed
transactions are grouped into a `settlement` when the operator pays the merchant, with the
transfer slip attached. `device_commands` is the queue for remote actions. `audit_log`
records every administrative action touching money or access.

## Request paths

| Caller | Path | Authentication |
|---|---|---|
| Device | `/api/*` | device key in query string, checked against `devices` |
| Merchant | `/api/customer/*` | bearer token from login, optional TOTP |
| Admin | `/api/admin/*` | bearer token from login, optional TOTP |
| Stripe | `/api/stripe/webhook` | HMAC-SHA256 over the raw body, 300-second replay window |
| LINE | `/api/line/webhook` | HMAC-SHA256 over the raw body, base64 |
| Browser | `/customer`, `/portal/administrator` | static SPA, client-side routing |

Both webhook routes are mounted before `express.json()` because signature verification
needs the unparsed body.

## Build and release

One Docker image contains both the compiled API and the built SPA. The frontend and backend
are versioned together on purpose: there is never a window where a new page talks to an old
API. The build runs lint and tests before compiling, so a failing test cannot produce an
image.

Static assets are content-hashed and served with a one-year immutable cache; `index.html`
is served with `no-cache` so a client never holds an HTML file pointing at deleted assets.
Responses are gzipped, which takes the first load from roughly 589 KB to 109 KB.
