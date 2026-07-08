'use client';

// The Studio, rebuilt in the shell. Behavior ported from the legacy
// views/studio.html: template select + New/Save/Delete/Print toolbar,
// Template/Data editors with syntax highlighting (transparent textarea
// over a colored <pre> — see studio.css), a 400ms-debounced abortable
// /preview render onto the 624px paper roll, a recent-jobs strip that
// polls every 3s ONLY while the tab is visible, Ctrl/Cmd+S and +P, and
// the /studio?template=Name / ?new=1 URL contract the recipe pages use.

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSidebar } from '@/components/ui/sidebar';

type Template = { name: string; template: string; data?: unknown };
type Job = {
  id: string;
  status: string;
  width?: number;
  height?: number;
  createdAt: string;
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

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return 'now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const DEFAULT_TPL =
  '<div style="display:flex;flex-direction:column;width:576px;font-family:Sans;background:#fff;color:#000;padding:24px">\n  <div style="display:flex;font-size:30px;font-weight:700">{{ title }}</div>\n</div>';

// ---- the overlay code editor ----

function CodeEditor({
  value,
  onChange,
  highlight,
  placeholder,
}: {
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

  // The editors need width: entering the studio collapses the sidebar to
  // its icon rail (desktop only) and leaving restores whatever the user
  // had. The rail and the back link are the ways out.
  const { open, setOpen, isMobile } = useSidebar();
  const sidebarWasOpen = useRef(open);
  useEffect(() => {
    if (isMobile) return;
    const wasOpen = sidebarWasOpen.current;
    setOpen(false);
    return () => setOpen(wasOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [currentName, setCurrentName] = useState('');
  const [tab, setTab] = useState<'template' | 'data'>('template');
  const [tplSrc, setTplSrc] = useState('');
  const [dataSrc, setDataSrc] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [status, setStatus] = useState<{ cls: string; text: string }>({
    cls: '',
    text: 'ready',
  });
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewSize, setPreviewSize] = useState<[number, number] | null>(null);
  const [toast, setToast] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalName, setModalName] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [printing, setPrinting] = useState(false);
  const [rollScale, setRollScale] = useState(1);

  const abortRef = useRef<AbortController | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const trackingJobId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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
      setJsonError(`JSON: ${(err as Error).message}`);
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
        setStatus({ cls: '', text: 'ready' });
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
          setStatus({ cls: 'error', text: 'fix JSON to preview' });
          return;
        }
      }
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStatus({ cls: '', text: 'rendering...' });
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
            .catch(() => ({ error: 'render failed' }));
          setStatus({ cls: 'error', text: err.error || 'render failed' });
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
        setStatus({ cls: 'active', text: `${w} x ${h}px — 1-bit` });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setStatus({ cls: 'error', text: (err as Error).message });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [tplSrc, dataSrc]);

  // ---- scale the roll to fit its column ----
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () =>
      setRollScale(Math.min(1, (el.clientWidth - 32) / 624));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- recent jobs: poll every 3s while the tab is visible ----
  const refreshJobs = useCallback(async () => {
    try {
      const resp = await fetch('/jobs?limit=10');
      if (!resp.ok) return;
      const list: Job[] = await resp.json();
      setJobs(list);
      if (trackingJobId.current) {
        const tracked = list.find((j) => j.id === trackingJobId.current);
        if (tracked?.status === 'done') {
          showToast(`${trackingJobId.current} printed`);
          trackingJobId.current = null;
        } else if (tracked?.status === 'failed') {
          showToast(`${trackingJobId.current} failed`);
          trackingJobId.current = null;
        }
      }
    } catch {
      // server hiccup — keep the last list
    }
  }, []);

  useEffect(() => {
    refreshJobs();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refreshJobs();
    }, 3000);
    return () => clearInterval(t);
  }, [refreshJobs]);

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
    if (data === null) return showToast('Fix JSON before saving');
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
    if (data === null) return showToast('Fix JSON before printing');
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
        showToast(`Queued ${body.id} — ${body.width}x${body.height}px`);
        refreshJobs();
      } else {
        showToast(body.error || 'Queue failed');
      }
    } catch (err) {
      showToast(`Queue failed: ${(err as Error).message}`);
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

  const isMac =
    typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

  const btnCls = 'h-auto px-2.5 py-1 text-xs font-normal';

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border-[0.5px] border-border bg-raised px-4 py-3">
        <select
          value={currentName}
          onChange={(e) => loadTemplate(templates, e.target.value)}
          className="min-w-[160px] rounded-md border-[0.5px] border-border bg-page px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-ink-faint"
        >
          {templates.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          className={btnCls}
          onClick={() => {
            setModalName('');
            setModalOpen(true);
          }}
        >
          New
        </Button>
        <Button variant="outline" size="sm" className={btnCls} onClick={save}>
          Save
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={btnCls}
          onClick={doDelete}
        >
          Delete
        </Button>
        <div className="grow" />
        <Button
          variant="outline"
          size="sm"
          className={btnCls}
          onClick={print}
          disabled={printing}
        >
          {printing ? 'Queuing...' : 'Print'}
        </Button>
        <span className="text-xs text-ink-faint">
          {isMac ? '⌘S save · ⌘P print' : 'Ctrl+S save · Ctrl+P print'}
        </span>
      </div>

      {/* editors get the wider column: template HTML lines are long */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* editors */}
        <div className="flex h-[70vh] min-h-[420px] flex-col overflow-hidden rounded-md border-[0.5px] border-border bg-raised">
          <div className="flex border-b-[0.5px] border-b-hairline">
            {(['template', 'data'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`border-b-[1.5px] px-3.5 py-2 text-xs ${tab === t ? 'border-b-red text-ink' : 'border-b-transparent text-ink-faint hover:text-ink-muted'}`}
              >
                {t === 'template' ? 'Template' : 'Data (JSON)'}
              </button>
            ))}
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col">
            {tab === 'template' ? (
              <CodeEditor
                value={tplSrc}
                onChange={setTplSrc}
                highlight={highlightTemplateSrc}
                placeholder="Liquid + HTML template..."
              />
            ) : (
              <CodeEditor
                value={dataSrc}
                onChange={setDataSrc}
                highlight={highlightJsonSrc}
                placeholder='{"key": "value"}'
              />
            )}
            {jsonError ? (
              <div className="border-t-[0.5px] border-t-hairline px-3.5 py-1 text-xs text-red">
                {jsonError}
              </div>
            ) : null}
          </div>
        </div>

        {/* stage */}
        <div className="flex h-[70vh] min-h-[420px] flex-col overflow-hidden rounded-md border-[0.5px] border-border bg-raised">
          <div className="flex items-center gap-2.5 border-b-[0.5px] border-b-hairline px-4 py-2.5 font-mono text-xs text-ink-muted">
            <span
              className={`h-1.5 w-1.5 rounded-full ${status.cls === 'error' ? 'bg-red' : status.cls === 'active' ? 'bg-ink' : 'bg-ink-faint'}`}
            />
            <span>{status.text}</span>
          </div>
          <div
            ref={scrollRef}
            className="flex flex-1 justify-center overflow-auto bg-page px-4 pt-6 pb-14"
          >
            <div
              className="relative h-fit w-[624px] shrink-0 border-[0.5px] border-border bg-white px-6"
              style={{
                transform: `scale(${rollScale})`,
                transformOrigin: 'top center',
              }}
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="preview"
                  width={previewSize?.[0]}
                  height={previewSize?.[1]}
                  className="block w-full [image-rendering:pixelated]"
                />
              ) : (
                <div className="px-5 py-10 text-center text-xs text-ink-faint">
                  Select a template or start typing to see a preview
                </div>
              )}
            </div>
          </div>
          {/* recent jobs */}
          <div className="max-h-[150px] overflow-y-auto border-t-[0.5px] border-t-border">
            <div className="sticky top-0 border-b-[0.5px] border-b-hairline bg-raised px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ink-faint">
              Recent jobs
            </div>
            {jobs.length ? (
              jobs.map((j) => (
                <div
                  key={j.id}
                  className="flex items-center gap-2.5 border-b-[0.5px] border-b-hairline px-4 py-1.5 font-mono text-xs last:border-b-0"
                >
                  <img
                    src={`/jobs?png=${j.id}`}
                    loading="lazy"
                    alt=""
                    className="w-8 shrink-0 rounded-[2px] border-[0.5px] border-border bg-white [image-rendering:pixelated]"
                  />
                  <span className="min-w-[56px] text-ink">{j.id}</span>
                  <span className="text-ink-faint">
                    {j.width}x{j.height}
                  </span>
                  <span
                    className={`min-w-[60px] ${j.status === 'inflight' || j.status === 'failed' ? 'text-red' : j.status === 'done' ? 'text-ink-faint' : 'text-ink-muted'}`}
                  >
                    {j.status === 'inflight' ? 'printing' : j.status}
                  </span>
                  <span className="ml-auto text-ink-faint">
                    {timeAgo(j.createdAt)}
                  </span>
                </div>
              ))
            ) : (
              <div className="px-4 py-2 font-mono text-xs text-ink-faint">
                No jobs yet — hit Print to queue one
              </div>
            )}
          </div>
        </div>
      </div>

      {/* toast */}
      {toast ? (
        <div className="fixed top-3.5 left-1/2 z-50 -translate-x-1/2 rounded-md border-[0.5px] border-border bg-raised px-4 py-2 text-xs text-ink">
          {toast}
        </div>
      ) : null}

      {/* new-template modal */}
      {modalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35">
          <div className="w-80 rounded-md border-[0.5px] border-border bg-raised p-5">
            <h3 className="mb-3 text-[13px] font-medium text-ink">
              New template
            </h3>
            <Input
              autoFocus
              value={modalName}
              onChange={(e) => setModalName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createTemplate();
                if (e.key === 'Escape') setModalOpen(false);
              }}
              placeholder="Template name"
              className="font-mono text-xs"
            />
            <div className="mt-3.5 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className={btnCls}
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={btnCls}
                onClick={createTemplate}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
