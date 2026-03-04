import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import type { SkillAgentStats, SkillAgentEntry } from '../../data/types';

// ── Theme ─────────────────────────────────────────────────────────────────────

const C = {
  bg:      '#09090b',
  card:    '#18181b',
  border:  '#27272a',
  text:    '#fafafa',
  muted:   '#71717a',
  primary: '#D4764E',
  agent:   '#6366f1',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCost(n: number): string {
  if (n >= 1000) { return `$${(n / 1000).toFixed(1)}K`; }
  if (n >= 1)    { return `$${n.toFixed(2)}`; }
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
  if (m < 1)   { return 'just now'; }
  if (m < 60)  { return `${m}m ago`; }
  const h = Math.floor(m / 60);
  if (h < 24)  { return `${h}h ago`; }
  const d = Math.floor(h / 24);
  if (d < 7)   { return `${d}d ago`; }
  return `${Math.floor(d / 7)}w ago`;
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Card({ title, children, style }: {
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '8px',
      padding: '14px 16px',
      ...style,
    }}>
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
      display: 'inline-block',
      padding: '1px 7px',
      borderRadius: '999px',
      fontSize: '10px',
      fontWeight: 600,
      color,
      background: `${color}1a`,
      border: `1px solid ${color}40`,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    }}>
      {children}
    </span>
  );
}

// ── Stat Cards ────────────────────────────────────────────────────────────────

function StatCards({ stats }: { stats: SkillAgentStats }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
      <StatCard label="Total Invocations" value={stats.totalInvocations.toLocaleString()} />
      <StatCard label="Skill Cost"  value={formatCost(stats.entries.filter(e => e.type === 'skill').reduce((s, e) => s + e.totalCost, 0))} subtitle={`${formatTokens(stats.totalSkillTokens)} tokens`} />
      <StatCard label="Agent Cost"  value={formatCost(stats.entries.filter(e => e.type === 'agent').reduce((s, e) => s + e.totalCost, 0))} subtitle={`${formatTokens(stats.totalAgentTokens)} tokens`} />
      <StatCard label="Total Cost"  value={formatCost(stats.totalCost)} subtitle={`${stats.skillCount} skills · ${stats.agentCount} agents`} />
    </div>
  );
}

// ── Cost Bar Chart ────────────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  background: '#1c1c1e',
  border: `1px solid ${C.border}`,
  borderRadius: '6px',
  color: C.text,
  fontSize: '12px',
};

