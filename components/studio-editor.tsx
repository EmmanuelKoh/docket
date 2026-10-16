'use client';

// The Studio: a teleprinter (design spec: pages, Studio). One body. The
// head plate has the engraved name at the left, the platen in the middle
// with the live preview rising out of it at real size, and the printer
// lamp at the right. The code editor is behind a window across the full
// width. The front strip, one step down, has the Template/Data switch,
// the template counter and the key well (New, Save, Delete, Print last).
// On a phone the key well docks at the foot of the screen.
//
// Behaviour:
// - The page gives the templates and the ?template= / ?new=1 choice
//   (app/(dashboard)/studio/page.tsx); without them it asks /templates.
// - A 400ms-debounced, abortable POST /preview renders the draft through
//   the real renderer; the first render goes at once.
// - Save and Delete call /templates. Delete takes two presses, as on a
//   slip's page: the first asks, Keep takes its place and the focus, and
//   Delete, one key back (in Save's place), deletes.
// - Print sends POST /jobs, then follows that job on the eased poll
//   (components/hooks/use-eased-poll.ts) until it ends, to say Printed or
//   Print failed. Nothing is fetched while no print is followed.
// - Cmd/Ctrl+S saves, Cmd/Ctrl+P prints.
// - Edits are kept per template while you step to another one and back,
//   for this visit; the status line says "edited" until you save.
//
// The code editor is a transparent textarea over a highlighted copy of
// its text (studio.css). Both layers keep the same font, size, line
// height, padding, tab size and wrapping, or the caret drifts from the
// text.

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Body, Plate } from '@/components/hardware/kit/body';
import { Counter } from '@/components/hardware/kit/counter';
import { Engraved, Note, PageName } from '@/components/hardware/kit/engraved';
import { Field } from '@/components/hardware/kit/field';
import { Key, KeyWell } from '@/components/hardware/kit/keys';
import { Lamp } from '@/components/hardware/kit/led';
import { Platen, Screen } from '@/components/hardware/kit/screen';
import { Slip } from '@/components/hardware/kit/slip';
import { Switch } from '@/components/hardware/kit/switch';
import { useEasedPoll } from '@/components/hooks/use-eased-poll';

export type StudioTemplate = { name: string; template: string; data?: unknown };
type Job = { id: string; status: string };
type Preview = { url: string; width: number; height: number };
type Status = { kind: 'idle' | 'ok' | 'error'; text: string };
type Tok = readonly [cls: string, text: string];
type Draft = { tpl: string; data: string };

// ---- syntax highlighting: tokens, then one block per line ----

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// HTML + Liquid: Liquid tags and outputs, comments, tag names and
// brackets, attribute names, quoted strings. One pass; the first
// alternative to match at a position wins.
const TEMPLATE_RE =
  /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})|(<!--[\s\S]*?-->)|(<\/?[a-zA-Z][a-zA-Z0-9-]*|\/?>)|(\b[a-zA-Z][a-zA-Z0-9:-]*(?==))|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;

// Inside a string (a style attribute): property names dim, Liquid marked.
const STRING_RE = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})|([a-z-]+)(?=:)/g;

