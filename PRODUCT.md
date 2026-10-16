# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, weighted equally (confirmed):
- The owner and a few invited people who share a home receipt printer. They open the dashboard on a phone or laptop, briefly and often.
- Self-hosters who find the open-source repo and run their own instance. They need first-run setup to make sense without help.

## Product Purpose

DOCKET turns a cheap thermal receipt printer into an output for everyday digital life. The server renders each receipt; a small ESP32 board next to the printer fetches finished jobs and prints them. Receipts print on demand (a template, a photo, a music transcription) or on their own (a morning brief, live World Cup goals, a forwarded text turned into a task).

The dashboard exists to do four jobs well (confirmed, with making prints and setting up automations named first):
- Make prints: design templates in Studio, print photos, transcribe music on Tape.
- Set up automations: turn Slips on, set their schedule and settings, pair and share printers.
- Glance: did it print, is the printer online, what prints next.
- Review history: what printed, when, from where, and reprint.

Success: a person sets up a slip once and forgets it; a print looks on screen exactly as it comes out of the printer; a stranger can deploy their own instance from the docs.

## Positioning

The printer stays simple and the server does the work: every receipt is rendered to exact printer bytes before the device sees it, so the on-screen preview is the print. It runs on free hosting tiers for one printer.

## Operating Context

- A printer on a desk or kitchen counter, wired to an ESP32 board over serial. The owner looks at paper first and the dashboard second.
- The dashboard is used in short visits: checking that something printed, testing a template, changing a schedule, pairing a printer.
- Accounts are invite-only. A printer can be shared between accounts.
- Paper is 80 mm wide (576 dots), black only. Grays print as dithered dots.

## Capabilities and Constraints

- Pages today, as lever keys on the nav unit: Home, Slips (with a page for each slip), Studio, Photo, Tape, History, Printer, and Users (admins only). Queue has no key: the Printer page's Queue key links to it, and Home's printer links to it while jobs wait. Login and Invite are outside the nav unit.
- Terminology the product uses: receipt, job, print, slip (the user-facing name for a plugin or template; "Plugins" is a stale name), Studio, Queue, History, Printer, account, invite.
- Printer output is 1-bit at 576 dots wide; previews are the same pixels the printer receives.
- Hosting is metered (Vercel, Upstash, Neon free tiers). The UI must not poll heavily.
- One maintainer. The repo is public.

## Brand Commitments

- Name: DOCKET.
- The dashboard is the printer's own control deck. Each tool page is one machine with its controls built into the housing (the units direction, approved 2026-10-16). The parts: a printed graph-paper ground (a cutting mat in dark); bodies in Leica satin silver (light) or black paint (dark) with engraved, paint-filled lettering; a nav unit of lever keys that rides a track with knurled rollers; tape-deck keys in one well with the red print key last; counter windows with thumbwheels; slide switches; the lime LED; rubber stamps; and the real receipts at real size (a 320px slip, the print at 288px), standing out of a platen. Studio is a teleprinter, Photo is one camera body, and Home's printer is the status unit. The faces are Big Shoulders, Hanken Grotesk and Martian Mono.
- Each accent has fixed jobs (docs/design-spec.md, accent rules). Red: the current page, printing, failures, waiting jobs, the one print key in a well, the red dot of Photo's Capture release, and Tape's live audio and selection. Green: the online LED. Orange: the ON mark of a slide switch.
- Copy is plain and short, written by a person: no jargon, no internal names, no em dashes, no file paths or endpoint names in the interface.

## Evidence on Hand

- Real rendered receipts: docs/images/receipt-*.png (Daily Brief, Task, World Cup kickoff, goal and full time) and the reference templates in reference/*-templates.json.
- Hardware notes: docs/rp850-field-notes.md and docs/receipt-printer-build-guide.md.
- No user counts, testimonials or press exist. Do not invent them.

## Product Principles

1. The print is the truth. Show the real receipt wherever a receipt is the subject.
2. Answer "is it working" at a glance, then get out of the way.
3. Set up once, then forget. Automations explain their next run, not their internals.
4. Plain words over system words.
5. Frugal by design. Nothing on screen should cost a metered call it does not need.

## Accessibility & Inclusion

- Readable text sizes on phone and laptop: body text is 16px, secondary text is 14px or larger, and sizes from 10.5px to 12px are only for engraved legends in capitals on hardware parts.
- Sufficient contrast in light and dark themes, including red on both.
