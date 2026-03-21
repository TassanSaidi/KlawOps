import React, { useState, useEffect, useCallback, createContext } from 'react';
import type { DashboardStats, SessionInfo, SessionDetailV2, SkillAgentStats } from '../../data/types';
import { C } from './theme';
import { DashboardTab } from './tabs/DashboardTab';
import { SessionsTab } from './tabs/SessionsTab';
import { SkillsTab } from './tabs/SkillsTab';

// Re-export so existing imports from '../App' still work
export { C };

// ── Timezone context ──────────────────────────────────────────────────────────

/** IANA timezone string, e.g. 'America/New_York'. undefined = browser local. */
export const TimezoneContext = createContext<string | undefined>(undefined);

const TZ_STORAGE_KEY = 'klawops_timezone';

// Common timezones grouped by region for the selector
const TIMEZONE_OPTIONS: { label: string; zones: { value: string; label: string }[] }[] = [
  { label: 'Auto-detect', zones: [{ value: '', label: 'Browser default' }] },
  { label: 'Americas', zones: [
    { value: 'America/New_York',    label: 'Eastern (ET)' },
    { value: 'America/Chicago',     label: 'Central (CT)' },
    { value: 'America/Denver',      label: 'Mountain (MT)' },
    { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
    { value: 'America/Sao_Paulo',   label: 'Brasilia (BRT)' },
  ]},
  { label: 'Europe / Africa', zones: [
    { value: 'Europe/London',    label: 'London (GMT/BST)' },
    { value: 'Europe/Berlin',    label: 'Berlin (CET)' },
    { value: 'Europe/Moscow',    label: 'Moscow (MSK)' },
    { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST)' },
  ]},
  { label: 'Asia / Pacific', zones: [
    { value: 'Asia/Dubai',       label: 'Dubai (GST)' },
    { value: 'Asia/Kolkata',     label: 'India (IST)' },
    { value: 'Asia/Shanghai',    label: 'China (CST)' },
    { value: 'Asia/Tokyo',       label: 'Tokyo (JST)' },
    { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
    { value: 'Pacific/Auckland', label: 'Auckland (NZST)' },
  ]},
  { label: 'UTC', zones: [
    { value: 'UTC', label: 'UTC' },
  ]},
];

function TimezoneSelector({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '3px 8px', borderRadius: '4px', fontSize: '11px',
        background: C.card, color: C.muted, border: `1px solid ${C.border}`,
        cursor: 'pointer', outline: 'none',
      }}
    >
      {TIMEZONE_OPTIONS.map(group => (
        <optgroup key={group.label} label={group.label}>
          {group.zones.map(z => (
            <option key={z.value} value={z.value}>{z.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

type Tab = 'dashboard' | 'sessions' | 'skills';

const TABS: { key: Tab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'sessions',  label: 'Sessions'  },
  { key: 'skills',    label: 'Skills & Agents' },
];

function TabBar({ active, onChange, timezone, onTimezoneChange }: {
  active: Tab;
  onChange: (t: Tab) => void;
  timezone: string;
  onTimezoneChange: (tz: string) => void;
}) {
  return (
    <div style={{
      display:        'flex',
      alignItems:     'center',
      gap:            '2px',
      padding:        '8px 16px',
      borderBottom:   `1px solid ${C.border}`,
      background:     C.bg,
      position:       'sticky',
      top:            0,
      zIndex:         10,
    }}>
      {TABS.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            padding:      '5px 14px',
            borderRadius: '6px',
            fontSize:     '12px',
            fontWeight:   500,
            cursor:       'pointer',
            border:       'none',
            background:   active === t.key ? `${C.primary}22` : 'transparent',
            color:        active === t.key ? C.primary : C.muted,
            transition:   'background 0.1s, color 0.1s',
          }}
        >
          {t.label}
        </button>
      ))}
      <div style={{ marginLeft: 'auto' }}>
        <TimezoneSelector value={timezone} onChange={onTimezoneChange} />
      </div>
    </div>
  );
}

// ── VSCode API singleton ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _vsc: any = null;

// ── Standalone (HTTP) transport ───────────────────────────────────────────────

const IS_STANDALONE = !!(window as any).__KLAWOPS_STANDALONE__;

type FetchSpec = {
  url:          (msg: Record<string, unknown>) => string;
  responseType: string;
  errorType:    string;
};

const FETCH_MAP: Record<string, FetchSpec> = {
  REQUEST_STATS: {
    url:          ()  => '/api/stats',
    responseType: 'STATS_DATA',
    errorType:    'STATS_ERROR',
  },
  REQUEST_SESSION_LIST: {
    url: (m) => {
      const q = m.query  ? `&query=${encodeURIComponent(m.query as string)}` : '';
      const l = m.limit  ? `&limit=${m.limit}`   : '&limit=50';
      const o = m.offset ? `&offset=${m.offset}` : '&offset=0';
      return `/api/sessions?${q}${l}${o}`.replace('?&', '?');
    },
    responseType: 'SESSION_LIST_DATA',
    errorType:    'SESSION_LIST_ERROR',
  },
  REQUEST_SESSION_DETAIL: {
    url:          (m) => `/api/sessions/${m.sessionId}`,
    responseType: 'SESSION_DETAIL_DATA',
    errorType:    'SESSION_DETAIL_ERROR',
  },
  REQUEST_SKILLS_STATS: {
    url: (m) => {
      const tr = m.timeRange ? `timeRange=${m.timeRange}` : '';
      const f  = m.filter    ? `filter=${encodeURIComponent(m.filter as string)}` : '';
      return `/api/skills?${[tr, f].filter(Boolean).join('&')}`;
    },
    responseType: 'SKILLS_STATS_DATA',
    errorType:    'SKILLS_STATS_ERROR',
  },
  REQUEST_COST_ANALYSIS: {
    url:          (m) => `/api/sessions/${m.sessionId}/cost-analysis`,
    responseType: 'COST_ANALYSIS_DATA',
    errorType:    'COST_ANALYSIS_ERROR',
  },
};

async function standaloneRequest(msg: Record<string, unknown>): Promise<void> {
  const spec = FETCH_MAP[msg.type as string];
  if (!spec) { return; }
  try {
    const res  = await fetch(spec.url(msg));
    const data = await res.json();
    if (!res.ok) { throw new Error(data.error || `HTTP ${res.status}`); }
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: spec.responseType, payload: data },
    }));
  } catch (err) {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: spec.errorType, message: String(err) },
    }));
  }
}