function CostBarChart({ entries }: { entries: SkillAgentEntry[] }) {
  const top = [...entries]
    .filter(e => e.totalCost > 0 || e.type === 'skill')
    .slice(0, 12)
    .map(e => ({ name: e.name, cost: e.totalCost, type: e.type }));

  if (top.length === 0) {
    return null;
  }

  // Shorten long names for axis
  const chartData = top.map(e => ({
    ...e,
    label: e.name.length > 20 ? e.name.slice(0, 18) + '…' : e.name,
  }));

  return (
    <Card title="Cost by Skill / Agent (top 12)" style={{ marginBottom: '16px' }}>
      <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 28)}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 60, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
          <XAxis
            type="number"
            dataKey="cost"
            tickFormatter={(v: number) => v === 0 ? '$0' : formatCost(v)}
            tick={{ fill: C.muted, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={130}
            tick={{ fill: C.muted, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <RechartsTooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: number, _name: string, props: { payload?: { name: string; type: string } }) => [
              formatCost(value),
              props.payload?.type === 'skill' ? 'Skill (session billed)' : 'Agent cost',
            ]}
            labelFormatter={(label: string) => label}
          />
          <Bar dataKey="cost" radius={[0, 3, 3, 0]}>
            {chartData.map((entry, i) => (
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
        <span style={{ fontSize: '11px', color: C.muted }}>
          Skill cost = parent session tokens during invocation · Agent cost = subagent JSONL tokens
        </span>
      </div>
    </Card>
  );
}

// ── Sortable Table ────────────────────────────────────────────────────────────

type SortKey = 'name' | 'invocations' | 'totalCost' | 'avgCost' | 'totalTokens' | 'lastUsed';
type SortDir = 'desc' | 'asc';

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return <span style={{ color: C.muted, marginLeft: 4, fontSize: 10 }}>↕</span>;
  }
  return <span style={{ color: C.primary, marginLeft: 4, fontSize: 10 }}>{dir === 'desc' ? '↓' : '↑'}</span>;
}

function SkillAgentTable({ entries }: { entries: SkillAgentEntry[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('totalCost');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = [...entries].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'name')        { cmp = a.name.localeCompare(b.name); }
    if (sortKey === 'invocations') { cmp = a.invocations - b.invocations; }
    if (sortKey === 'totalCost')   { cmp = a.totalCost - b.totalCost; }
    if (sortKey === 'avgCost')     { cmp = a.avgCost - b.avgCost; }
    if (sortKey === 'totalTokens') { cmp = a.totalTokens - b.totalTokens; }
    if (sortKey === 'lastUsed')    { cmp = a.lastUsed.localeCompare(b.lastUsed); }
    return sortDir === 'desc' ? -cmp : cmp;
  });

  const thStyle: React.CSSProperties = {
    padding: '8px 12px',
    fontSize: '11px',
    fontWeight: 600,
    color: C.muted,
    textAlign: 'left',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${C.border}`,
  };

  const tdStyle: React.CSSProperties = {
    padding: '9px 12px',
    fontSize: '12px',
    color: C.text,
    borderBottom: `1px solid ${C.border}`,
    verticalAlign: 'middle',
  };

  return (
    <Card title={`All Skills & Agents (${entries.length})`}>
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
                <th style={thStyle} onClick={() => handleSort('name')}>
                  Name <SortIcon active={sortKey === 'name'} dir={sortDir} />
                </th>
                <th style={{ ...thStyle, width: 70 }}>Type</th>
                <th style={{ ...thStyle, width: 90, textAlign: 'right' }} onClick={() => handleSort('invocations')}>
                  Calls <SortIcon active={sortKey === 'invocations'} dir={sortDir} />
                </th>
                <th style={{ ...thStyle, width: 90, textAlign: 'right' }} onClick={() => handleSort('totalTokens')}>
                  Tokens <SortIcon active={sortKey === 'totalTokens'} dir={sortDir} />
                </th>
                <th style={{ ...thStyle, width: 100, textAlign: 'right' }} onClick={() => handleSort('totalCost')}>
                  Total Cost <SortIcon active={sortKey === 'totalCost'} dir={sortDir} />
                </th>
                <th style={{ ...thStyle, width: 90, textAlign: 'right' }} onClick={() => handleSort('avgCost')}>
                  Avg Cost <SortIcon active={sortKey === 'avgCost'} dir={sortDir} />
                </th>
                <th style={{ ...thStyle, width: 90, textAlign: 'right' }} onClick={() => handleSort('lastUsed')}>
                  Last Used <SortIcon active={sortKey === 'lastUsed'} dir={sortDir} />
                </th>
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
                  <td style={tdStyle}>
                    <Badge color={entry.type === 'skill' ? C.primary : C.agent}>
                      {entry.type}
                    </Badge>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {entry.invocations.toLocaleString()}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.muted }}>
                    {entry.totalTokens > 0 ? formatTokens(entry.totalTokens) : '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {entry.totalCost > 0 ? formatCost(entry.totalCost) : <span style={{ color: C.muted }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {entry.avgCost > 0 ? formatCost(entry.avgCost) : <span style={{ color: C.muted }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: C.muted }}>
                    {timeAgo(entry.lastUsed)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

type AppState =
  | { status: 'loading' }
  | { status: 'loaded'; stats: SkillAgentStats }
  | { status: 'error'; message: string };

export function App() {
  const [state, setState] = useState<AppState>({ status: 'loading' });

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vscode = (window as any).acquireVsCodeApi?.();
    const handler = (event: MessageEvent) => {
      const msg = event.data as { type: string; payload?: SkillAgentStats; message?: string };
      if (msg.type === 'SKILLS_STATS_DATA' && msg.payload) {
        setState({ status: 'loaded', stats: msg.payload });
      }
      if (msg.type === 'SKILLS_STATS_ERROR') {
        setState({ status: 'error', message: msg.message || 'Unknown error' });
      }
    };
    window.addEventListener('message', handler);
    vscode?.postMessage({ type: 'REQUEST_SKILLS_STATS' });
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif', color: C.text, minHeight: '100vh', background: C.bg, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Skills &amp; Agents</h2>
        <span style={{ fontSize: 12, color: C.muted }}>performance across all sessions</span>
      </div>

      {state.status === 'loading' && (
        <p style={{ color: C.muted }}>Loading…</p>
      )}

      {state.status === 'error' && (
        <p style={{ color: '#f87171' }}>Error: {state.message}</p>
      )}

      {state.status === 'loaded' && (
        <>
          <StatCards stats={state.stats} />
          <CostBarChart entries={state.stats.entries} />
          <SkillAgentTable entries={state.stats.entries} />
        </>
      )}
    </div>
  );
}
