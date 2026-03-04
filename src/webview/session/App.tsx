import React, { useState, useEffect } from 'react';
import type { SessionDetail, SessionMessageDisplay, CompactionInfo, SessionSkillEntry, SessionAgentEntry } from '../../data/types';
import { formatCost, formatDuration, formatTokens } from '../../lib/format';

// ── Theme ─────────────────────────────────────────────────────────────────────

const C = {
  bg:        '#09090b',
  card:      '#18181b',
  border:    '#27272a',
  text:      '#fafafa',
  muted:     '#71717a',
  mutedDark: '#3f3f46',
  primary:   '#D4764E',
  amber:     '#d97706',
  amberBg:   'rgba(217,119,6,0.08)',
  amberBorder:'rgba(217,119,6,0.3)',
  green:     '#16a34a',
  blue:      '#6B8AE6',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ts: string): string {
  if (!ts) { return ''; }
  const d    = new Date(ts);
  const h    = d.getHours();
  const m    = d.getMinutes().toString().padStart(2, '0');
  const s    = d.getSeconds().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${m}:${s} ${ampm}`;
}

function modelColor(model: string | undefined): string {
  if (!model) { return C.muted; }
  if (model.toLowerCase().includes('opus'))   { return C.primary; }
  if (model.toLowerCase().includes('sonnet')) { return C.blue; }
  return '#5CB87A';
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Card({ title, children, accent }: {
  title?: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div style={{
      background:   C.card,
      border:       `1px solid ${accent ? accent : C.border}`,
      borderRadius: '8px',
      padding:      '14px 16px',
    }}>
      {title && (
        <p style={{ fontSize: '11px', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{
      background:   C.card,
      border:       `1px solid ${accent ? accent : C.border}`,
      borderRadius: '8px',
      padding:      '12px 14px',
      textAlign:    'center',
    }}>
      <p style={{ fontSize: '18px', fontWeight: 700, color: accent || C.text, margin: 0 }}>{value}</p>
      <p style={{ fontSize: '10px', color: C.muted, marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
    </div>
  );
}

function Badge({ text, color }: { text: string; color?: string }) {
  return (
    <span style={{
      fontSize:     '10px',
      padding:      '2px 6px',
      borderRadius: '4px',
      background:   C.mutedDark,
      color:        color || C.muted,
      fontFamily:   'monospace',
      whiteSpace:   'nowrap',
    }}>
      {text}
    </span>
  );
}

// ── vscode API (singleton) ────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _vsc: any = null;
function postToExtension(msg: object) { if (_vsc) { _vsc.postMessage(msg); } }

// ── Message item ──────────────────────────────────────────────────────────────

const MSG_LIMIT = 500;

function MessageItem({ msg }: { msg: SessionMessageDisplay }) {
  const [expanded, setExpanded] = useState(false);
  const isUser      = msg.role === 'user';
  const isTruncated = msg.content.length > MSG_LIMIT;
  const content     = expanded || !isTruncated ? msg.content : msg.content.slice(0, MSG_LIMIT) + '…';
  const tokens      = msg.usage ? msg.usage.input_tokens + msg.usage.output_tokens : 0;

  return (
    <div style={{ display: 'flex', gap: '10px' }}>
      {/* Role avatar */}
      <div style={{
        width:        '28px',
        height:       '28px',
        borderRadius: '6px',
        background:   isUser ? `${C.primary}18` : C.mutedDark,
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        flexShrink:   0,
        fontSize:     '11px',
        fontWeight:   700,
        color:        isUser ? C.primary : C.muted,
      }}>
        {isUser ? 'U' : 'C'}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header row */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: C.text }}>
            {isUser ? 'You' : 'Claude'}
          </span>
          <span style={{ fontSize: '10px', color: C.muted }}>{formatTime(msg.timestamp)}</span>
          {!isUser && msg.model && (
            <Badge text={msg.model.includes('opus') ? 'Opus' : msg.model.includes('sonnet') ? 'Sonnet' : 'Haiku'}
                   color={modelColor(msg.model)} />
          )}
          {!isUser && tokens > 0 && (
            <span style={{ fontSize: '10px', color: C.muted }}>{formatTokens(tokens)} tok</span>
          )}
        </div>

        {/* Message content */}
        <p style={{ fontSize: '12px', color: '#d4d4d8', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.6' }}>
          {content}
        </p>

        {/* Expand / collapse */}
        {isTruncated && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ fontSize: '10px', color: C.primary, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginTop: '2px' }}
          >
            {expanded ? '▲ Show less' : `▼ Show ${(msg.content.length - MSG_LIMIT).toLocaleString()} more chars`}
          </button>
        )}

        {/* Tool call badges */}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
            {msg.toolCalls.map((t, i) => (
              <span key={i} style={{
                fontSize:     '10px',
                padding:      '2px 7px',
                borderRadius: '4px',
                border:       `1px solid ${C.border}`,
                color:        C.muted,
                fontFamily:   'monospace',
              }}>
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sidebar cards ─────────────────────────────────────────────────────────────

function TokenBreakdown({ session }: { session: SessionDetail }) {
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
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
          <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: C.text, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '130px' }}>{name}</span>
            <span style={{ fontSize: '10px', color: C.muted }}>{count}×</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CompactionCard({ compaction }: { compaction: CompactionInfo }) {
  return (
    <Card title="Context Compaction" accent={C.amberBorder}>
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
        {compaction.compactionTimestamps.length > 0 && (
          <div style={{ marginTop: '4px', borderTop: `1px solid ${C.border}`, paddingTop: '6px' }}>
            <p style={{ fontSize: '10px', color: C.muted, marginBottom: '4px' }}>Timeline</p>
            {compaction.compactionTimestamps.slice(0, 5).map((ts, i) => (
              <p key={i} style={{ fontSize: '10px', color: C.muted, fontFamily: 'monospace' }}>
                {formatTime(ts)}
              </p>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function MetadataCard({ session }: { session: SessionDetail }) {
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

// ── Skills & Agents session card ──────────────────────────────────────────────

const agentColor = '#6366f1';

function SkillsAgentsSessionCard({
  skills,
  agents,
}: {
  skills: SessionSkillEntry[];
  agents: SessionAgentEntry[];
}) {
  if (skills.length === 0 && agents.length === 0) { return null; }

  const rowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '5px 8px', borderRadius: '5px', cursor: 'pointer',
    transition: 'background 0.1s',
  };

  function openSkillsPanel() { postToExtension({ type: 'OPEN_SKILLS_AGENTS' }); }

  return (
    <Card title="Skills & Agents Used">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {skills.map(s => (
          <div
            key={s.name}
            style={rowStyle}
            onClick={openSkillsPanel}
            title="Click to open Skills & Agents panel"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
              <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: `${C.primary}20`, color: C.primary, fontWeight: 600 }}>skill</span>
              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>/{s.name}</span>
              {s.invocations > 1 && <span style={{ fontSize: '10px', color: C.muted }}>{s.invocations}×</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0, alignItems: 'center' }}>
              {s.tokens > 0 && <span style={{ fontSize: '10px', color: C.muted, fontFamily: 'monospace' }}>{formatTokens(s.tokens)}</span>}
              {s.cost > 0 && <span style={{ fontSize: '10px', color: C.text, fontFamily: 'monospace' }}>{formatCost(s.cost)}</span>}
            </div>
          </div>
        ))}
        {agents.map(a => (
          <div
            key={a.type}
            style={rowStyle}
            onClick={openSkillsPanel}
            title="Click to open Skills & Agents panel"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
              <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: `${agentColor}20`, color: agentColor, fontWeight: 600 }}>agent</span>
              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.type}</span>
              {a.invocations > 1 && <span style={{ fontSize: '10px', color: C.muted }}>{a.invocations}×</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0, alignItems: 'center' }}>
              {a.tokens > 0 && <span style={{ fontSize: '10px', color: C.muted, fontFamily: 'monospace' }}>{formatTokens(a.tokens)}</span>}
              {a.cost > 0 && <span style={{ fontSize: '10px', color: agentColor, fontFamily: 'monospace' }}>{formatCost(a.cost)}</span>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Session view ──────────────────────────────────────────────────────────────

function SessionView({ session }: { session: SessionDetail }) {
  const models         = session.models || [];
  const messages       = session.messages || [];
  const compaction     = session.compaction || { compactions: 0, microcompactions: 0, totalTokensSaved: 0, compactionTimestamps: [] };
  const compactionCount = compaction.compactions + compaction.microcompactions;
  const topTools       = Object.entries(session.toolsUsed || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '16px', fontWeight: 700, color: C.text }}>{session.projectName}</h1>
        <div style={{ display: 'flex', gap: '10px', marginTop: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
          {models.map(m => <Badge key={m} text={m} />)}
          {session.gitBranch && (
            <span style={{ fontSize: '11px', color: C.muted }}>⎇ {session.gitBranch}</span>
          )}
          <span style={{ fontSize: '11px', color: C.muted, fontFamily: 'monospace' }}>
            {session.id.slice(0, 16)}
          </span>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px', marginBottom: '20px' }}>
        <StatCard label="Duration"    value={formatDuration(session.duration)} />
        <StatCard label="Messages"    value={session.messageCount.toLocaleString()} />
        <StatCard label="Tool Calls"  value={session.toolCallCount.toLocaleString()} />
        <StatCard label="Tokens"      value={formatTokens(session.totalInputTokens + session.totalOutputTokens)} />
        <StatCard label="Est. Cost"   value={formatCost(session.estimatedCost)} />
        <StatCard
          label="Compactions"
          value={compactionCount.toString()}
          accent={compactionCount > 0 ? C.amberBorder : undefined}
        />
      </div>

      {/* Content: conversation + sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', alignItems: 'start' }}>

        {/* Left: conversation */}
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

        {/* Right: sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <SkillsAgentsSessionCard
            skills={session.skillsInSession || []}
            agents={session.agentsInSession || []}
          />
          <TokenBreakdown session={session} />
          {topTools.length > 0 && <ToolsUsed tools={topTools} />}
          {compactionCount > 0 && <CompactionCard compaction={compaction} />}
          <MetadataCard session={session} />
        </div>
      </div>
    </div>
  );
}

// ── Loading / error states ────────────────────────────────────────────────────

function Loading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '12px' }}>
      <div style={{
        width: '24px', height: '24px', borderRadius: '50%',
        border: `2px solid ${C.border}`, borderTopColor: C.primary,
        animation: 'spin 0.8s linear infinite',
      }} />
      <p style={{ color: C.muted, fontSize: '12px' }}>Loading session…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <p style={{ color: C.muted, fontSize: '13px' }}>{message}</p>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; session: SessionDetail };

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const vsc = acquireVsCodeApi();
    _vsc = vsc;

    const handler = (event: MessageEvent) => {
      const msg = event.data as { type: string; payload?: SessionDetail; message?: string };
      if (msg.type === 'SESSION_DATA' && msg.payload) {
        setState({ status: 'loaded', session: msg.payload });
      } else if (msg.type === 'SESSION_ERROR') {
        setState({ status: 'error', message: msg.message || 'Unknown error.' });
      }
    };

    window.addEventListener('message', handler);
    vsc.postMessage({ type: 'REQUEST_SESSION' });
    return () => window.removeEventListener('message', handler);
  }, []);

  if (state.status === 'loading') { return <Loading />; }
  if (state.status === 'error')   { return <ErrorState message={state.message} />; }
  return <SessionView session={state.session} />;
}