export function postToExtension(msg: object): void {
  if (IS_STANDALONE) {
    standaloneRequest(msg as Record<string, unknown>);
  } else if (_vsc) {
    _vsc.postMessage(msg);
  }
}

// ── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [skillFilter, setSkillFilter] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string>(() => {
    try { return localStorage.getItem(TZ_STORAGE_KEY) || ''; } catch { return ''; }
  });

  function handleTimezoneChange(tz: string) {
    setTimezone(tz);
    try { localStorage.setItem(TZ_STORAGE_KEY, tz); } catch { /* ignore */ }
  }

  // Cached data per tab
  const [dashStats, setDashStats] = useState<DashboardStats | null>(null);
  const [dashError, setDashError] = useState<string | null>(null);

  const [sessionList, setSessionList] = useState<{ sessions: SessionInfo[]; total: number } | null>(null);
  const [sessionListError, setSessionListError] = useState<string | null>(null);

  const [sessionDetail, setSessionDetail] = useState<SessionDetailV2 | null>(null);
  const [sessionDetailError, setSessionDetailError] = useState<string | null>(null);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);

  const [skillsStats, setSkillsStats] = useState<SkillAgentStats | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const requestDashboard = useCallback(() => {
    postToExtension({ type: 'REQUEST_STATS' });
  }, []);

  const requestSessions = useCallback((query?: string, limit?: number, offset?: number) => {
    postToExtension({ type: 'REQUEST_SESSION_LIST', query, limit: limit ?? 50, offset: offset ?? 0 });
  }, []);

  const requestSessionDetail = useCallback((sessionId: string) => {
    setSessionDetailLoading(true);
    setSessionDetailError(null);
    postToExtension({ type: 'REQUEST_SESSION_DETAIL', sessionId });
  }, []);

  const requestSkillsStats = useCallback((timeRange?: string, filter?: string) => {
    postToExtension({ type: 'REQUEST_SKILLS_STATS', timeRange, filter });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _vsc = (window as any).acquireVsCodeApi?.();

    const handler = (event: MessageEvent) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = event.data as any;

      switch (msg.type) {
        case 'STATS_DATA':
          setDashStats(msg.payload);
          setDashError(null);
          break;
        case 'STATS_ERROR':
          setDashError(msg.message || 'Failed to load stats.');
          break;

        case 'SESSION_LIST_DATA':
          setSessionList(msg.payload);
          setSessionListError(null);
          break;
        case 'SESSION_LIST_ERROR':
          setSessionListError(msg.message || 'Failed to load sessions.');
          break;

        case 'SESSION_DETAIL_DATA':
          setSessionDetail(msg.payload);
          setSessionDetailLoading(false);
          setSessionDetailError(null);
          break;
        case 'SESSION_DETAIL_ERROR':
          setSessionDetailError(msg.message || 'Failed to load session.');
          setSessionDetailLoading(false);
          break;

        case 'SKILLS_STATS_DATA':
          setSkillsStats(msg.payload);
          setSkillsError(null);
          break;
        case 'SKILLS_STATS_ERROR':
          setSkillsError(msg.message || 'Failed to load skills stats.');
          break;

        case 'NAVIGATE':
          if (msg.tab) { setActiveTab(msg.tab as Tab); }
          if (msg.sessionId) { setSelectedSessionId(msg.sessionId); }
          if (msg.skillFilter !== undefined) { setSkillFilter(msg.skillFilter); }
          break;
      }
    };

    window.addEventListener('message', handler);

    // Only load dashboard on init — other tabs are lazy-loaded on first visit
    requestDashboard();

    return () => window.removeEventListener('message', handler);
  }, [requestDashboard]);

  // Lazy-load: fetch data when switching to a tab that hasn't been loaded yet
  useEffect(() => {
    if (activeTab === 'sessions' && !sessionList && !sessionListError) {
      requestSessions();
    }
    if (activeTab === 'skills' && !skillsStats && !skillsError) {
      requestSkillsStats();
    }
    // Release heavy session detail data when leaving sessions tab
    if (activeTab !== 'sessions') {
      setSessionDetail(null);
    }
  }, [activeTab, sessionList, sessionListError, skillsStats, skillsError, requestSessions, requestSkillsStats]);

  // When selected session changes, load its detail
  useEffect(() => {
    if (selectedSessionId) {
      // Clear previous detail so we show loading state
      setSessionDetail(null);
      requestSessionDetail(selectedSessionId);
    }
  }, [selectedSessionId, requestSessionDetail]);

  return (
    <TimezoneContext.Provider value={timezone || undefined}>
      <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '13px' }}>
        <TabBar active={activeTab} onChange={setActiveTab} timezone={timezone} onTimezoneChange={handleTimezoneChange} />

        {activeTab === 'dashboard' && (
          <DashboardTab
            stats={dashStats}
            error={dashError}
            onRefresh={requestDashboard}
            onOpenSession={(id) => {
              setSelectedSessionId(id);
              setActiveTab('sessions');
            }}
            onExportCsv={() => {
              if (IS_STANDALONE) {
                window.open('/api/export/csv', '_blank');
              } else {
                postToExtension({ type: 'REQUEST_CSV_EXPORT' });
              }
            }}
          />
        )}

        {activeTab === 'sessions' && (
          <SessionsTab
            list={sessionList}
            listError={sessionListError}
            detail={sessionDetail}
            detailError={sessionDetailError}
            detailLoading={sessionDetailLoading}
            selectedId={selectedSessionId}
            onSearch={requestSessions}
            onSelectSession={(id) => { setSelectedSessionId(id); }}
            onBack={() => setSelectedSessionId(null)}
            onOpenSkillsAgents={(name) => {
              setSkillFilter(name ?? null);
              setActiveTab('skills');
              requestSkillsStats(undefined, name);
            }}
          />
        )}

        {activeTab === 'skills' && (
          <SkillsTab
            stats={skillsStats}
            error={skillsError}
            initialFilter={skillFilter}
            onFilterChange={(f) => setSkillFilter(f)}
            onRequestStats={requestSkillsStats}
          />
        )}
      </div>
    </TimezoneContext.Provider>
  );
}
