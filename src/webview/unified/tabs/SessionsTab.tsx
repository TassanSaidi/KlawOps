import React, { useState, useEffect, useRef } from 'react';
import type { SessionInfo, SessionDetailV2 } from '../../../data/types';
import { C } from '../theme';
import { AgentTreeGraph } from '../components/AgentTreeGraph';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(1)}M`; }
  if (n >= 1_000)     { return `${(n / 1_000).toFixed(1)}K`; }
  return n.toString();
}

function formatCost(n: number): string {
  if (n >= 1000) { return `$${(n / 1000).toFixed(1)}K`; }
  if (n >= 1)    { return `$${n.toFixed(2)}`; }
  if (n >= 0.0001) { return `$${n.toFixed(4)}`; }
  return '$0.00';
}

function formatDuration(ms: number): string {
  if (ms <= 0) { return '0m'; }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) { return `${h}h ${m}m`; }
  return `${m}m`;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60)  { return `${m}m ago`; }
  const h = Math.floor(m / 60);
  if (h < 24)  { return `${h}h ago`; }
  return `${Math.floor(h / 24)}d ago`;
}

function formatTime(ts: string): string {
  if (!ts) { return ''; }
  const d    = new Date(ts);
  const h    = d.getHours();
  const min  = d.getMinutes().toString().padStart(2, '0');
  const s    = d.getSeconds().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${min}:${s} ${ampm}`;
}

