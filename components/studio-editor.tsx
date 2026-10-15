'use client';

// The Studio, rebuilt in the shell. Behavior ported from the legacy
// views/studio.html: template select + New/Save/Delete/Print toolbar,
// Template/Data editors with syntax highlighting (transparent textarea
// over a colored <pre> — see studio.css), a 400ms-debounced abortable
// /preview render onto the 624px paper roll, a recent-jobs strip that
// polls on the Queue's eased cadence (3s while active, 30s after two idle
// minutes, paused after thirty, never while the tab is hidden; any
// interaction resumes it), Ctrl/Cmd+S and +P, and the
// /studio?template=Name / ?new=1 URL contract the slip pages use.

import { useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { jobImageSrc } from '@/app/_lib/format';
import { Field } from '@/components/hardware/field';
import { Led } from '@/components/hardware/led';
import { Module } from '@/components/hardware/module';
import { PaperRoll, PaperSlip, PrinterEdge } from '@/components/hardware/paper';
import { KeyGroup, PushKey } from '@/components/hardware/push-key';
import { Row } from '@/components/hardware/row';
import { Stamp } from '@/components/hardware/stamp';
import { ErrorText, Note } from '@/components/hardware/text';
import { useEasedPoll } from '@/components/hooks/use-eased-poll';

type Template = { name: string; template: string; data?: unknown };
type Job = {
  id: string;
  name?: string;
  status: string;
  width?: number;
  height?: number;
  createdAt: string;
  imageUrl?: string | null; // hosted: the PNG straight from the store
};

// ---- syntax highlighting (ported verbatim) ----

const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// HTML + Liquid: liquid tags/outputs, comments, quoted strings, tag
// names/brackets, numbers. One linear pass — first alternative to match
// at a position wins.
function highlightTemplateSrc(src: string): string {
  const re =
    /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})|(<!--[\s\S]*?-->)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(<\/?[a-zA-Z][a-zA-Z0-9-]*|\/?>)|(\b\d+(?:\.\d+)?\b)/g;
  let out = '';
  let last = 0;
  let m = re.exec(src);
  while (m) {
    out += escHtml(src.slice(last, m.index));
    const cls = m[1]
      ? 'tok-liquid'
      : m[2]
        ? 'tok-comment'
        : m[3]
          ? 'tok-string'
          : m[4]
            ? 'tok-tag'
            : 'tok-num';
    out += `<span class="${cls}">${escHtml(m[0])}</span>`;
    last = re.lastIndex;
    m = re.exec(src);
  }
  return out + escHtml(src.slice(last));
}

// JSON: keys (string before a colon), strings, literals, numbers.
function highlightJsonSrc(src: string): string {
  const re =
    /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let out = '';
  let last = 0;
  let m = re.exec(src);
  while (m) {
    out += escHtml(src.slice(last, m.index));
    if (m[1] !== undefined) {
      out += `<span class="tok-key">${escHtml(m[1])}</span>${escHtml(m[2])}`;
    } else if (m[3] !== undefined) {
      out += `<span class="tok-string">${escHtml(m[3])}</span>`;
    } else if (m[4] !== undefined) {
      out += `<span class="tok-lit">${escHtml(m[4])}</span>`;
    } else {
      out += `<span class="tok-num">${escHtml(m[5])}</span>`;
    }
    last = re.lastIndex;
    m = re.exec(src);
  }
  return out + escHtml(src.slice(last));
}

// `now` is when the list arrived (state, set after mount), so rendering
// never reads the clock.
function timeAgo(iso: string, now: number): string {
  const s = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (s < 5) return 'Now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const subscribeNever = () => () => {};
const isMacClient = () => /Mac/i.test(navigator.userAgent);

// a failed fetch throws a browser TypeError ("Failed to fetch", "Load
// failed"…) that varies by browser — show one stable phrase instead
function fetchErrText(err: unknown): string {
  return err instanceof TypeError ? 'No connection' : (err as Error).message;
}

const DEFAULT_TPL =
  '<div style="display:flex;flex-direction:column;width:576px;font-family:Sans;background:#fff;color:#000;padding:24px">\n  <div style="display:flex;font-size:30px;font-weight:700">{{ title }}</div>\n</div>';

// ---- the overlay code editor ----

function CodeEditor({
  label,
  value,
  onChange,
  highlight,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  highlight: (src: string) => string;
  placeholder: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const syncScroll = () => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (!ta || !pre) return;
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  };

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const ta = e.currentTarget;
    const s = ta.selectionStart;
    const end = ta.selectionEnd;
    onChange(`${value.substring(0, s)}  ${value.substring(end)}`);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) el.selectionStart = el.selectionEnd = s + 2;
    });
  }

  return (
    <div className="code-wrap">
      {/* trailing newline keeps the last line aligned when scrolled to
          bottom; the html is the output of the escaping highlighter above */}
      <pre
        ref={preRef}
        className="code-hl"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: `${highlight(value)}\n` }}
      />
      <textarea
        ref={taRef}
        aria-label={label}
        wrap="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(syncScroll);
        }}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

