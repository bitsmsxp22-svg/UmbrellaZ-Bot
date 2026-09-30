/** Conexão única (SSE) com o servidor, compartilhada por todos os scripts da página. */
type Handler = (data: any) => void;
type Handlers = Partial<Record<'status' | 'log' | 'logs' | 'research' | 'history' | 'connection', Handler>>;

const listeners: Handlers[] = [];
let source: EventSource | null = null;

function connect(): void {
  source = new EventSource('/api/events');
  for (const name of ['status', 'log', 'logs', 'research', 'history'] as const) {
    source.addEventListener(name, (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      for (const l of listeners) l[name]?.(data);
    });
  }
  source.onopen = () => listeners.forEach((l) => l.connection?.(true));
  source.onerror = () => listeners.forEach((l) => l.connection?.(false));
}

export function live(handlers: Handlers): void {
  listeners.push(handlers);
  if (!source) connect();
}

export async function post<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function toast(message: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 5000);
}

export const STAGE_TONE: Record<string, string> = {
  idle: 'muted',
  finished: 'ok',
  starting: 'info',
  research: 'info',
  prompts: 'info',
  generating: 'run',
  upscaling: 'run',
  csv: 'run',
  uploading: 'run',
  cleanup: 'run',
  waiting: 'wait',
  cooldown: 'wait',
  stopping: 'wait',
  login: 'error',
  error: 'error',
};