function modelColor(model: string | undefined): string {
  if (!model) { return C.muted; }
  if (model.toLowerCase().includes('opus'))   { return C.primary; }
  if (model.toLowerCase().includes('sonnet')) { return C.blue; }
  return C.green;
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Card({ title, children, accent }: { title?: string; children: React.ReactNode; accent?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${accent ?? C.border}`, borderRadius: '8px', padding: '14px 16px' }}>
      {title && (
        <p style={{ fontSize: '11px', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${accent ?? C.border}`, borderRadius: '8px', padding: '12px 14px', textAlign: 'center' }}>
      <p style={{ fontSize: '18px', fontWeight: 700, color: accent ? accent : C.text, margin: 0 }}>{value}</p>
      <p style={{ fontSize: '10px', color: C.muted, marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
    </div>
  );
}

function Badge({ text, color }: { text: string; color?: string }) {
  return (
    <span style={{
      fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
      background: C.mutedDark, color: color ?? C.muted, fontFamily: 'monospace', whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  );
}

// ── MessageItem ───────────────────────────────────────────────────────────────

const MSG_LIMIT = 500;

function MessageItem({ msg }: { msg: SessionDetailV2['messages'][number] }) {
  const [expanded, setExpanded] = useState(false);
  const isUser      = msg.role === 'user';
  const isTruncated = msg.content.length > MSG_LIMIT;
  const content     = expanded || !isTruncated ? msg.content : msg.content.slice(0, MSG_LIMIT) + '…';
  const tokens      = msg.usage ? msg.usage.input_tokens + msg.usage.output_tokens : 0;

  return (
    <div style={{ display: 'flex', gap: '10px' }}>
      <div style={{
        width: '28px', height: '28px', borderRadius: '6px', flexShrink: 0,
        background: isUser ? `${C.primary}18` : C.mutedDark,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '11px', fontWeight: 700, color: isUser ? C.primary : C.muted,
      }}>
        {isUser ? 'U' : 'C'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: C.text }}>{isUser ? 'You' : 'Claude'}</span>
          <span style={{ fontSize: '10px', color: C.muted }}>{formatTime(msg.timestamp)}</span>
          {!isUser && msg.model && (
            <Badge text={msg.model.includes('opus') ? 'Opus' : msg.model.includes('sonnet') ? 'Sonnet' : 'Haiku'} color={modelColor(msg.model)} />
          )}
          {!isUser && tokens > 0 && (
            <span style={{ fontSize: '10px', color: C.muted }}>{formatTokens(tokens)} tok</span>
          )}
        </div>
        <p style={{ fontSize: '12px', color: '#d4d4d8', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.6' }}>
          {content}
        </p>
        {isTruncated && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ fontSize: '10px', color: C.primary, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginTop: '2px' }}
          >
            {expanded ? '▲ Show less' : `▼ Show ${(msg.content.length - MSG_LIMIT).toLocaleString()} more chars`}
          </button>
        )}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
            {msg.toolCalls.map((t, i) => (
              <span key={i} style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', border: `1px solid ${C.border}`, color: C.muted, fontFamily: 'monospace' }}>
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Session detail sidebar cards ──────────────────────────────────────────────

function TokenBreakdown({ session }: { session: SessionDetailV2 }) {
  const rows = [
    { label: 'Input',       value: session.totalInputTokens },
    { label: 'Output',      value: session.totalOutputTokens },
    { label: 'Cache Read',  value: session.totalCacheReadTokens },
    { label: 'Cache Write', value: session.totalCacheWriteTokens },
  ];
  return (
    <Card title="Token Breakdown">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {rows.map(r => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', color: C.muted }}>{r.label}</span>
            <span style={{ fontSize: '11px', color: C.text, fontFamily: 'monospace' }}>{r.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ToolsUsed({ tools }: { tools: [string, number][] }) {
  return (
    <Card title="Tools Used">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {tools.map(([name, count]) => (
          <div key={name} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', color: C.text, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '130px' }}>{name}</span>
            <span style={{ fontSize: '10px', color: C.muted }}>{count}×</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MetadataCard({ session }: { session: SessionDetailV2 }) {
  const rows = [
    { label: 'Project', value: session.projectName },
    { label: 'Branch',  value: session.gitBranch || '—' },
    { label: 'Version', value: session.version || '—' },
    { label: 'Session', value: session.id.slice(0, 16) },
  ];
  return (
    <Card title="Metadata">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {rows.map(r => (
          <div key={r.label}>
            <p style={{ fontSize: '10px', color: C.muted }}>{r.label}</p>
            <p style={{ fontSize: '11px', color: C.text, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.value}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SkillsAgentsCard({
  skills, agents, onOpenSkillsAgents,
}: {
  skills: SessionDetailV2['skillsInSession'];
  agents: SessionDetailV2['agentsInSession'];
  onOpenSkillsAgents: (name?: string) => void;
}) {
  if (skills.length === 0 && agents.length === 0) { return null; }
  const rowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '5px 8px', borderRadius: '5px', cursor: 'pointer',
  };
  return (
    <Card title="Skills & Agents Used">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {skills.map(s => (
          <div key={s.name} style={rowStyle}
            onClick={() => onOpenSkillsAgents(s.name)}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
              <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: `${C.primary}20`, color: C.primary, fontWeight: 600 }}>skill</span>
              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>/{s.name}</span>
              {s.invocations > 1 && <span style={{ fontSize: '10px', color: C.muted }}>{s.invocations}×</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              {s.tokens > 0 && <span style={{ fontSize: '10px', color: C.muted, fontFamily: 'monospace' }}>{formatTokens(s.tokens)}</span>}
              {s.cost > 0 && <span style={{ fontSize: '10px', color: C.text, fontFamily: 'monospace' }}>{formatCost(s.cost)}</span>}
            </div>
          </div>
        ))}
        {agents.map(a => (
          <div key={a.type} style={rowStyle}
            onClick={() => onOpenSkillsAgents(a.type)}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
              <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: `${C.agent}20`, color: C.agent, fontWeight: 600 }}>agent</span>
              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.type}</span>
              {a.invocations > 1 && <span style={{ fontSize: '10px', color: C.muted }}>{a.invocations}×</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              {a.tokens > 0 && <span style={{ fontSize: '10px', color: C.muted, fontFamily: 'monospace' }}>{formatTokens(a.tokens)}</span>}
              {a.cost > 0 && <span style={{ fontSize: '10px', color: C.agent, fontFamily: 'monospace' }}>{formatCost(a.cost)}</span>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ToolMetricsCard({ toolMetrics }: { toolMetrics: SessionDetailV2['toolMetrics'] }) {
  if (!toolMetrics || toolMetrics.byTool.length === 0) { return null; }

  function fmtDur(ms: number): string {
    if (ms <= 0)      { return '—'; }
    if (ms < 1_000)   { return `${ms}ms`; }
    const s = ms / 1_000;
    if (s < 60)       { return `${s.toFixed(1)}s`; }
    const min = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  }

  function fmtTok(n: number): string {
    if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(1)}M`; }
    if (n >= 1_000)     { return `${(n / 1_000).toFixed(1)}K`; }
    return n.toString();
  }

  const top = toolMetrics.byTool.slice(0, 8);
  const maxMs = top[0]?.totalDurationMs || 1;

  return (
    <Card title="Tool Performance">
      {/* Summary row */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', paddingBottom: '10px', borderBottom: `1px solid ${C.border}` }}>
        <div>
          <p style={{ fontSize: '14px', fontWeight: 700, color: C.text, margin: 0 }}>{fmtDur(toolMetrics.totalDurationMs)}</p>
          <p style={{ fontSize: '10px', color: C.muted, margin: '1px 0 0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total wait</p>
        </div>
        <div>
          <p style={{ fontSize: '14px', fontWeight: 700, color: C.text, margin: 0 }}>~{fmtTok(toolMetrics.estimatedTokens)}</p>
          <p style={{ fontSize: '10px', color: C.muted, margin: '1px 0 0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Est. tokens</p>
        </div>
      </div>
      {/* Per-tool breakdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
        {top.map(t => (
          <div key={t.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
              <span style={{ fontSize: '11px', color: C.text, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }} title={t.name}>{t.name}</span>
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <span style={{ fontSize: '10px', color: C.muted }}>{t.count}×</span>
                <span style={{ fontSize: '10px', color: C.text, fontFamily: 'monospace' }}>{fmtDur(t.totalDurationMs)}</span>
              </div>
            </div>
            {/* Duration bar */}
            <div style={{ height: '3px', background: C.border, borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(t.totalDurationMs / maxMs) * 100}%`, background: C.blue, borderRadius: '2px' }} />
            </div>
            {t.avgDurationMs > 0 && (
              <p style={{ fontSize: '10px', color: C.muted, margin: '2px 0 0' }}>avg {fmtDur(t.avgDurationMs)} · ~{fmtTok(t.estimatedTokens)} tokens</p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function CompactionCard({ compaction }: { compaction: NonNullable<SessionDetailV2['compaction']> }) {
  const amberBorder = 'rgba(217,119,6,0.3)';
  return (
    <Card title="Context Compaction" accent={amberBorder}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '11px', color: C.amber }}>Full compactions</span>
          <span style={{ fontSize: '11px', color: C.text, fontFamily: 'monospace' }}>{compaction.compactions}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '11px', color: C.amber }}>Micro-compactions</span>
          <span style={{ fontSize: '11px', color: C.text, fontFamily: 'monospace' }}>{compaction.microcompactions}</span>
        </div>
        {compaction.totalTokensSaved > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', color: C.muted }}>Tokens saved</span>
            <span style={{ fontSize: '11px', color: C.green, fontFamily: 'monospace' }}>{formatTokens(compaction.totalTokensSaved)}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Session detail view ───────────────────────────────────────────────────────

type DetailSubTab = 'overview' | 'messages';

function SessionDetail({
  session,
  onOpenSkillsAgents,
}: {
  session: SessionDetailV2;
  onOpenSkillsAgents: (name?: string) => void;
}) {
  const [subTab, setSubTab] = useState<DetailSubTab>('overview');
  const models       = session.models || [];
  const messages     = session.messages || [];
  const compaction   = session.compaction || { compactions: 0, microcompactions: 0, totalTokensSaved: 0, compactionTimestamps: [] };
  const compCount    = compaction.compactions + compaction.microcompactions;
  const topTools     = Object.entries(session.toolsUsed || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const skills       = session.skillsInSession || [];
  const agents       = session.agentsInSession || [];
  const agentTree    = session.agentTree;

  const subTabBtn = (key: DetailSubTab, label: string) => (
    <button
      onClick={() => setSubTab(key)}
      style={{
        padding: '4px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
        cursor: 'pointer', border: 'none',
        background: subTab === key ? `${C.primary}22` : 'transparent',
        color:      subTab === key ? C.primary : C.muted,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ borderTop: `1px solid ${C.border}`, padding: '16px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div>
          <h2 style={{ fontSize: '14px', fontWeight: 700, color: C.text, margin: '0 0 4px' }}>{session.projectName}</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {models.map(m => <Badge key={m} text={m} />)}
            {session.gitBranch && <span style={{ fontSize: '11px', color: C.muted }}>⎇ {session.gitBranch}</span>}
            <span style={{ fontSize: '11px', color: C.muted, fontFamily: 'monospace' }}>{session.id.slice(0, 16)}</span>
          </div>
        </div>
        {/* Sub-tab pills */}
        <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
          {subTabBtn('overview',  'Overview')}
          {subTabBtn('messages',  `Messages (${messages.length})`)}
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px', marginBottom: '16px' }}>
        <StatCard label="Duration"    value={formatDuration(session.duration)} />
        <StatCard label="Messages"    value={session.messageCount.toLocaleString()} />
        <StatCard label="Tool Calls"  value={session.toolCallCount.toLocaleString()} />
        <StatCard label="Tokens"      value={formatTokens(session.totalInputTokens + session.totalOutputTokens)} />
        <StatCard label="Est. Cost"   value={formatCost(session.estimatedCost)} />
        <StatCard
          label="Compactions"
          value={compCount.toString()}
          accent={compCount > 0 ? 'rgba(217,119,6,0.3)' : undefined}
        />
      </div>

      {/* Sub-tab content */}
      {subTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', alignItems: 'start' }}>
          {/* Left: agent tree */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {agentTree && <AgentTreeGraph tree={agentTree} />}
          </div>
          {/* Right: sidebar cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <SkillsAgentsCard skills={skills} agents={agents} onOpenSkillsAgents={onOpenSkillsAgents} />
            <ToolMetricsCard toolMetrics={session.toolMetrics} />
            <TokenBreakdown session={session} />
            {topTools.length > 0 && <ToolsUsed tools={topTools} />}
            {compCount > 0 && <CompactionCard compaction={compaction} />}
            <MetadataCard session={session} />
          </div>
        </div>
      )}

      {subTab === 'messages' && (
        <Card title={`Conversation (${messages.length} messages)`}>
          {messages.length === 0 ? (
            <p style={{ color: C.muted, fontSize: '12px' }}>No messages to display.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {messages.map((msg, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <div style={{ borderTop: `1px solid ${C.border}`, margin: '0 -2px' }} />}
                  <MessageItem msg={msg} />
                </React.Fragment>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ── Session list row ──────────────────────────────────────────────────────────

function SessionRow({
  session,
  selected,
  onClick,
}: {
  session: SessionInfo;
  selected: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const models = session.models || [];

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', border: 'none', borderBottom: `1px solid ${C.border}`,
        background: selected ? `${C.primary}11` : hovered ? `${C.mutedDark}44` : 'transparent',
        cursor: 'pointer', textAlign: 'left', width: '100%',
        borderLeft: selected ? `3px solid ${C.primary}` : '3px solid transparent',
        transition: 'background 0.1s',
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
          <span style={{ fontSize: '12px', fontWeight: 500, color: C.text }}>{session.projectName}</span>
          {models.map(m => (
            <Badge key={m} text={m} color={modelColor(m)} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: C.muted }}>
          {session.gitBranch && <span>⎇ {session.gitBranch}</span>}
          <span>{formatDuration(session.duration)}</span>
          <span>{session.messageCount} msgs</span>
          <span>{session.toolCallCount} tools</span>
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <p style={{ fontSize: '12px', fontWeight: 500, color: C.text, margin: 0 }}>{formatCost(session.estimatedCost)}</p>
        <p style={{ fontSize: '10px', color: C.muted, margin: '2px 0 0' }}>{timeAgo(session.timestamp)}</p>
      </div>
    </button>
  );
}

// ── SessionsTab ───────────────────────────────────────────────────────────────

export interface SessionsTabProps {
  list:           { sessions: SessionInfo[]; total: number } | null;
  listError:      string | null;
  detail:         SessionDetailV2 | null;
  detailError:    string | null;
  detailLoading:  boolean;
  selectedId:     string | null;
  onSearch:       (query?: string, limit?: number, offset?: number) => void;
  onSelectSession:(id: string) => void;
  onBack:         () => void;
  onOpenSkillsAgents: (name?: string) => void;
}

export function SessionsTab({
  list, listError, detail, detailError, detailLoading,
  selectedId, onSearch, onSelectSession, onBack, onOpenSkillsAgents,
}: SessionsTabProps) {
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load
  useEffect(() => {
    onSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) { clearTimeout(debounceRef.current); }
    debounceRef.current = setTimeout(() => {
      onSearch(q || undefined);
    }, 300);
  }

  const sessions = list?.sessions || [];

  // ── Detail overlay ────────────────────────────────────────────────────────
  if (selectedId) {
    return (
      <div>
        {/* Back bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
          background: C.bg,
          position: 'sticky', top: '44px', zIndex: 9,
        }}>
          <button
            onClick={onBack}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '4px 10px', borderRadius: '6px', fontSize: '12px',
              color: C.muted, background: 'transparent',
              border: `1px solid ${C.border}`, cursor: 'pointer',
              transition: 'color 0.1s, border-color 0.1s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.text; (e.currentTarget as HTMLElement).style.borderColor = C.mutedDark; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.muted; (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
          >
            ← Sessions
          </button>
          {detail && detail.id === selectedId && (
            <span style={{ fontSize: '12px', color: C.muted }}>
              {detail.projectName}
              {detail.gitBranch && <span style={{ marginLeft: '8px', fontFamily: 'monospace', fontSize: '11px' }}>⎇ {detail.gitBranch}</span>}
            </span>
          )}
        </div>

        {/* Detail content */}
        <div>
          {detailLoading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 20px' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', border: `2px solid ${C.border}`, borderTopColor: C.primary, animation: 'spin 0.8s linear infinite' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}
          {detailError && (
            <div style={{ padding: '40px 20px', color: C.muted, fontSize: '12px', textAlign: 'center' }}>{detailError}</div>
          )}
          {!detailLoading && !detailError && detail && detail.id === selectedId && (
            <SessionDetail session={detail} onOpenSkillsAgents={onOpenSkillsAgents} />
          )}
        </div>
      </div>
    );
  }

  // ── Session list ──────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search bar */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: C.bg, flexShrink: 0 }}>
        <input
          type="text"
          value={query}
          onChange={handleQueryChange}
          placeholder="Search sessions…"
          style={{
            width: '100%', padding: '7px 12px', borderRadius: '6px',
            border: `1px solid ${C.border}`, background: C.card,
            color: C.text, fontSize: '12px', outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        {list && (
          <p style={{ fontSize: '10px', color: C.muted, margin: '5px 0 0' }}>
            {list.total} session{list.total !== 1 ? 's' : ''}{query ? ` matching "${query}"` : ''}
          </p>
        )}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {listError ? (
          <div style={{ padding: '20px', color: C.muted, fontSize: '12px', textAlign: 'center' }}>{listError}</div>
        ) : sessions.length === 0 && list !== null ? (
          <div style={{ padding: '40px 20px', color: C.muted, fontSize: '12px', textAlign: 'center' }}>
            {query ? 'No sessions match your search.' : 'No sessions found.'}
          </div>
        ) : (
          sessions.map(session => (
            <SessionRow
              key={session.id}
              session={session}
              selected={false}
              onClick={() => onSelectSession(session.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
