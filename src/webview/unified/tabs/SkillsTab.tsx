import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import type { SkillAgentStats, SkillAgentEntry } from '../../../data/types';
import { C } from '../theme';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCost(n: number): string {
  if (n >= 1000)   { return `$${(n / 1000).toFixed(1)}K`; }
  if (n >= 1)      { return `$${n.toFixed(2)}`; }
  if (n >= 0.0001) { return `$${n.toFixed(4)}`; }
  return '$0.00';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) { return `${(n / 1_000_000_000).toFixed(1)}B`; }
  if (n >= 1_000_000)     { return `${(n / 1_000_000).toFixed(1)}M`; }
  if (n >= 1_000)         { return `${(n / 1_000).toFixed(1)}K`; }
  return n.toString();
}

function timeAgo(ts: string): string {
  if (!ts) { return '—'; }
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  { return 'just now'; }
  if (m < 60) { return `${m}m ago`; }
  const h = Math.floor(m / 60);
  if (h < 24) { return `${h}h ago`; }
  const d = Math.floor(h / 24);
  if (d < 7)  { return `${d}d ago`; }
  return `${Math.floor(d / 7)}w ago`;
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) { return '—'; }
  if (ms < 1_000)     { return `${ms}ms`; }
  const s = ms / 1_000;
  if (s < 60)  { return `${s.toFixed(1)}s`; }
  const min = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