function stringToks(s: string, out: Tok[]) {
  let last = 0;
  for (const m of s.matchAll(STRING_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(['t-str', s.slice(last, at)]);
    out.push([m[1] ? 't-liq t-liq--in' : 't-prop', m[0]]);
    last = at + m[0].length;
  }
  if (last < s.length) out.push(['t-str', s.slice(last)]);
}

function templateToks(src: string): Tok[] {
  const out: Tok[] = [];
  let last = 0;
  for (const m of src.matchAll(TEMPLATE_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(['', src.slice(last, at)]);
    if (m[5]) stringToks(m[5], out);
    else
      out.push([
        m[1] ? 't-liq' : m[2] ? 't-com' : m[3] ? 't-tag' : 't-attr',
        m[0],
      ]);
    last = at + m[0].length;
  }
  if (last < src.length) out.push(['', src.slice(last)]);
  return out;
}

// JSON: keys (a string before a colon), strings, literals, numbers.
const JSON_RE =
  /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function jsonToks(src: string): Tok[] {
  const out: Tok[] = [];
  let last = 0;
  for (const m of src.matchAll(JSON_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(['', src.slice(last, at)]);
    if (m[1] !== undefined) {
      out.push(['t-key', m[1]]);
      out.push(['', m[2]]);
    } else if (m[3] !== undefined) out.push(['t-str', m[3]]);
    else if (m[4] !== undefined) out.push(['t-lit', m[4]]);
    else out.push(['t-num', m[5]]);
    last = at + m[0].length;
  }
  if (last < src.length) out.push(['', src.slice(last)]);
  return out;
}

// One block per line of the source, so a line number can stand at the
// start of each line (CSS counter) and a wrapped line keeps its number on
// its first row. A token that runs over a line break is split there.
function linesHtml(toks: readonly Tok[]): string {
  const open = '<span class="st-ln"><span class="st-tx">';
  let html = open;
  for (const [cls, text] of toks) {
    const parts = text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) html += `</span></span>${open}`;
      const part = parts[i];
      if (part)
        html += cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part);
    }
  }
  return `${html}</span></span>`;
}

// The server cannot know the keyboard: it renders Ctrl, and a Mac
// switches to ⌘ after hydration (no hydration mismatch).
const subscribeNever = () => () => {};
const isMacClient = () => /Mac/i.test(navigator.userAgent);

// A failed fetch throws a browser TypeError ("Failed to fetch", "Load
// failed"...) that varies by browser: show one stable phrase instead.
function fetchErrText(err: unknown): string {
  return err instanceof TypeError ? 'No connection' : (err as Error).message;
}

const dataText = (data: unknown) =>
  data == null
    ? ''
    : typeof data === 'string'
      ? data
      : JSON.stringify(data, null, 2);

const lineCount = (s: string) => s.split('\n').length;

// JSON with its object keys sorted: the store keeps data as jsonb, which
// reorders keys, so "edited" compares values, not text.
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function sameData(src: string, data: unknown): boolean {
  try {
    return canon(src.trim() ? JSON.parse(src) : {}) === canon(data ?? {});
  } catch {
    return false;
  }
}

// POST /templates: the templates after the save, or null (the toast says
// why).
async function apiSave(
  name: string,
  template: string,
  data: unknown,
  say: (msg: string) => void,
): Promise<StudioTemplate[] | null> {
  const resp = await fetch('/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, template, data }),
  });
  const body = await resp.json().catch(() => ({}));
  if (resp.status === 403 && body.readOnly) {
    say('Saving is not enabled on the hosted version yet.');
    return null;
  }
  if (!resp.ok) {
    say(body.error || 'Not saved. Try again.');
    return null;
  }
  return body as StudioTemplate[];
}

const DEFAULT_TPL =
  // impeccable-disable-next-line design-system-font -- receipt font for the renderer, not page type
  '<div style="display:flex;flex-direction:column;width:576px;font-family:Sans;background:#fff;color:#000;padding:24px">\n  <div style="display:flex;font-size:30px;font-weight:700">{{ title }}</div>\n</div>';

const TOAST_MS = 2500;

// ---- the code editor: a transparent textarea over the highlighted text ----

