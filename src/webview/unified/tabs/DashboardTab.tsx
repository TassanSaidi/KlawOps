import React, { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { format, parseISO, subWeeks, startOfWeek, addDays } from 'date-fns';
import type { DashboardStats, DailyActivity } from '../../../data/types';
import { C } from '../theme';
import { formatTokens, formatCost, formatDuration, timeAgo, getModelDisplayName, getModelColor } from '../format';

// ── Primitives ────────────────────────────────────────────────────────────────

function Card({ title, children, style }: {
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
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

// ── UsageOverTime ─────────────────────────────────────────────────────────────

type MetricKey = 'messageCount' | 'sessionCount' | 'toolCallCount';

const metricDefs: { key: MetricKey; label: string; color: string }[] = [
  { key: 'messageCount',  label: 'Messages',   color: C.primary },
  { key: 'sessionCount',  label: 'Sessions',   color: C.blue },
  { key: 'toolCallCount', label: 'Tool Calls', color: C.green },
];

function UsageOverTime({ data }: { data: DailyActivity[] }) {
  const [activeMetric, setActiveMetric] = useState<MetricKey>('messageCount');
  const chartData = data.map(d => ({ ...d, dateLabel: format(parseISO(d.date), 'MMM d') }));
  const active = metricDefs.find(m => m.key === activeMetric)!;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ fontSize: '11px', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
          Usage Over Time
        </p>
        <div style={{ display: 'flex', gap: '4px' }}>
          {metricDefs.map(m => (
            <button key={m.key} onClick={() => setActiveMetric(m.key)} style={{
              padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', border: 'none',
              background: activeMetric === m.key ? `${m.color}22` : 'transparent',
              color:      activeMetric === m.key ? m.color : C.muted,
            }}>{m.label}</button>
          ))}
        </div>
      </div>
      <div style={{ height: '240px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${activeMetric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={active.color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={active.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="dateLabel" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
            <RechartsTooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '12px', color: C.text }} />
            <Area type="monotone" dataKey={activeMetric} stroke={active.color} strokeWidth={2} fill={`url(#grad-${activeMetric})`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ── ModelBreakdown ────────────────────────────────────────────────────────────

function ModelBreakdown({ data }: { data: DashboardStats['modelUsage'] }) {
  const chartData = Object.entries(data).map(([model, usage]) => ({
    name:   getModelDisplayName(model),
    model,
    tokens: usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens,
    cost:   usage.estimatedCost,
    color:  getModelColor(model),
  }));
  const totalTokens = chartData.reduce((s, d) => s + d.tokens, 0);

  return (
    <Card>
      <p style={{ fontSize: '11px', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>
        Model Usage
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ width: '140px', height: '140px', flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={chartData} cx="50%" cy="50%" innerRadius={42} outerRadius={62} dataKey="tokens" strokeWidth={2} stroke={C.card}>
                {chartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <RechartsTooltip
                formatter={(v: number | undefined) => formatTokens(v ?? 0)}
                contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '12px', color: C.text }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {chartData.map(item => (
            <div key={item.model}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: item.color }} />
                  <span style={{ fontSize: '12px', fontWeight: 500, color: C.text }}>{item.name}</span>
                </div>
                <span style={{ fontSize: '12px', fontWeight: 600, color: C.text }}>${item.cost.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                <span style={{ fontSize: '11px', color: C.muted }}>{formatTokens(item.tokens)} tokens</span>
                <span style={{ fontSize: '11px', color: C.muted }}>
                  {totalTokens > 0 ? ((item.tokens / totalTokens) * 100).toFixed(0) : 0}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ── ActivityHeatmap ───────────────────────────────────────────────────────────

function ActivityHeatmap({ data }: { data: DailyActivity[] }) {
  const activityMap = new Map(data.map(d => [d.date, d.messageCount]));
  const maxMessages = Math.max(...data.map(d => d.messageCount), 1);
  const today = new Date();
  const startDate = startOfWeek(subWeeks(today, 23), { weekStartsOn: 0 });
  const weeks: Date[][] = [];
  let cur = startDate;
  for (let w = 0; w < 24; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) { week.push(cur); cur = addDays(cur, 1); }
    weeks.push(week);
  }
  function cellColor(count: number): string {
    if (count === 0) { return C.mutedDark; }
    const r = count / maxMessages;
    if (r < 0.25) { return `${C.primary}44`; }
    if (r < 0.5)  { return `${C.primary}77`; }
    if (r < 0.75) { return `${C.primary}bb`; }
    return C.primary;
  }
  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  return (
    <Card>
      <p style={{ fontSize: '11px', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>Activity</p>
      <div style={{ display: 'flex', gap: '4px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingRight: '4px' }}>
          {dayLabels.map((label, i) => (
            <div key={i} style={{ height: '13px', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', color: C.muted }}>{label}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {week.map((day, di) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const count = activityMap.get(dateStr) || 0;
                const isFuture = day > today;
                return (
                  <div key={di} title={`${format(day, 'MMM d, yyyy')}: ${count} messages`} style={{
                    width: '13px', height: '13px', borderRadius: '3px',
                    background: isFuture ? 'transparent' : cellColor(count),
                  }} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
        <span style={{ fontSize: '10px', color: C.muted }}>Less</span>
        {[C.mutedDark, `${C.primary}44`, `${C.primary}77`, `${C.primary}bb`, C.primary].map((bg, i) => (
          <div key={i} style={{ width: '10px', height: '10px', borderRadius: '2px', background: bg }} />
        ))}
        <span style={{ fontSize: '10px', color: C.muted }}>More</span>
      </div>
    </Card>
  );
}

// ── PeakHours ─────────────────────────────────────────────────────────────────

function PeakHours({ data }: { data: Record<string, number> }) {
  const chartData = Array.from({ length: 24 }, (_, i) => ({
    hour:  i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i - 12}p`,
    count: data[i.toString().padStart(2, '0')] || data[i.toString()] || 0,
  }));
  return (
    <Card>
      <p style={{ fontSize: '11px', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>Peak Hours</p>
      <div style={{ height: '160px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="hour" tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} interval={2} />
            <YAxis tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} />
            <RechartsTooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '12px', color: C.text }} />
            <Bar dataKey="count" fill={C.primary} radius={[3, 3, 0, 0]} opacity={0.8} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ── RecentSessions ────────────────────────────────────────────────────────────

function RecentSessions({ sessions, onOpenSession }: {
  sessions: DashboardStats['recentSessions'];
  onOpenSession: (id: string) => void;
}) {
  return (
    <Card>
      <p style={{ fontSize: '11px', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>Recent Sessions</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {sessions.map(session => (
          <button key={session.id} onClick={() => onOpenSession(session.id)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', borderRadius: '6px', border: `1px solid ${C.border}`,
            background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = `${C.mutedDark}55`)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                <span style={{ fontSize: '12px', fontWeight: 500, color: C.text }}>{session.projectName}</span>
                {(session.models || []).map(m => (
                  <span key={m} style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', background: C.mutedDark, color: C.muted, fontFamily: 'monospace' }}>{m}</span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: C.muted }}>
                {session.gitBranch && <span>⎇ {session.gitBranch}</span>}
                <span>{formatDuration(session.duration)}</span>
                <span>{session.messageCount} messages</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '12px', fontWeight: 500, color: C.text, margin: 0 }}>{formatCost(session.estimatedCost)}</p>
              <p style={{ fontSize: '10px', color: C.muted, margin: '2px 0 0' }}>{timeAgo(session.timestamp)}</p>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

// ── Loading / Error ───────────────────────────────────────────────────────────

function Loading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: '12px' }}>
      <div style={{ width: '24px', height: '24px', borderRadius: '50%', border: `2px solid ${C.border}`, borderTopColor: C.primary, animation: 'spin 0.8s linear infinite' }} />
      <p style={{ color: C.muted, fontSize: '12px' }}>Loading dashboard…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── DashboardTab ──────────────────────────────────────────────────────────────

export function DashboardTab({ stats, error, onRefresh, onOpenSession, onExportCsv }: {
  stats: DashboardStats | null;
  error: string | null;
  onRefresh: () => void;
  onOpenSession: (id: string) => void;
  onExportCsv?: () => void;
}) {
  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: '12px' }}>
        <p style={{ color: C.muted, fontSize: '13px' }}>{error}</p>
        <button onClick={onRefresh} style={{ padding: '6px 14px', borderRadius: '6px', border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer', fontSize: '12px' }}>Retry</button>
      </div>
    );
  }
  if (!stats) { return <Loading />; }

  const modelData = stats.modelUsage || {};
  const hasModels = Object.keys(modelData).length > 0;

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '16px', fontWeight: 700, color: C.text, margin: '0 0 4px' }}>Overview</h1>
          <p style={{ fontSize: '12px', color: C.muted, margin: 0 }}>Your Claude Code usage at a glance</p>
        </div>
        {onExportCsv && (
          <button
            onClick={onExportCsv}
            style={{
              padding: '5px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
              cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent',
              color: C.muted, display: 'flex', alignItems: 'center', gap: '4px',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = C.text)}
            onMouseLeave={e => (e.currentTarget.style.color = C.muted)}
          >
            Export CSV
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        <StatCard label="Total Sessions"  value={stats.totalSessions.toLocaleString()} subtitle={`across ${stats.projectCount} projects`} />
        <StatCard label="Total Messages"  value={stats.totalMessages.toLocaleString()} />
        <StatCard label="Total Tokens"    value={formatTokens(stats.totalTokens)} />
        <StatCard label="Estimated Cost"  value={formatCost(stats.estimatedCost)} subtitle="based on API pricing" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: hasModels ? '2fr 1fr' : '1fr', gap: '12px', marginBottom: '12px' }}>
        <UsageOverTime data={stats.dailyActivity || []} />
        {hasModels && <ModelBreakdown data={modelData} />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', marginBottom: '16px' }}>
        <ActivityHeatmap data={stats.dailyActivity || []} />
        <PeakHours data={stats.hourCounts || {}} />
      </div>

      {(stats.recentSessions || []).length > 0 && (
        <RecentSessions sessions={stats.recentSessions} onOpenSession={onOpenSession} />
      )}
    </div>
  );
}