function shortDate(ts: string): string {
  if (!ts) { return '—'; }
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Card({ title, children, style }: { title?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '14px 16px', ...style }}>
      {title && (
        <p style={{ fontSize: '11px', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '14px 16px' }}>
      <p style={{ fontSize: '11px', color: C.muted, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
      <p style={{ fontSize: '22px', fontWeight: 700, color: C.text, margin: 0 }}>{value}</p>
      {subtitle && <p style={{ fontSize: '11px', color: C.muted, margin: '2px 0 0' }}>{subtitle}</p>}
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: '999px',
      fontSize: '10px', fontWeight: 600, color, background: `${color}1a`,
      border: `1px solid ${color}40`, textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {children}
    </span>
  );
}

// ── Time range pills ──────────────────────────────────────────────────────────

type TimeRange = '7d' | '30d' | '90d' | 'all';
const TIME_RANGES: { key: TimeRange; label: string }[] = [
  { key: '7d',  label: '7 days'  },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' },
];

function TimeRangePills({ active, onChange }: { active: TimeRange; onChange: (t: TimeRange) => void }) {
  return (
    <div style={{ display: 'flex', gap: '4px' }}>
      {TIME_RANGES.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
            cursor: 'pointer', border: `1px solid ${active === t.key ? C.primary : C.border}`,
            background: active === t.key ? `${C.primary}22` : 'transparent',
            color:      active === t.key ? C.primary : C.muted,
            transition: 'background 0.1s, color 0.1s',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Stat cards row ────────────────────────────────────────────────────────────

function StatCards({ stats }: { stats: SkillAgentStats }) {
  const skillCost = stats.entries.filter(e => e.type === 'skill').reduce((s, e) => s + e.totalCost, 0);
  const agentCost = stats.entries.filter(e => e.type === 'agent').reduce((s, e) => s + e.totalCost, 0);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
      <StatCard label="Total Invocations" value={stats.totalInvocations.toLocaleString()} />
      <StatCard label="Skill Cost"  value={formatCost(skillCost)} subtitle={`${formatTokens(stats.totalSkillTokens)} tokens`} />
      <StatCard label="Agent Cost"  value={formatCost(agentCost)} subtitle={`${formatTokens(stats.totalAgentTokens)} tokens`} />
      <StatCard label="Total Cost"  value={formatCost(stats.totalCost)} subtitle={`${stats.skillCount} skills · ${stats.agentCount} agents`} />
    </div>
  );
}

// ── Cost bar chart ────────────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  background: '#1c1c1e',
  border: `1px solid ${C.border}`,
  borderRadius: '6px',
  color: C.text,
  fontSize: '12px',
};

function CostBarChart({ entries }: { entries: SkillAgentEntry[] }) {
  const top = [...entries].filter(e => e.totalCost > 0 || e.type === 'skill').slice(0, 12)
    .map(e => ({ name: e.name, cost: e.totalCost, type: e.type, label: e.name.length > 20 ? e.name.slice(0, 18) + '…' : e.name }));

  if (top.length === 0) { return null; }

  return (
    <Card title="Cost by Skill / Agent (top 12)" style={{ marginBottom: '16px' }}>
      <ResponsiveContainer width="100%" height={Math.max(180, top.length * 28)}>
        <BarChart data={top} layout="vertical" margin={{ top: 0, right: 60, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
          <XAxis type="number" dataKey="cost" tickFormatter={(v: number) => v === 0 ? '$0' : formatCost(v)} tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={130} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
          <RechartsTooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: number, _name: string, props: { payload?: { name: string; type: string } }) => [
              formatCost(value),
              props.payload?.type === 'skill' ? 'Skill (session billed)' : 'Agent cost',
            ]}
            labelFormatter={(label: string) => label}
          />
          <Bar dataKey="cost" radius={[0, 3, 3, 0]}>
            {top.map((entry, i) => (
              <Cell key={i} fill={entry.type === 'skill' ? C.primary : C.agent} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
        <span style={{ fontSize: '11px', color: C.muted, display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 10, height: 10, background: C.primary, borderRadius: 2, display: 'inline-block' }} /> Skill
        </span>
        <span style={{ fontSize: '11px', color: C.muted, display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 10, height: 10, background: C.agent, borderRadius: 2, display: 'inline-block' }} /> Agent
        </span>
      </div>
    </Card>
  );
}

// ── Sortable table ────────────────────────────────────────────────────────────

type SortKey = 'name' | 'invocations' | 'totalCost' | 'avgCost' | 'totalTokens' | 'lastUsed' | 'avgDuration' | 'sessionCount';
type SortDir = 'desc' | 'asc';

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) { return <span style={{ color: C.muted, marginLeft: 4, fontSize: 10 }}>↕</span>; }
  return <span style={{ color: C.primary, marginLeft: 4, fontSize: 10 }}>{dir === 'desc' ? '↓' : '↑'}</span>;
}

function SkillAgentTable({ entries, activeFilter, onFilterChange }: {
  entries: SkillAgentEntry[];
  activeFilter: string | null;
  onFilterChange: (f: string | null) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('totalCost');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const filtered = activeFilter
    ? entries.filter(e => e.name === activeFilter)
    : entries;

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'name')        { cmp = a.name.localeCompare(b.name); }
    if (sortKey === 'invocations') { cmp = a.invocations - b.invocations; }
    if (sortKey === 'totalCost')   { cmp = a.totalCost - b.totalCost; }
    if (sortKey === 'avgCost')     { cmp = a.avgCost - b.avgCost; }
    if (sortKey === 'totalTokens') { cmp = a.totalTokens - b.totalTokens; }
    if (sortKey === 'lastUsed')    { cmp = a.lastUsed.localeCompare(b.lastUsed); }
    if (sortKey === 'avgDuration') { cmp = (a.avgDuration || 0) - (b.avgDuration || 0); }
    if (sortKey === 'sessionCount'){ cmp = (a.sessionCount || 0) - (b.sessionCount || 0); }
    return sortDir === 'desc' ? -cmp : cmp;
  });

  function handleSort(key: SortKey) {
    if (sortKey === key) { setSortDir(d => d === 'desc' ? 'asc' : 'desc'); }
    else { setSortKey(key); setSortDir('desc'); }
  }

  const thStyle: React.CSSProperties = {
    padding: '8px 12px', fontSize: '11px', fontWeight: 600, color: C.muted, textAlign: 'left',
    textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', userSelect: 'none',
    whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}`,
  };
  const tdStyle: React.CSSProperties = {
    padding: '9px 12px', fontSize: '12px', color: C.text, borderBottom: `1px solid ${C.border}`, verticalAlign: 'middle',
  };

  const title = activeFilter
    ? `Filtered: "${activeFilter}" (${sorted.length})`
    : `All Skills & Agents (${entries.length})`;

  return (
    <Card title={title}>
      {entries.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
          No skills or agents detected yet.<br />
          <span style={{ fontSize: 11 }}>Use <code style={{ color: C.primary }}>/slash-commands</code> or Agent tools in Claude Code to get started.</span>
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thStyle} onClick={() => handleSort('name')}>Name <SortIcon active={sortKey === 'name'} dir={sortDir} /></th>
                <th style={{ ...thStyle, width: 70 }}>Type</th>
                <th style={{ ...thStyle, width: 90, textAlign: 'right' }} onClick={() => handleSort('invocations')}>Calls <SortIcon active={sortKey === 'invocations'} dir={sortDir} /></th>
                <th style={{ ...thStyle, width: 90, textAlign: 'right' }} onClick={() => handleSort('totalTokens')}>Tokens <SortIcon active={sortKey === 'totalTokens'} dir={sortDir} /></th>
                <th style={{ ...thStyle, width: 100, textAlign: 'right' }} onClick={() => handleSort('totalCost')}>Total Cost <SortIcon active={sortKey === 'totalCost'} dir={sortDir} /></th>
                <th style={{ ...thStyle, width: 90, textAlign: 'right' }} onClick={() => handleSort('avgCost')}>Avg Cost <SortIcon active={sortKey === 'avgCost'} dir={sortDir} /></th>
                <th style={{ ...thStyle, width: 80, textAlign: 'right' }} onClick={() => handleSort('sessionCount')}>Sessions <SortIcon active={sortKey === 'sessionCount'} dir={sortDir} /></th>
                <th style={{ ...thStyle, width: 90, textAlign: 'right' }} onClick={() => handleSort('avgDuration')}>Avg Time <SortIcon active={sortKey === 'avgDuration'} dir={sortDir} /></th>
                <th style={{ ...thStyle, width: 90, textAlign: 'right' }} onClick={() => handleSort('lastUsed')}>Last Used <SortIcon active={sortKey === 'lastUsed'} dir={sortDir} /></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {entry.type === 'skill' ? `/${entry.name}` : entry.name}
                    </span>
                  </td>
                  <td style={tdStyle}><Badge color={entry.type === 'skill' ? C.primary : C.agent}>{entry.type}</Badge></td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.invocations.toLocaleString()}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.muted }}>{entry.totalTokens > 0 ? formatTokens(entry.totalTokens) : '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.totalCost > 0 ? formatCost(entry.totalCost) : <span style={{ color: C.muted }}>—</span>}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.avgCost > 0 ? formatCost(entry.avgCost) : <span style={{ color: C.muted }}>—</span>}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: C.muted }}>{entry.sessionCount || '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: C.muted }}>{formatDuration(entry.avgDuration || 0)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: C.muted }}>{timeAgo(entry.lastUsed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {activeFilter && (
        <button
          onClick={() => onFilterChange(null)}
          style={{ marginTop: '10px', fontSize: '11px', color: C.primary, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          ✕ Clear filter
        </button>
      )}
    </Card>
  );
}

// ── Skill detail view (when filtered) ────────────────────────────────────────

function SkillDetailView({ entry }: { entry: SkillAgentEntry }) {
  const tdStyle: React.CSSProperties = {
    padding: '8px 12px', fontSize: '12px', color: C.text,
    borderBottom: `1px solid ${C.border}`, verticalAlign: 'middle',
  };

  return (
    <div style={{ marginBottom: '16px' }}>
      {/* Summary stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        <StatCard label="Invocations" value={entry.invocations.toLocaleString()} subtitle={`${entry.sessionCount} session${entry.sessionCount !== 1 ? 's' : ''}`} />
        <StatCard label="Avg Tokens" value={formatTokens(entry.avgTokens || 0)} subtitle={`total: ${formatTokens(entry.totalTokens)}`} />
        <StatCard label="Avg Duration" value={formatDuration(entry.avgDuration || 0)} subtitle={entry.subAgentSpawns > 0 ? `${entry.subAgentSpawns} sub-agents spawned` : undefined} />
        <StatCard label="Avg Cost" value={formatCost(entry.avgCost)} subtitle={`total: ${formatCost(entry.totalCost)}`} />
      </div>

      {/* Sub-agent breakdown */}
      {(entry.subAgentBreakdown?.length ?? 0) > 0 && (
        <Card title="Sub-Agent Breakdown" style={{ marginBottom: '16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...tdStyle, color: C.muted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Agent Type</th>
                <th style={{ ...tdStyle, color: C.muted, fontSize: 11, fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Spawns</th>
                <th style={{ ...tdStyle, color: C.muted, fontSize: 11, fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Avg Tokens</th>
                <th style={{ ...tdStyle, color: C.muted, fontSize: 11, fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {entry.subAgentBreakdown.map((sa, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  <td style={tdStyle}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{sa.type}</span></td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{sa.spawns}×</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: C.muted }}>{formatTokens(sa.avgTokens)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCost(sa.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Per-session breakdown */}
      {(entry.sessionBreakdown?.length ?? 0) > 0 && (
        <Card title={`Session Breakdown (${entry.sessionBreakdown.length})`}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...tdStyle, color: C.muted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Session</th>
                <th style={{ ...tdStyle, color: C.muted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Date</th>
                <th style={{ ...tdStyle, color: C.muted, fontSize: 11, fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Calls</th>
                <th style={{ ...tdStyle, color: C.muted, fontSize: 11, fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tokens</th>
                <th style={{ ...tdStyle, color: C.muted, fontSize: 11, fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cost</th>
                <th style={{ ...tdStyle, color: C.muted, fontSize: 11, fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {entry.sessionBreakdown.slice(0, 20).map((s, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: C.muted }}>{s.sessionId.slice(0, 8)}…</span>
                    {s.projectName && <span style={{ fontSize: 11, color: C.muted, marginLeft: 6 }}>{s.projectName}</span>}
                  </td>
                  <td style={{ ...tdStyle, color: C.muted, fontSize: 11 }}>{shortDate(s.timestamp)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{s.invocations}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: C.muted }}>{formatTokens(s.tokens)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCost(s.cost)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: C.muted }}>{formatDuration(s.duration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entry.sessionBreakdown.length > 20 && (
            <p style={{ fontSize: 11, color: C.muted, margin: '8px 0 0', textAlign: 'right' }}>
              Showing 20 of {entry.sessionBreakdown.length} sessions
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

// ── SkillsTab ─────────────────────────────────────────────────────────────────

export interface SkillsTabProps {
  stats:          SkillAgentStats | null;
  error:          string | null;
  initialFilter:  string | null;
  onFilterChange: (f: string | null) => void;
  onRequestStats: (timeRange?: string, filter?: string) => void;
}

export function SkillsTab({ stats, error, initialFilter, onFilterChange, onRequestStats }: SkillsTabProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [localFilter, setLocalFilter] = useState<string | null>(initialFilter);

  // When initialFilter changes from outside (e.g. navigating from Sessions tab), update local
  useEffect(() => {
    setLocalFilter(initialFilter);
  }, [initialFilter]);

  function handleTimeRangeChange(t: TimeRange) {
    setTimeRange(t);
    onRequestStats(t === 'all' ? undefined : t, localFilter ?? undefined);
  }

  function handleFilterChange(f: string | null) {
    setLocalFilter(f);
    onFilterChange(f);
    // Re-fetch with filter so sessionBreakdown is populated
    onRequestStats(timeRange === 'all' ? undefined : timeRange, f ?? undefined);
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ fontSize: '16px', fontWeight: 700, color: C.text, margin: '0 0 2px' }}>Skills &amp; Agents</h1>
          <p style={{ fontSize: '12px', color: C.muted, margin: 0 }}>Performance across sessions</p>
        </div>
        <TimeRangePills active={timeRange} onChange={handleTimeRangeChange} />
      </div>

      {/* Active filter breadcrumb */}
      {localFilter && (
        <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: C.muted }}>Filtered by:</span>
          <span style={{
            fontSize: '11px', padding: '3px 10px', borderRadius: '999px',
            background: `${C.primary}22`, color: C.primary,
            border: `1px solid ${C.primary}44`, fontFamily: 'monospace',
          }}>
            {localFilter}
          </span>
          <button
            onClick={() => handleFilterChange(null)}
            style={{ fontSize: '11px', color: C.muted, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <p style={{ color: '#f87171', fontSize: '13px' }}>Error: {error}</p>
      )}

      {!stats && !error && (
        <p style={{ color: C.muted, fontSize: '13px' }}>Loading…</p>
      )}

      {stats && (
        <>
          <StatCards stats={stats} />
          {/* Detail view when filtered to a specific skill/agent */}
          {localFilter && (() => {
            const entry = stats.entries.find(e => e.name === localFilter);
            return entry ? <SkillDetailView entry={entry} /> : null;
          })()}
          {!localFilter && <CostBarChart entries={stats.entries} />}
          <SkillAgentTable
            entries={stats.entries}
            activeFilter={localFilter}
            onFilterChange={handleFilterChange}
          />
        </>
      )}
    </div>
  );
}
