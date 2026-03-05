import { C } from './theme';

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) { return `${(n / 1_000_000_000).toFixed(1)}B`; }
  if (n >= 1_000_000)     { return `${(n / 1_000_000).toFixed(1)}M`; }
  if (n >= 1_000)         { return `${(n / 1_000).toFixed(1)}K`; }
  return n.toString();
}

export function formatCost(n: number): string {
  if (n >= 1000)   { return `$${(n / 1000).toFixed(1)}K`; }
  if (n >= 1)      { return `$${n.toFixed(2)}`; }
  if (n >= 0.0001) { return `$${n.toFixed(4)}`; }
  return '$0.00';
}

export function formatDuration(ms: number): string {
  if (ms <= 0) { return '0m'; }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) { return `${h}h ${m}m`; }
  return `${m}m`;
}

export function formatDurationDetailed(ms: number): string {
  if (!ms || ms <= 0) { return '—'; }
  if (ms < 1_000)     { return `${ms}ms`; }
  const s = ms / 1_000;
  if (s < 60)  { return `${s.toFixed(1)}s`; }
  const min = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

export function timeAgo(ts: string): string {
  if (!ts) { return '—'; }
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)   { return 'just now'; }
  if (m < 60)  { return `${m}m ago`; }
  const h = Math.floor(m / 60);
  if (h < 24)  { return `${h}h ago`; }
  const d = Math.floor(h / 24);
  if (d < 7)   { return `${d}d ago`; }
  return `${Math.floor(d / 7)}w ago`;
}

/** Format a timestamp to local time (HH:MM:SS AM/PM), using the given IANA timezone if provided. */
export function formatTime(ts: string, timezone?: string): string {
  if (!ts) { return ''; }
  const d = new Date(ts);
  if (timezone) {
    try {
      return d.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    } catch { /* fall through to local */ }
  }
  const h    = d.getHours();
  const min  = d.getMinutes().toString().padStart(2, '0');
  const s    = d.getSeconds().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${min}:${s} ${ampm}`;
}

/** Format a timestamp to short date (M/D HH:MM), using the given IANA timezone if provided. */
export function shortDate(ts: string, timezone?: string): string {
  if (!ts) { return '—'; }
  const d = new Date(ts);
  if (timezone) {
    try {
      return d.toLocaleString('en-US', { timeZone: timezone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { /* fall through */ }
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

export function getModelDisplayName(modelId: string): string {
  if (modelId.includes('opus'))   { return 'Opus'; }
  if (modelId.includes('sonnet')) { return 'Sonnet'; }
  if (modelId.includes('haiku'))  { return 'Haiku'; }
  return modelId;
}

export function getModelColor(modelId: string): string {
  if (modelId.includes('opus'))   { return C.primary; }
  if (modelId.includes('sonnet')) { return C.blue; }
  if (modelId.includes('haiku'))  { return C.green; }
  return '#888888';
}

export function modelColor(model: string | undefined): string {
  if (!model) { return C.muted; }
  if (model.toLowerCase().includes('opus'))   { return C.primary; }
  if (model.toLowerCase().includes('sonnet')) { return C.blue; }
  return C.green;
}
