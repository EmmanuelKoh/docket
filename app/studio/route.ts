// GET /studio — the template editor (views/studio.html), served behind the
// session like the legacy app does. The studio is a self-contained page
// that talks to /templates, /preview and /jobs, all of which this app now
// serves at the same paths.
//
// The file itself stays byte-identical (the legacy app still serves it),
// but its header nav points at legacy /dashboard/* paths that do not
// exist here, leaving no way back. So the nav is rewritten at serve time
// to the shell's vocabulary (Overview / Recipes / Queue / History, with
// Recipes active since that is where the studio is entered from). The
// theme toggle and logout in the nav already work: the toggle shares the
// docket-theme localStorage key and /logout exists in this app. If the
// header markup in studio.html ever changes, these replacements no-op and
// the legacy nav shows again — update the strings below alongside it.

import fs from 'node:fs';
import path from 'node:path';
import { requestSessionValid } from '@/app/_lib/dashboard-session';

const STUDIO_FILE = path.join(process.cwd(), 'views', 'studio.html');

const LEGACY_WORDMARK = '<a class="wordmark" href="/dashboard">DOCKET</a>';
const SHELL_WORDMARK = '<a class="wordmark" href="/">DOCKET</a>';

const LEGACY_NAV = `<a href="/dashboard">Home</a>
    <a href="/dashboard/templates" class="active">Templates</a>
    <a href="/dashboard/photo">Photo</a>
    <a href="/dashboard/plugins">Plugins</a>
    <a href="/dashboard/queue">Queue</a>
    <a href="/dashboard/history">History</a>`;
const SHELL_NAV = `<a href="/">Overview</a>
    <a href="/recipes" class="active">Recipes</a>
    <a href="/queue">Queue</a>
    <a href="/history">History</a>`;

let cached: string | null = null;

function studioHtml(): string {
  if (cached) return cached;
  cached = fs
    .readFileSync(STUDIO_FILE, 'utf-8')
    .replace(LEGACY_WORDMARK, SHELL_WORDMARK)
    .replace(LEGACY_NAV, SHELL_NAV);
  return cached;
}

export async function GET(req: Request) {
  if (!requestSessionValid(req)) {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  return new Response(studioHtml(), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