function CodeEditor({
  label,
  value,
  onChange,
  tokens,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  tokens: (src: string) => Tok[];
  placeholder: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hlRef = useRef<HTMLPreElement>(null);
  // Escape, then Tab, moves focus on (Tab alone indents)
  const tabLeaves = useRef(false);
  const html = useMemo(() => linesHtml(tokens(value)), [value, tokens]);
  const hintId = useId();

  const sync = useCallback(() => {
    const ta = taRef.current;
    const hl = hlRef.current;
    if (!ta || !hl) return;
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
  }, []);

  // the highlighted copy changed: keep it at the textarea's scroll
  useLayoutEffect(() => {
    if (html) sync();
  }, [html, sync]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      tabLeaves.current = true;
      return;
    }
    if (e.key !== 'Tab' || e.shiftKey || tabLeaves.current) {
      tabLeaves.current = false;
      return;
    }
    e.preventDefault();
    // insertText keeps the browser's undo history
    if (!document.execCommand('insertText', false, '  ')) {
      const ta = e.currentTarget;
      const s = ta.selectionStart;
      onChange(`${value.slice(0, s)}  ${value.slice(ta.selectionEnd)}`);
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (el) el.selectionStart = el.selectionEnd = s + 2;
      });
    }
  }

  return (
    <div className="st-code">
      <pre
        ref={hlRef}
        className="st-hl"
        aria-hidden="true"
        // the output of the escaping highlighter above
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <span id={hintId} className="sr-only">
        Tab adds two spaces. Press Escape, then Tab, to leave the editor.
      </span>
      <textarea
        ref={taRef}
        className="st-ta"
        aria-label={label}
        aria-describedby={hintId}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={sync}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

// ---- the studio ----

export function StudioEditor({
  initialTemplates,
  initialName,
  startNew,
  lamp,
}: {
  /** null: the page could not read them; the editor asks /templates. */
  initialTemplates: StudioTemplate[] | null;
  /** ?template=: opened if it exists, else the first template. */
  initialName: string;
  /** ?new=1: open New template. */
  startNew: boolean;
  /** The printer's lamp, streamed by the page. */
  lamp: ReactNode;
}) {
  const first = useMemo(() => {
    const list = initialTemplates ?? [];
    return list.find((t) => t.name === initialName) ?? list[0] ?? null;
  }, [initialTemplates, initialName]);

  const [templates, setTemplates] = useState<StudioTemplate[]>(
    initialTemplates ?? [],
  );
  const [currentName, setCurrentName] = useState(first?.name ?? '');
  const [tab, setTab] = useState<'template' | 'data'>('template');
  const [tplSrc, setTplSrc] = useState(first?.template ?? '');
  const [dataSrc, setDataSrc] = useState(dataText(first?.data));
  const [status, setStatus] = useState<Status>({
    kind: 'idle',
    text: first?.template.trim() ? 'Rendering' : '',
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [toast, setToast] = useState('');
  const [newOpen, setNewOpen] = useState(startNew);
  const [newName, setNewName] = useState('');
  const [printing, setPrinting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [followed, setFollowed] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const previewUrl = useRef('');
  const firstPreview = useRef(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const trackingJobId = useRef<string | null>(null);
  const drafts = useRef(new Map<string, Draft>());
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepId = useId();

  const showToast = useCallback((msg: string, ms = TOAST_MS) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), ms);
  }, []);

  // any other action answers the Delete question with Keep
  const disarm = useCallback(() => setConfirming(false), []);

  const saved = templates.find((t) => t.name === currentName);
  const dirty = useMemo(
    () =>
      !!saved && (saved.template !== tplSrc || !sameData(dataSrc, saved.data)),
    [saved, tplSrc, dataSrc],
  );

  // show a template: its draft from this visit if there is one
  const show = useCallback((t: StudioTemplate | undefined) => {
    if (!t) return;
    const draft = drafts.current.get(t.name);
    setCurrentName(t.name);
    setTplSrc(draft?.tpl ?? t.template ?? '');
    setDataSrc(draft?.data ?? dataText(t.data));
  }, []);

  function switchTo(name: string) {
    disarm();
    if (saved && dirty)
      drafts.current.set(saved.name, { tpl: tplSrc, data: dataSrc });
    else if (saved) drafts.current.delete(saved.name);
    show(templates.find((t) => t.name === name));
  }

  // ---- the page could not read the templates: ask /templates ----
  useEffect(() => {
    if (initialTemplates) return;
    let live = true;
    (async () => {
      try {
        const list: StudioTemplate[] = await (await fetch('/templates')).json();
        if (!live || !Array.isArray(list)) return;
        setTemplates(list);
        show(list.find((t) => t.name === initialName) ?? list[0]);
      } catch {
        if (live) showToast('Templates did not load. Reload the page.');
      }
    })();
    return () => {
      live = false;
    };
  }, [initialTemplates, initialName, show, showToast]);

  // ---- New template: a modal dialog ----
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (newOpen && !d.open) d.showModal();
    if (!newOpen && d.open) d.close();
  }, [newOpen]);

  // ---- debounced, abortable preview; the first one goes at once ----
  useEffect(() => {
    const wait = firstPreview.current ? 0 : 400;
    firstPreview.current = false;
    const timer = setTimeout(async () => {
      if (!tplSrc.trim()) {
        abortRef.current?.abort();
        setStatus({ kind: 'idle', text: 'Nothing to preview' });
        setPreview(null);
        return;
      }
      let data: unknown = {};
      if (dataSrc.trim()) {
        try {
          data = JSON.parse(dataSrc);
        } catch (err) {
          setStatus({ kind: 'error', text: `Data: ${(err as Error).message}` });
          return;
        }
      }
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      // an old error goes; a size line stays until the new one comes
      setStatus((s) =>
        s.kind === 'ok' ? s : { kind: 'idle', text: 'Rendering' },
      );
      try {
        const resp = await fetch('/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template: tplSrc, data }),
          signal: ctrl.signal,
        });
        if (!resp.ok) {
          const err = await resp
            .json()
            .catch(() => ({ error: 'Preview failed' }));
          setStatus({ kind: 'error', text: err.error || 'Preview failed' });
          return;
        }
        const blob = await resp.blob();
        const width = Number(resp.headers.get('X-Image-Width') || 576);
        const height = Number(resp.headers.get('X-Image-Height') || 100);
        setPreview({ url: URL.createObjectURL(blob), width, height });
        setStatus({ kind: 'ok', text: `${width} × ${height} px · 1-bit` });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setStatus({ kind: 'error', text: fetchErrText(err) });
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [tplSrc, dataSrc]);

  // free the last preview's image when a new one replaces it
  useEffect(() => {
    const old = previewUrl.current;
    previewUrl.current = preview?.url ?? '';
    if (old && old !== previewUrl.current) URL.revokeObjectURL(old);
  }, [preview]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      clearTimeout(toastTimer.current);
    },
    [],
  );

  // ---- the print just sent: followed on the eased poll until it ends ----
  const loadJobs = useCallback(async () => {
    const id = trackingJobId.current;
    if (!id) return;
    try {
      const resp = await fetch('/jobs?limit=10');
      if (!resp.ok) return;
      const list: Job[] = await resp.json();
      const job = list.find((j) => j.id === id);
      if (!job || trackingJobId.current !== id) return;
      setFollowed(job.status);
      const end =
        job.status === 'done'
          ? 'Printed'
          : job.status === 'failed'
            ? 'Print failed'
            : job.status === 'canceled'
              ? 'Print canceled'
              : '';
      if (end) {
        showToast(end);
        trackingJobId.current = null;
        setFollowed(null);
      }
    } catch {
      // a server hiccup: try again on the next tick
    }
  }, [showToast]);

  const { resume: followNow } = useEasedPoll(loadJobs);

  // ---- actions ----

  // the data editor as JSON: empty is {}, invalid is null (toast says why)
  const parseData = useCallback(
    (doing: string): unknown | null => {
      if (!dataSrc.trim()) return {};
      try {
        return JSON.parse(dataSrc);
      } catch {
        showToast(`Fix the data before ${doing}`);
        return null;
      }
    },
    [dataSrc, showToast],
  );

  const save = useCallback(async () => {
    disarm();
    if (!currentName) return showToast('No template to save');
    const data = parseData('saving');
    if (data === null) return;
    try {
      const result = await apiSave(currentName, tplSrc, data, showToast);
      if (!result) return;
      drafts.current.delete(currentName);
      setTemplates(result);
      showToast(`Saved ${currentName}`);
    } catch (err) {
      showToast(`Not saved: ${fetchErrText(err)}`);
    }
  }, [currentName, tplSrc, parseData, disarm, showToast]);

  async function deleteNow() {
    const name = currentName;
    setDeleting(true);
    try {
      const resp = await fetch(`/templates?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      const body = await resp.json();
      if (resp.status === 403 && body.readOnly) {
        showToast('Deleting is not enabled on the hosted version yet.');
        return;
      }
      if (!resp.ok) {
        showToast(body.error || 'Not deleted. Try again.');
        return;
      }
      drafts.current.delete(name);
      const list = body as StudioTemplate[];
      setTemplates(list);
      if (list.length) show(list[0]);
      else {
        setCurrentName('');
        setTplSrc('');
        setDataSrc('');
      }
      showToast(`Deleted ${name}`);
    } catch (err) {
      showToast(`Not deleted: ${fetchErrText(err)}`);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  // Delete asks first. Keep then stands where Delete was (a second click
  // lands on it) and takes the focus; Escape keeps too.
  function askDelete() {
    if (!currentName) return;
    setToast('');
    setConfirming(true);
  }

  useEffect(() => {
    if (!confirming) return;
    document.getElementById(keepId)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirming, keepId]);

  function openNew() {
    disarm();
    setNewName('');
    setNewOpen(true);
  }

  async function createTemplate() {
    const name = newName.trim();
    if (!name) return;
    setNewOpen(false);
    try {
      const result = await apiSave(
        name,
        DEFAULT_TPL,
        { title: name },
        showToast,
      );
      if (!result) return;
      if (saved && dirty) {
        drafts.current.set(saved.name, { tpl: tplSrc, data: dataSrc });
      }
      setTemplates(result);
      show(result.find((t) => t.name === name));
      setTab('template');
      showToast(`Created ${name}`);
    } catch (err) {
      showToast(`Not created: ${fetchErrText(err)}`);
    }
  }

  const print = useCallback(async () => {
    disarm();
    if (!tplSrc.trim()) return showToast('Nothing to print');
    const data = parseData('printing');
    if (data === null) return;
    setPrinting(true);
    try {
      const resp = await fetch('/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: tplSrc,
          data,
          name: currentName || 'untitled',
          source: 'studio',
        }),
      });
      const body = await resp.json();
      if (resp.ok) {
        trackingJobId.current = body.id;
        setFollowed('queued');
        showToast('Sent to the printer');
        followNow();
      } else {
        showToast(body.error || 'Not sent. Try again.');
      }
    } catch (err) {
      showToast(`Not sent: ${fetchErrText(err)}`);
    } finally {
      setPrinting(false);
    }
  }, [tplSrc, currentName, parseData, followNow, disarm, showToast]);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || dialogRef.current?.open) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        save();
      } else if (k === 'p') {
        e.preventDefault();
        print();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [save, print]);

  const isMac = useSyncExternalStore(subscribeNever, isMacClient, () => false);

  const options = useMemo(
    () => templates.map((t) => ({ value: t.name, label: t.name })),
    [templates],
  );

  const source = tab === 'template' ? tplSrc : dataSrc;
  const message = confirming
    ? `Delete ${currentName}? Press Delete again.`
    : toast;
  const what = tab === 'template' ? 'Liquid' : 'JSON';

  return (
    <div className="st">
      <Body className="st-console">
        <div className="st-top">
          <PageName className="st-name">Studio</PageName>
          <Platen className="st-platen">
            {/* the paper window: from the top of the page down to the
                platen; a long receipt scrolls in it */}
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus so the keyboard can scroll it */}
            <section className="st-feed" aria-label="Preview" tabIndex={0}>
              {preview ? (
                // the paper is masked to its torn top: the focus ring
                // goes on this plain wrapper
                <div className="st-paper">
                  <Slip
                    tear="top"
                    exact
                    src={preview.url}
                    alt={`Preview of ${currentName || 'the receipt'}`}
                    imageWidth={preview.width}
                    imageHeight={preview.height}
                  />
                </div>
              ) : null}
            </section>
          </Platen>
          <div className="st-lamp">
            {followed === 'inflight' ? (
              <Lamp state="printing">Printing</Lamp>
            ) : (
              lamp
            )}
          </div>
        </div>

        <Screen kind="editor" className="st-window" screenClassName="st-screen">
          {tab === 'template' ? (
            <CodeEditor
              key="template"
              label="Template"
              value={tplSrc}
              onChange={setTplSrc}
              tokens={templateToks}
              placeholder="Liquid and HTML"
            />
          ) : (
            <CodeEditor
              key="data"
              label="Data"
              value={dataSrc}
              onChange={setDataSrc}
              tokens={jsonToks}
              placeholder='{"title": "Hello"}'
            />
          )}
          <div className="st-status">
            <span>
              {what} · {lineCount(source)} lines{dirty ? ' · edited' : ''}
            </span>
            <span
              role="status"
              className={status.kind === 'error' ? 'st-err' : undefined}
            >
              {status.text}
            </span>
            <span className="st-hint">
              {isMac ? '⌘S save · ⌘P print' : 'Ctrl+S save · Ctrl+P print'}
            </span>
          </div>
        </Screen>

        <div className="pk-seam st-front">
          <Switch
            variant="mode"
            legends={['Template', 'Data']}
            label="Show data"
            checked={tab === 'data'}
            onChange={(on) => setTab(on ? 'data' : 'template')}
            className="st-mode"
          />
          <Counter
            label="Template"
            options={options}
            value={currentName}
            onChange={switchTo}
            nameWidth={132}
            disabled={options.length === 0}
            className="st-counter"
          />
          <div className="st-dock">
            {/* messages: a live region that is always there, so it is
                announced */}
            <div role="status" className="st-toast-at">
              {message ? (
                <div className="pk-body st-toast">
                  <Note as="span">{message}</Note>
                </div>
              ) : null}
            </div>
            <KeyWell label="Template actions" className="st-keys">
              <Key key="new" legend="New" onClick={openNew} />
              {confirming ? (
                <>
                  <Key
                    key="confirm"
                    legend="Delete"
                    onClick={deleteNow}
                    disabled={deleting}
                  />
                  <Key
                    key="keep"
                    id={keepId}
                    legend="Keep"
                    onClick={disarm}
                    disabled={deleting}
                  />
                </>
              ) : (
                <>
                  <Key key="save" legend="Save" onClick={save} />
                  <Key key="delete" legend="Delete" onClick={askDelete} />
                </>
              )}
              <Key
                key="print"
                legend="Print"
                print
                onClick={print}
                disabled={printing}
              />
            </KeyWell>
          </div>
        </div>
      </Body>

      <dialog
        ref={dialogRef}
        className="st-dialog"
        aria-labelledby="st-new-title"
        onClose={() => setNewOpen(false)}
      >
        <Body
          as="form"
          className="st-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            createTemplate();
          }}
        >
          <Plate head>
            <Engraved as="h2" id="st-new-title">
              New template
            </Engraved>
          </Plate>
          <Plate seam className="flex flex-col gap-6">
            <Field
              label="Name"
              autoComplete="off"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <KeyWell label="New template" className="self-end">
              <Key legend="Cancel" onClick={() => setNewOpen(false)} />
              <Key legend="Create" type="submit" />
            </KeyWell>
          </Plate>
        </Body>
      </dialog>
    </div>
  );
}
