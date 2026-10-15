---
version: 1
slug: "app-dashboard-page-tsx"
primary_target: "app/(dashboard)/page.tsx"
related_targets: ["app/(dashboard)/layout.tsx","components/app-sidebar.tsx","app/globals.css"]
---

## Scope

Mode: Operate. The whole dashboard shell, and Home ('/') as the primary surface. Every dashboard page, Login and Invite follow the same world.

Audience: the owner, invited members, and self-hosters. Job: see today's prints and the printer's state at a glance, turn slips on and off, and reach the tools. Constraints are in CLAUDE.md:
- the boundary lock;
- no Postgres on the device cadence;
- the photo engine and the tape canvases are contracts;
- the preview pixels in Studio and Photo stay exact.

## Direction contract

THESIS: the dashboard is the printer's own control deck. Today's real receipts feed out of the printer at true size. A stat-card dashboard and a sidebar of icon links are refused.

OWN-WORLD:
- a warm grey printed graph-paper ground;
- painted panels with black label plates;
- a bank of matte lever keys with a red flag window;
- matte push keys in a shared dark cutout, with one red print key;
- a lime LED in a black collar;
- a ribbed slide switch with an orange ON mark;
- Big Shoulders Display, Hanken Grotesk, Martian Mono.

STORY: the visitor sees what printed today and whether the printer is alive. They flip a slip on or off and leave.

FIRST VIEWPORT:
- Left: the panel with the key bank.
- Centre: TODAY in 64px printed ink. The printer front edge spans the roll column, with today's newest slip feeding out at 576px.
- Right: a Printer module (LED, state, last seen) and a Slips module (switch rows).

FORM: user-pinned direction E from the Claude Design canvas (Home-E and System-E, approved 2026-10-15). There is no seed key. Signature interaction: a lever key dips lengthways into the cutout on press and stays down for the current page. The motion grammar is short mechanical travel: no fades, no springs.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Dark mode overrides are arriving from the realism lab; they map onto html[data-theme="dark"].