// ---- the studio ----

export function StudioEditor() {
  const searchParams = useSearchParams();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [currentName, setCurrentName] = useState('');
  const [tab, setTab] = useState<'template' | 'data'>('template');
  const [tplSrc, setTplSrc] = useState('');
  const [dataSrc, setDataSrc] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [status, setStatus] = useState<{ cls: string; text: string }>({
    cls: '',
    text: 'Ready',
  });
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewSize, setPreviewSize] = useState<[number, number] | null>(null);
  const [toast, setToast] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalName, setModalName] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsAt, setJobsAt] = useState(0);
  const [printing, setPrinting] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const trackingJobId = useRef<string | null>(null);
  const booted = useRef(false);

  function showToast(msg: string) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2500);
  }

  // parse the data editor; empty = {}, invalid = null (error bar shows why)
  const parseData = useCallback((): unknown | null => {
    const raw = dataSrc.trim();
    if (!raw) {
      setJsonError('');
      return {};
    }
    try {
      const d = JSON.parse(raw);
      setJsonError('');
      return d;
    } catch (err) {
      setJsonError(`Data: ${(err as Error).message}`);
      return null;
    }
  }, [dataSrc]);

  const loadTemplate = useCallback((list: Template[], name: string) => {
    const t = list.find((x) => x.name === name);
    if (!t) return;
    setCurrentName(name);
    setTplSrc(t.template || '');
    setDataSrc(
      typeof t.data === 'string' ? t.data : JSON.stringify(t.data, null, 2),
    );
    setJsonError('');
  }, []);

  // ---- boot: fetch templates, honor ?template= and ?new=1 ----
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      let list: Template[] = [];
      try {
        list = await (await fetch('/templates')).json();
      } catch {
        list = [];
      }
      setTemplates(list);
      const wanted = searchParams.get('template');
      const name =
        wanted && list.some((t) => t.name === wanted)
          ? wanted
          : list.length
            ? list[0].name
            : '';
      if (name) loadTemplate(list, name);
      if (searchParams.get('new')) setModalOpen(true);
    })();
  }, [searchParams, loadTemplate]);

  // ---- debounced abortable preview ----
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!tplSrc.trim()) {
        setStatus({ cls: '', text: 'Ready' });
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return '';
        });
        return;
      }
      const raw = dataSrc.trim();
      let data: unknown = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          setStatus({ cls: 'error', text: 'Fix the data to see a preview' });
          return;
        }
      }
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStatus({ cls: '', text: 'Rendering' });
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
          setStatus({ cls: 'error', text: err.error || 'Preview failed' });
          return;
        }
        const blob = await resp.blob();
        const w = Number(resp.headers.get('X-Image-Width') || 576);
        const h = Number(resp.headers.get('X-Image-Height') || 100);
        const url = URL.createObjectURL(blob);
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
        setPreviewSize([w, h]);
        setStatus({ cls: 'active', text: `${w} × ${h} px · 1-bit` });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setStatus({ cls: 'error', text: fetchErrText(err) });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [tplSrc, dataSrc]);

  // ---- recent jobs: the eased poll (components/hooks/use-eased-poll.ts) ----
  const loadJobs = useCallback(async () => {
    try {
      const resp = await fetch('/jobs?limit=10');
      if (!resp.ok) return;
      const list: Job[] = await resp.json();
      setJobs(list);
      setJobsAt(Date.now());
      if (trackingJobId.current) {
        const tracked = list.find((j) => j.id === trackingJobId.current);
        if (tracked?.status === 'done') {
          showToast('Printed');
          trackingJobId.current = null;
        } else if (tracked?.status === 'failed') {
          showToast('Print failed');
          trackingJobId.current = null;
        }
      }
    } catch {
      // server hiccup — keep the last list
    }
  }, []);

  const { refresh: refreshJobs } = useEasedPoll(loadJobs, { immediate: true });

  // ---- actions ----

  async function apiSave(name: string, template: string, data: unknown) {
    const resp = await fetch('/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, template, data }),
    });
    const body = await resp.json();
    if (resp.status === 403 && body.readOnly) {
      showToast('Saving is not enabled on the hosted version yet.');
      return null;
    }
    if (!resp.ok) {
      showToast(body.error || 'Save failed');
      return null;
    }
    return body as Template[];
  }

  const save = useCallback(async () => {
    if (!currentName) return showToast('No template selected');
    const data = parseData();
    if (data === null) return showToast('Fix the data before saving');
    const result = await apiSave(currentName, tplSrc, data);
    if (result) {
      setTemplates(result);
      showToast(`Saved "${currentName}"`);
    }
  }, [currentName, tplSrc, parseData]);

  async function doDelete() {
    if (!currentName) return;
    if (!confirm(`Delete "${currentName}"?`)) return;
    const resp = await fetch(
      `/templates?name=${encodeURIComponent(currentName)}`,
      {
        method: 'DELETE',
      },
    );
    const body = await resp.json();
    if (resp.status === 403 && body.readOnly) {
      showToast('Deleting is not enabled on the hosted version yet.');
      return;
    }
    if (!resp.ok) {
      showToast(body.error || 'Delete failed');
      return;
    }
    setTemplates(body);
    const next = body.length ? body[0].name : '';
    if (next) loadTemplate(body, next);
    else {
      setCurrentName('');
      setTplSrc('');
      setDataSrc('');
    }
    showToast('Deleted');
  }

  async function createTemplate() {
    const name = modalName.trim();
    if (!name) return;
    setModalOpen(false);
    const result = await apiSave(name, DEFAULT_TPL, { title: name });
    if (result) {
      setTemplates(result);
      loadTemplate(result, name);
      showToast(`Created "${name}"`);
    }
  }

  const print = useCallback(async () => {
    if (!tplSrc.trim()) return showToast('Nothing to print');
    const data = parseData();
    if (data === null) return showToast('Fix the data before printing');
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
        showToast('Sent to the printer');
        refreshJobs();
      } else {
        showToast(body.error || 'Not sent. Try again.');
      }
    } catch (err) {
      showToast(`Not sent: ${fetchErrText(err)}`);
    } finally {
      setPrinting(false);
    }
  }, [tplSrc, currentName, parseData, refreshJobs]);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        print();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [save, print]);

  // The server cannot know the keyboard: it renders Ctrl, and a Mac
  // switches to ⌘ after hydration (no hydration mismatch).
  const isMac = useSyncExternalStore(subscribeNever, isMacClient, () => false);

  return (
    <div className="flex flex-col gap-6">
      {/* toolbar: the template, its keys, then the red print key */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <Field
          as="select"
          label="Template"
          className="w-[260px] max-sm:w-full"
          value={currentName}
          onChange={(e) => loadTemplate(templates, e.target.value)}
        >
          {templates.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </Field>
        <KeyGroup>
          <PushKey
            onClick={() => {
              setModalName('');
              setModalOpen(true);
            }}
          >
            New
          </PushKey>
          <PushKey onClick={save}>Save</PushKey>
          <PushKey onClick={doDelete}>Delete</PushKey>
        </KeyGroup>
        <div className="grow" />
        <Note className="hw-ink pb-3.5 max-lg:hidden">
          {isMac ? '⌘S save · ⌘P print' : 'Ctrl+S save · Ctrl+P print'}
        </Note>
        <KeyGroup>
          <PushKey variant="print" onClick={print} disabled={printing}>
            Print
          </PushKey>
        </KeyGroup>
      </div>

      {/* the code takes the rest of the width; the stage holds the paper
          at its true 576px (648px with the printer edge's 12px overhang) */}
      <div className="grid gap-6 min-[1200px]:grid-cols-[minmax(360px,1fr)_minmax(0,648px)]">
        <Module
          number="01"
          title="Code"
          flush
          className="h-[70vh] min-h-[420px]"
          bodyClassName="min-h-0 flex-1"
        >
          <div className="px-4 pt-3.5 pb-3">
            <KeyGroup>
              {(['template', 'data'] as const).map((t) => (
                <PushKey
                  key={t}
                  size="compact"
                  down={tab === t}
                  aria-pressed={tab === t}
                  onClick={() => setTab(t)}
                >
                  {t === 'template' ? 'Template' : 'Data'}
                </PushKey>
              ))}
            </KeyGroup>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4">
            {tab === 'template' ? (
              <CodeEditor
                label="Template"
                value={tplSrc}
                onChange={setTplSrc}
                highlight={highlightTemplateSrc}
                placeholder="Liquid and HTML"
              />
            ) : (
              <CodeEditor
                label="Data"
                value={dataSrc}
                onChange={setDataSrc}
                highlight={highlightJsonSrc}
                placeholder='{"title": "Hello"}'
              />
            )}
            {jsonError ? <ErrorText>{jsonError}</ErrorText> : null}
          </div>
        </Module>

        <section
          aria-label="Preview"
          className="flex min-w-0 flex-col min-[1200px]:h-[70vh] min-[1200px]:min-h-[420px]"
        >
          <div className="flex min-h-[28px] items-center gap-2.5 px-3 pb-3">
            <Led state={status.cls === 'error' ? 'error' : 'offline'} />
            <span
              role="status"
              className={
                status.cls === 'error'
                  ? 'hw-error hw-ink'
                  : 'hw-mono hw-ink text-sm'
              }
            >
              {status.text}
            </span>
          </div>
          <div className="min-h-0 flex-1 px-3 pb-8 min-[1200px]:overflow-y-auto">
            <PrinterEdge className="sticky top-0 -ml-3 w-[calc(100%+24px)]" />
            <PaperRoll>
              {previewUrl ? (
                <PaperSlip
                  exact
                  fed
                  tear="new"
                  src={previewUrl}
                  alt="Preview of the receipt"
                  width={previewSize?.[0]}
                  height={previewSize?.[1]}
                />
              ) : (
                <PaperSlip fed tear="new">
                  <p className="m-0 py-14 text-center text-[#4a4741]">
                    Choose a template or start typing to see it here.
                  </p>
                </PaperSlip>
              )}
            </PaperRoll>
          </div>
        </section>
      </div>

      {/* the newest prints: refreshed on the eased cadence */}
      {/* all ten rows, no inner scroll: a box of whole rows cannot hold
          rows whose thumbnails differ in height */}
      <Module number="02" title="Recent prints" flush>
        <div>
          {jobs.length ? (
            jobs.map((j, i) => (
              <Row
                key={j.id}
                className="flex-wrap items-start justify-start gap-4"
              >
                <span className="hw-thumb max-h-[86px] w-[64px]">
                  <img src={jobImageSrc(j)} loading="lazy" alt="" />
                </span>
                <span className="flex min-w-0 flex-[1_1_180px] flex-col">
                  <span className="truncate font-semibold">
                    {j.name || j.id}
                  </span>
                  <span className="hw-row-sub">
                    {j.width} × {j.height} <span className="hw-unit">px</span>
                  </span>
                </span>
                <span className="ml-auto flex shrink-0 items-center justify-end gap-x-4 pt-0.5">
                  <JobState status={j.status} alt={i % 2 === 1} />
                  <span className="hw-mono text-sm text-ink-muted">
                    {timeAgo(j.createdAt, jobsAt)}
                  </span>
                </span>
              </Row>
            ))
          ) : (
            <Row>
              <Note>No prints yet. Press Print to send one.</Note>
            </Row>
          )}
        </div>
      </Module>

      {/* toast: a live region that is always there, so it is announced */}
      <div
        role="status"
        className="pointer-events-none fixed top-4 left-1/2 z-50 -translate-x-1/2"
      >
        {toast ? (
          <div className="hw-module hw-panel px-4 py-2.5 text-sm font-semibold">
            {toast}
          </div>
        ) : null}
      </div>

      {/* new template */}
      {modalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-template-title"
            className="w-full max-w-[380px]"
          >
            <Module number="03" title="New template" id="new-template-title">
              <Field
                label="Name"
                autoFocus
                value={modalName}
                onChange={(e) => setModalName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createTemplate();
                  if (e.key === 'Escape') setModalOpen(false);
                }}
                autoComplete="off"
              />
              <KeyGroup className="self-end">
                <PushKey onClick={() => setModalOpen(false)}>Cancel</PushKey>
                <PushKey onClick={createTemplate}>Create</PushKey>
              </KeyGroup>
            </Module>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// A recent print's state: a stamp once it ended, the red LED while a
// printer holds it, red "Waiting" while it waits (red rules: printing,
// failures, waiting jobs).
function JobState({ status, alt }: { status: string; alt: boolean }) {
  if (status === 'done') return <Stamp state="printed" alt={alt} />;
  if (status === 'failed') return <Stamp state="failed" alt={alt} />;
  if (status === 'canceled') return <Stamp state="canceled" alt={alt} />;
  if (status === 'inflight') {
    return (
      <span className="flex items-center gap-2 font-semibold text-red">
        <Led state="printing" />
        Printing
      </span>
    );
  }
  return <span className="font-semibold text-red">Waiting</span>;
}
