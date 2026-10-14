# Security

## Report a vulnerability

Report security bugs privately through GitHub. Open the repo's Security
tab and choose "Report a vulnerability", or go to
<https://github.com/EmmanuelKoh/docket/security/advisories/new>.
Only you and the maintainer can see the report.

Do not report a security bug in a public issue, a pull request or a
discussion.

Include the steps to reproduce, what an attacker gains, and the commit or
deployment you tested.

## Scope

- The hosted app: the dashboard and its JSON APIs.
- The device endpoints: `/next`, `/ack`, `/nack` and `/tick`.
- Printer pairing: `/pair` and the pairing and share codes.
- Message ingest: `/ingest` and its token.
- The ESP32 firmware in `firmware/docket-agent/`.
- The Android forwarder in `android-forwarder/`.

Bugs in Vercel, Neon, Upstash or Gemini themselves go to those vendors.
