import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import https from 'https';
import { calculateCost, getModelDisplayName } from '../lib/pricing';
import type {
  StatsCache,
  HistoryEntry,
  ProjectInfo,
  SessionInfo,
  SessionDetail,
  SessionDetailV2,
  AgentTreeNode,
  SessionMessageDisplay,
  DashboardStats,
  DailyActivity,
  DailyModelTokens,
  TokenUsage,
  SessionMessage,
  SkillAgentStats,
  SkillAgentEntry,
  SkillAgentStatsOptions,
  SubAgentMetric,
  SessionMetric,
  SessionSkillEntry,
  SessionAgentEntry,
  CustomSkillConfig,
  CustomSkillsFile,
  ToolMetrics,
  ToolMetricEntry,
  RateUsageStats,
  RateUsageBucket,
  CostAnalysis,
} from './types';

// ── Data directory ────────────────────────────────────────────────────────────
// Set via setClaudeDir() during extension activation, falls back to ~/.claude

let _claudeDir: string | null = null;

export function setClaudeDir(dir: string): void {
  _claudeDir = dir;
  // Bust the supplemental stats cache when the data source changes
  supplementalCache = null;
}

export function getConfiguredClaudeDir(): string {
  return _claudeDir ?? path.join(os.homedir(), '.claude');
}

function getClaudeDir(): string {
  return _claudeDir ?? path.join(os.homedir(), '.claude');
}

export function loadCustomSkills(): CustomSkillConfig[] {
  const configPath = path.join(getConfiguredClaudeDir(), 'klawops-custom-skills.json');
  if (!fs.existsSync(configPath)) { return []; }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as CustomSkillsFile;
    return raw.skills || [];
  } catch { return []; }
}

function getProjectsDir(): string {
  return path.join(getClaudeDir(), 'projects');
}

// ── Session metadata cache ────────────────────────────────────────────────────
// Avoids re-parsing unchanged JSONL files on every getSessions()/getProjects() call.
// LRU-capped to prevent unbounded memory growth on large session stores.

const SESSION_META_CACHE_MAX = 500;
const _sessionMetaCache = new Map<string, { mtimeMs: number; info: SessionInfo }>();

function evictOldestCacheEntries(): void {
  if (_sessionMetaCache.size <= SESSION_META_CACHE_MAX) { return; }
  const overflow = _sessionMetaCache.size - SESSION_META_CACHE_MAX;
  const iter = _sessionMetaCache.keys();
  for (let i = 0; i < overflow; i++) {
    const key = iter.next().value;
    if (key !== undefined) { _sessionMetaCache.delete(key); }
  }
}

function getCachedSessionInfo(filePath: string, projectId: string, projectName: string): SessionInfo {
  const stat = fs.statSync(filePath);
  const cached = _sessionMetaCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    // Move to end for LRU ordering
    _sessionMetaCache.delete(filePath);
    _sessionMetaCache.set(filePath, cached);
    return cached.info;
  }
  const info = parseSessionFile(filePath, projectId, projectName);
  _sessionMetaCache.set(filePath, { mtimeMs: stat.mtimeMs, info });
  evictOldestCacheEntries();
  return info;
}

// ── Stats cache ───────────────────────────────────────────────────────────────

export function getStatsCache(): StatsCache | null {
  const statsPath = path.join(getClaudeDir(), 'stats-cache.json');
  if (!fs.existsSync(statsPath)) { return null; }
  return JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
}

export function getHistory(): HistoryEntry[] {
  const historyPath = path.join(getClaudeDir(), 'history.jsonl');
  if (!fs.existsSync(historyPath)) { return []; }
  const lines = fs.readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean);
  return lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean) as HistoryEntry[];
}

// ── Project ID helpers ────────────────────────────────────────────────────────

export function projectIdToName(id: string): string {
  const decoded = id.replace(/^-/, '/').replace(/-/g, '/');
  const parts = decoded.split('/');
  return parts[parts.length - 1] || id;
}

function projectIdToFullPath(id: string): string {
  return id.replace(/^-/, '/').replace(/-/g, '/');
}

// ── Projects ──────────────────────────────────────────────────────────────────

export function getProjects(): ProjectInfo[] {
  if (!fs.existsSync(getProjectsDir())) { return []; }
  const entries = fs.readdirSync(getProjectsDir());
  const projects: ProjectInfo[] = [];

  for (const entry of entries) {
    const projectPath = path.join(getProjectsDir(), entry);
    if (!fs.statSync(projectPath).isDirectory()) { continue; }

    const jsonlFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
    if (jsonlFiles.length === 0) { continue; }

    let totalMessages = 0;
    let totalTokens = 0;
    let estimatedCost = 0;
    let lastActive = '';
    const modelsSet = new Set<string>();

    for (const file of jsonlFiles) {
      const filePath = path.join(projectPath, file);
      const session = getCachedSessionInfo(filePath, entry, projectIdToName(entry));
      const mtime = fs.statSync(filePath).mtime.toISOString();
      if (!lastActive || mtime > lastActive) { lastActive = mtime; }
      totalMessages += session.messageCount;
      totalTokens += session.totalInputTokens + session.totalOutputTokens + session.totalCacheReadTokens + session.totalCacheWriteTokens;
      estimatedCost += session.estimatedCost;
      for (const m of session.models) { modelsSet.add(m); }
    }

    projects.push({
      id: entry,
      name: projectIdToName(entry),
      path: projectIdToFullPath(entry),
      sessionCount: jsonlFiles.length,
      totalMessages,
      totalTokens,
      estimatedCost,
      lastActive,
      models: Array.from(modelsSet),
    });
  }

  return projects.sort((a, b) => b.lastActive.localeCompare(a.lastActive));
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function getProjectSessions(projectId: string): SessionInfo[] {
  const projectPath = path.join(getProjectsDir(), projectId);
  if (!fs.existsSync(projectPath)) { return []; }
  const jsonlFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
  return jsonlFiles
    .map(file => getCachedSessionInfo(path.join(projectPath, file), projectId, projectIdToName(projectId)))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function getSessions(limit = 50, offset = 0): SessionInfo[] {
  const allSessions: SessionInfo[] = [];
  if (!fs.existsSync(getProjectsDir())) { return []; }
  const projectEntries = fs.readdirSync(getProjectsDir());

  for (const entry of projectEntries) {
    const projectPath = path.join(getProjectsDir(), entry);
    if (!fs.statSync(projectPath).isDirectory()) { continue; }
    const jsonlFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
    for (const file of jsonlFiles) {
      allSessions.push(getCachedSessionInfo(path.join(projectPath, file), entry, projectIdToName(entry)));
    }
  }

  allSessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return allSessions.slice(offset, offset + limit);
}

export function getMostRecentSession(): SessionInfo | null {
  if (!fs.existsSync(getProjectsDir())) { return null; }

  let newestFile = '';
  let newestMtime = 0;
  let newestProjectId = '';

  for (const entry of fs.readdirSync(getProjectsDir())) {
    const projectPath = path.join(getProjectsDir(), entry);
    if (!fs.statSync(projectPath).isDirectory()) { continue; }
    for (const f of fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))) {
      const fp = path.join(projectPath, f);
      const mt = fs.statSync(fp).mtimeMs;
      if (mt > newestMtime) {
        newestMtime = mt;
        newestFile = fp;
        newestProjectId = entry;
      }
    }
  }

  if (!newestFile) { return null; }
  return getCachedSessionInfo(newestFile, newestProjectId, projectIdToName(newestProjectId));
}

// ── Session parsing ───────────────────────────────────────────────────────────

export function parseSessionFile(filePath: string, projectId: string, projectName: string): SessionInfo {
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  const sessionId = path.basename(filePath, '.jsonl');

  let firstTimestamp = '';
  let lastTimestamp = '';
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let estimatedCost = 0;
  let gitBranch = '';
  let cwd = '';
  let version = '';
  let firstMessage = '';
  const modelsSet = new Set<string>();
  const toolsUsed: Record<string, number> = {};

  let compactions = 0;
  let microcompactions = 0;
  let totalTokensSaved = 0;
  const compactionTimestamps: string[] = [];

  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as SessionMessage;
      if (msg.timestamp) {
        if (!firstTimestamp) { firstTimestamp = msg.timestamp; }
        lastTimestamp = msg.timestamp;
      }
      if (msg.gitBranch && !gitBranch) { gitBranch = msg.gitBranch; }
      if (msg.cwd && !cwd)             { cwd = msg.cwd; }
      if (msg.version && !version)     { version = msg.version; }

      if (msg.compactMetadata) {
        compactions++;
        if (msg.timestamp) { compactionTimestamps.push(msg.timestamp); }
      }
      if (msg.microcompactMetadata) {
        microcompactions++;
        totalTokensSaved += msg.microcompactMetadata.tokensSaved || 0;
        if (msg.timestamp) { compactionTimestamps.push(msg.timestamp); }
      }

      if (msg.type === 'user') {
        userMessageCount++;
        if (!firstMessage && msg.message?.content) {
          const raw = getMessageText(msg.message.content);
          if (raw && !raw.startsWith('[Tool Result]')) {
            firstMessage = raw.length > 120 ? raw.slice(0, 120) + '…' : raw;
          }
        }
      }

      if (msg.type === 'assistant') {
        assistantMessageCount++;
        const model = msg.message?.model || '';
        if (model) { modelsSet.add(model); }
        const usage = msg.message?.usage;
        if (usage) {
          totalInputTokens      += usage.input_tokens || 0;
          totalOutputTokens     += usage.output_tokens || 0;
          totalCacheReadTokens  += usage.cache_read_input_tokens || 0;
          totalCacheWriteTokens += usage.cache_creation_input_tokens || 0;
          estimatedCost += calculateCost(
            model,
            usage.input_tokens || 0,
            usage.output_tokens || 0,
            usage.cache_creation_input_tokens || 0,
            usage.cache_read_input_tokens || 0
          );
        }
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c && typeof c === 'object' && 'type' in c && (c as Record<string, unknown>).type === 'tool_use') {
              toolCallCount++;
              const name = ('name' in c ? (c as Record<string, unknown>).name : 'unknown') as string;
              toolsUsed[name] = (toolsUsed[name] || 0) + 1;
            }
          }
        }
      }
    } catch { /* skip malformed lines */ }
  }

  const duration = firstTimestamp && lastTimestamp
    ? new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()
    : 0;

  const models = Array.from(modelsSet);

  return {
    id: sessionId,
    projectId,
    projectName,
    timestamp: firstTimestamp || new Date().toISOString(),
    duration,
    messageCount: userMessageCount + assistantMessageCount,
    userMessageCount,
    assistantMessageCount,
    toolCallCount,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    estimatedCost,
    model: models[0] || 'unknown',
    models: models.map(getModelDisplayName),
    gitBranch,
    cwd,
    version,
    toolsUsed,
    compaction: { compactions, microcompactions, totalTokensSaved, compactionTimestamps },
    firstMessage,
  };
}

// ── Per-session skill/agent breakdown ────────────────────────────────────────

function parseSessionSkillAgents(
  filePath: string,
  projectPath: string,
  sessionId: string,
): { skillsInSession: SessionSkillEntry[]; agentsInSession: SessionAgentEntry[] } {
  let lines: string[];
  try {
    lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  } catch { return { skillsInSession: [], agentsInSession: [] }; }

  // Pass 1: tooluId → agentId
  const tooluToAgent = new Map<string, string>();
  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as AgentProgressMsg;
      if (msg.type === 'progress' && msg.data?.type === 'agent_progress' && msg.data.agentId && msg.parentToolUseID) {
        tooluToAgent.set(msg.parentToolUseID, msg.data.agentId);
      }
    } catch { /* skip */ }
  }

  // Pass 2: skill windows + agent detection
  const skillMap = new Map<string, { invocations: number; tokens: number; cost: number }>();
  const agentMap = new Map<string, { invocations: number; tokens: number; cost: number }>();

  let openSkill: string | null = null;
  let openSkillTokens = 0;
  let openSkillCost = 0;

  function flushSkill() {
    if (!openSkill) { return; }
    const existing = skillMap.get(openSkill);
    if (existing) {
      existing.invocations++;
      existing.tokens += openSkillTokens;
      existing.cost += openSkillCost;
    } else {
      skillMap.set(openSkill, { invocations: 1, tokens: openSkillTokens, cost: openSkillCost });
    }
    openSkill = null; openSkillTokens = 0; openSkillCost = 0;
  }

  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as SessionMessage & { isMeta?: boolean };

      if (msg.type === 'user') {
        if (!msg.isMeta) {
          const text = getMessageText(msg.message?.content);
          const m = SKILL_RX.exec(text);
          if (m) { flushSkill(); openSkill = m[1].trim(); continue; }
          flushSkill();
        }
      }

      if (msg.type === 'assistant' && msg.message?.usage) {
        const u = msg.message.usage;
        if (openSkill) {
          openSkillTokens += (u.input_tokens || 0) + (u.output_tokens || 0) +
            (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          openSkillCost += calculateCost(msg.message.model || '', u.input_tokens || 0, u.output_tokens || 0, u.cache_creation_input_tokens || 0, u.cache_read_input_tokens || 0);
        }
      }

      if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
        for (const c of msg.message!.content as Record<string, unknown>[]) {
          if (c.type === 'tool_use' && AGENT_TOOL_NAMES.has(c.name as string) && c.input && typeof c.input === 'object') {
            const agentType = ((c.input as { subagent_type?: string }).subagent_type) || 'unknown';
            const agentId = tooluToAgent.get(c.id as string);
            let agentCost = 0; let agentTokens = 0;
            if (agentId) {
              const agentPath = path.join(projectPath, sessionId, 'subagents', `agent-${agentId}.jsonl`);
              if (fs.existsSync(agentPath)) {
                try {
                  for (const al of fs.readFileSync(agentPath, 'utf-8').split('\n').filter(Boolean)) {
                    try {
                      const am = JSON.parse(al) as SessionMessage;
                      if (am.type === 'assistant' && am.message?.usage) {
                        const u = am.message.usage;
                        agentCost += calculateCost(am.message.model || '', u.input_tokens || 0, u.output_tokens || 0, u.cache_creation_input_tokens || 0, u.cache_read_input_tokens || 0);
                        agentTokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
                      }
                    } catch { /* skip */ }
                  }
                } catch { /* skip */ }
              }
            }
            const existing = agentMap.get(agentType);
            if (existing) { existing.invocations++; existing.tokens += agentTokens; existing.cost += agentCost; }
            else { agentMap.set(agentType, { invocations: 1, tokens: agentTokens, cost: agentCost }); }
          }
        }
      }
    } catch { /* skip */ }
  }
  flushSkill();

  return {
    skillsInSession: Array.from(skillMap.entries()).map(([name, s]) => ({ name, ...s })).sort((a, b) => b.cost - a.cost),
    agentsInSession: Array.from(agentMap.entries()).map(([type, s]) => ({ type, ...s })).sort((a, b) => b.tokens - a.tokens),
  };
}

// ── Session detail (streaming) ────────────────────────────────────────────────

export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  if (!fs.existsSync(getProjectsDir())) { return null; }
  const projectEntries = fs.readdirSync(getProjectsDir());

  for (const entry of projectEntries) {
    const projectPath = path.join(getProjectsDir(), entry);
    if (!fs.statSync(projectPath).isDirectory()) { continue; }

    const filePath = path.join(projectPath, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) { continue; }

    const sessionInfo = parseSessionFile(filePath, entry, projectIdToName(entry));
    const { skillsInSession, agentsInSession } = parseSessionSkillAgents(filePath, projectPath, sessionInfo.id);
    const messages: SessionMessageDisplay[] = [];

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) { continue; }
      try {
        const msg = JSON.parse(line) as SessionMessage;

        if (msg.type === 'user' && msg.message?.role === 'user') {
          const content = msg.message.content;
          let text = '';
          if (typeof content === 'string') {
            text = content;
          } else if (Array.isArray(content)) {
            text = (content as Record<string, unknown>[])
              .map(c => {
                if (c.type === 'text')        { return c.text as string; }
                if (c.type === 'tool_result') { return '[Tool Result]'; }
                return '';
              })
              .filter(Boolean)
              .join('\n');
          }
          if (text && !text.startsWith('[Tool Result]')) {
            messages.push({ role: 'user', content: text, timestamp: msg.timestamp });
          }
        }

        if (msg.type === 'assistant' && msg.message?.content) {
          const content = msg.message.content;
          const toolCalls: { name: string; id: string }[] = [];
          let text = '';
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c && typeof c === 'object') {
                const cc = c as Record<string, unknown>;
                if (cc.type === 'text')     { text += (cc.text as string) + '\n'; }
                if (cc.type === 'tool_use') { toolCalls.push({ name: cc.name as string, id: (cc.id as string) || '' }); }
              }
            }
          }
          if (text.trim() || toolCalls.length > 0) {
            messages.push({
              role: 'assistant',
              content: text.trim() || `[Used ${toolCalls.length} tool(s): ${toolCalls.map(t => t.name).join(', ')}]`,
              timestamp: msg.timestamp,
              model: msg.message.model,
              usage: msg.message.usage as TokenUsage | undefined,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            });
          }
        }
      } catch { /* skip malformed lines */ }
    }

    return { ...sessionInfo, messages, skillsInSession, agentsInSession };
  }

  return null;
}

// ── Search ────────────────────────────────────────────────────────────────────

export function searchSessions(query: string, limit = 50): SessionInfo[] {
  if (!query.trim()) { return getSessions(limit, 0); }
  const lowerQuery = query.toLowerCase();
  const matchingSessions: SessionInfo[] = [];

  if (!fs.existsSync(getProjectsDir())) { return []; }
  const projectEntries = fs.readdirSync(getProjectsDir());

  for (const entry of projectEntries) {
    const projectPath = path.join(getProjectsDir(), entry);
    if (!fs.statSync(projectPath).isDirectory()) { continue; }

    const projectName = projectIdToName(entry);
    const projectNameMatch = projectName.toLowerCase().includes(lowerQuery);
    const jsonlFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
    for (const file of jsonlFiles) {
      const filePath = path.join(projectPath, file);

      // Check metadata first (project name, branch, first message) without re-reading file
      if (projectNameMatch) {
        matchingSessions.push(getCachedSessionInfo(filePath, entry, projectName));
        continue;
      }
      const cached = getCachedSessionInfo(filePath, entry, projectName);
      if (cached.gitBranch.toLowerCase().includes(lowerQuery) ||
          cached.firstMessage.toLowerCase().includes(lowerQuery)) {
        matchingSessions.push(cached);
        continue;
      }

      // Fall back to full-text content search — skip files larger than 512KB to bound RAM
      const fileStat = fs.statSync(filePath);
      if (fileStat.size > 512 * 1024) { continue; }
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
      let hasMatch = false;

      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as SessionMessage;
          if (msg.type === 'user' && msg.message?.role === 'user') {
            const content = msg.message.content;
            if (typeof content === 'string' && content.toLowerCase().includes(lowerQuery)) {
              hasMatch = true; break;
            }
            if (Array.isArray(content)) {
              for (const c of content as Record<string, unknown>[]) {
                if (c.type === 'text' && (c.text as string).toLowerCase().includes(lowerQuery)) {
                  hasMatch = true; break;
                }
              }
              if (hasMatch) { break; }
            }
          }
          if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
            for (const c of msg.message!.content as Record<string, unknown>[]) {
              if (c.type === 'text' && (c.text as string).toLowerCase().includes(lowerQuery)) {
                hasMatch = true; break;
              }
            }
            if (hasMatch) { break; }
          }
        } catch { /* skip */ }
      }

      if (hasMatch) {
        matchingSessions.push(getCachedSessionInfo(filePath, entry, projectIdToName(entry)));
      }
    }
  }

  matchingSessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return matchingSessions.slice(0, limit);
}

// ── Supplemental stats ────────────────────────────────────────────────────────

interface SupplementalStats {
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  modelUsage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>;
  hourCounts: Record<string, number>;
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  estimatedCost: number;
}

let supplementalCache: { key: string; data: SupplementalStats; ts: number } | null = null;
const SUPPLEMENTAL_TTL_MS = 30_000;

function getRecentSessionFiles(afterDate: string): string[] {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) { return []; }

  const cutoff = afterDate ? new Date(afterDate + 'T23:59:59Z').getTime() : 0;
  const files: string[] = [];

  for (const entry of fs.readdirSync(projectsDir)) {
    const projectPath = path.join(projectsDir, entry);
    if (!fs.statSync(projectPath).isDirectory()) { continue; }
    for (const f of fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))) {
      const filePath = path.join(projectPath, f);
      if (fs.statSync(filePath).mtimeMs > cutoff) { files.push(filePath); }
    }
  }
  return files;
}

function computeSupplementalStats(afterDate: string): SupplementalStats {
  const cacheKey = afterDate;
  if (
    supplementalCache &&
    supplementalCache.key === cacheKey &&
    Date.now() - supplementalCache.ts < SUPPLEMENTAL_TTL_MS
  ) {
    return supplementalCache.data;
  }

  const files = getRecentSessionFiles(afterDate);
  const dailyMap    = new Map<string, DailyActivity>();
  const dailyModelMap = new Map<string, Record<string, number>>();
  const modelUsage: SupplementalStats['modelUsage'] = {};
  const hourCounts: Record<string, number> = {};
  let totalSessions = 0;
  let totalMessages = 0;
  let totalTokens = 0;
  let estimatedCost = 0;

  for (const filePath of files) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    let firstTimestamp = '';
    let sessionCounted = false;

    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as SessionMessage;
        if (!msg.timestamp) { continue; }
        if (!firstTimestamp) { firstTimestamp = msg.timestamp; }

        const msgDate = msg.timestamp.slice(0, 10);
        if (afterDate && msgDate <= afterDate) { continue; }

        if (!sessionCounted) { totalSessions++; sessionCounted = true; }

        const hour = msg.timestamp.slice(11, 13);

        if (msg.type === 'user' || msg.type === 'assistant') {
          totalMessages++;
          let day = dailyMap.get(msgDate);
          if (!day) { day = { date: msgDate, messageCount: 0, sessionCount: 0, toolCallCount: 0 }; dailyMap.set(msgDate, day); }
          day.messageCount++;
        }

        if (msg.type === 'assistant') {
          const model = msg.message?.model || '';
          const usage = msg.message?.usage;
          if (usage) {
            const input      = usage.input_tokens || 0;
            const output     = usage.output_tokens || 0;
            const cacheRead  = usage.cache_read_input_tokens || 0;
            const cacheWrite = usage.cache_creation_input_tokens || 0;
            const tokens = input + output + cacheRead + cacheWrite;
            totalTokens  += tokens;
            const cost = calculateCost(model, input, output, cacheWrite, cacheRead);
            estimatedCost += cost;

            if (model) {
              if (!modelUsage[model]) { modelUsage[model] = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }; }
              modelUsage[model].inputTokens              += input;
              modelUsage[model].outputTokens             += output;
              modelUsage[model].cacheReadInputTokens     += cacheRead;
              modelUsage[model].cacheCreationInputTokens += cacheWrite;

              let dayModel = dailyModelMap.get(msgDate);
              if (!dayModel) { dayModel = {}; dailyModelMap.set(msgDate, dayModel); }
              dayModel[model] = (dayModel[model] || 0) + tokens;
            }

            hourCounts[hour] = (hourCounts[hour] || 0) + 1;
          }

          const content = msg.message?.content;
          if (Array.isArray(content)) {
            let tc = 0;
            for (const c of content) {
              if (c && typeof c === 'object' && 'type' in c && (c as Record<string, unknown>).type === 'tool_use') { tc++; }
            }
            if (tc > 0) { const day = dailyMap.get(msgDate); if (day) { day.toolCallCount += tc; } }
          }
        }
      } catch { /* skip */ }
    }

    if (sessionCounted && firstTimestamp) {
      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as SessionMessage;
          if (!msg.timestamp) { continue; }
          const d = msg.timestamp.slice(0, 10);
          if (afterDate && d <= afterDate) { continue; }
          const day = dailyMap.get(d);
          if (day) { day.sessionCount++; }
          break;
        } catch { /* skip */ }
      }
    }
  }

  const dailyActivity = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const dailyModelTokens: DailyModelTokens[] = Array.from(dailyModelMap.entries())
    .map(([date, tokensByModel]) => ({ date, tokensByModel }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const result: SupplementalStats = { dailyActivity, dailyModelTokens, modelUsage, hourCounts, totalSessions, totalMessages, totalTokens, estimatedCost };
  supplementalCache = { key: cacheKey, data: result, ts: Date.now() };
  return result;
}

// ── Rate usage stats ──────────────────────────────────────────────────────────
// Computes token/cost/call usage bucketed by hour for the current week, plus
// per-session buckets for today's sessions. Timezone parameter (IANA string)
// determines the week boundary (Monday 00:00 local).

function computeRateUsageStats(timezoneOffsetMinutes?: number): RateUsageStats {
  const tzOff = timezoneOffsetMinutes ?? 0;
  const now = new Date();

  // Compute "now" in the target timezone by shifting UTC
  const nowLocal = new Date(now.getTime() + tzOff * 60_000);
  // Week starts Monday 00:00 local
  const dayOfWeek = nowLocal.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStartLocal = new Date(Date.UTC(
    nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate() - daysSinceMonday,
    0, 0, 0, 0,
  ));
  // Convert week start back to UTC
  const weekStartUtc = new Date(weekStartLocal.getTime() - tzOff * 60_000);
  // Next Monday 00:00 local → UTC
  const weekEndLocal = new Date(weekStartLocal.getTime() + 7 * 86_400_000);
  const weekEndUtc = new Date(weekEndLocal.getTime() - tzOff * 60_000);

  // Today 00:00 local → UTC
  const todayStartLocal = new Date(Date.UTC(
    nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate(),
    0, 0, 0, 0,
  ));
  const todayStartUtc = new Date(todayStartLocal.getTime() - tzOff * 60_000);

  // Current hour start in UTC
  const currentHourStart = new Date(now);
  currentHourStart.setMinutes(0, 0, 0);

  // Hourly buckets: from weekStartUtc to now
  const hourlyMap = new Map<number, { tokens: number; cost: number; calls: number }>();
  // Per-session buckets for today
  const sessionMap = new Map<string, { start: string; end: string; tokens: number; cost: number; calls: number }>();

  let weeklyTokens = 0;
  let weeklyCost = 0;
  let weeklyCalls = 0;
  let currentHourTokens = 0;

  const projectsDir = getProjectsDir();
  if (fs.existsSync(projectsDir)) {
    for (const entry of fs.readdirSync(projectsDir)) {
      const projectPath = path.join(projectsDir, entry);
      try { if (!fs.statSync(projectPath).isDirectory()) { continue; } } catch { continue; }

      for (const f of fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))) {
        const filePath = path.join(projectPath, f);
        try {
          // Skip files untouched before the week started
          if (fs.statSync(filePath).mtimeMs < weekStartUtc.getTime()) { continue; }
        } catch { continue; }

        const sessionId = f.replace(/\.jsonl$/, '');
        let lines: string[];
        try { lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean); } catch { continue; }

        let sessionFirstTs = '';
        let sessionLastTs = '';
        let sessionTokens = 0;
        let sessionCost = 0;
        let sessionCalls = 0;

        for (const line of lines) {
          try {
            const msg = JSON.parse(line) as SessionMessage;
            if (msg.type !== 'assistant' || !msg.message?.usage || !msg.timestamp) { continue; }

            const msgTime = new Date(msg.timestamp).getTime();
            if (msgTime < weekStartUtc.getTime() || msgTime > now.getTime()) { continue; }

            const u = msg.message.usage;
            const model = msg.message.model || '';
            const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) +
              (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
            const cost = calculateCost(model, u.input_tokens || 0, u.output_tokens || 0,
              u.cache_creation_input_tokens || 0, u.cache_read_input_tokens || 0);

            weeklyTokens += tokens;
            weeklyCost += cost;
            weeklyCalls++;

            // Hourly bucket (keyed by hour offset from weekStart)
            const hourOffset = Math.floor((msgTime - weekStartUtc.getTime()) / 3_600_000);
            const existing = hourlyMap.get(hourOffset);
            if (existing) { existing.tokens += tokens; existing.cost += cost; existing.calls++; }
            else { hourlyMap.set(hourOffset, { tokens, cost, calls: 1 }); }

            // Current hour
            if (msgTime >= currentHourStart.getTime()) {
              currentHourTokens += tokens;
            }

            // Per-session for today
            if (msgTime >= todayStartUtc.getTime()) {
              if (!sessionFirstTs) { sessionFirstTs = msg.timestamp; }
              sessionLastTs = msg.timestamp;
              sessionTokens += tokens;
              sessionCost += cost;
              sessionCalls++;
            }
          } catch { /* skip */ }
        }

        if (sessionCalls > 0 && sessionFirstTs) {
          sessionMap.set(sessionId, {
            start: sessionFirstTs,
            end: sessionLastTs || sessionFirstTs,
            tokens: sessionTokens,
            cost: sessionCost,
            calls: sessionCalls,
          });
        }
      }
    }
  }

  // Build weekly buckets
  const weeklyBuckets: RateUsageBucket[] = [];
  const totalHours = Math.ceil((now.getTime() - weekStartUtc.getTime()) / 3_600_000);
  for (let h = 0; h < totalHours; h++) {
    const bucketStart = new Date(weekStartUtc.getTime() + h * 3_600_000);
    const bucketEnd = new Date(bucketStart.getTime() + 3_600_000);
    const data = hourlyMap.get(h);
    weeklyBuckets.push({
      start: bucketStart.toISOString(),
      end: bucketEnd.toISOString(),
      tokens: data?.tokens ?? 0,
      cost: data?.cost ?? 0,
      calls: data?.calls ?? 0,
    });
  }

  // Session buckets for today
  const sessionBuckets: RateUsageBucket[] = Array.from(sessionMap.entries())
    .map(([_id, s]) => ({ start: s.start, end: s.end, tokens: s.tokens, cost: s.cost, calls: s.calls }))
    .sort((a, b) => b.tokens - a.tokens);

  const peakHourlyTokens = weeklyBuckets.reduce((max, b) => Math.max(max, b.tokens), 0);

  return {
    weeklyBuckets,
    sessionBuckets,
    weeklyTokens,
    weeklyCost,
    weeklyCalls,
    weeklyResetAt: weekEndUtc.toISOString(),
    peakHourlyTokens,
    currentHourTokens,
  };
}

// ── Dashboard stats ───────────────────────────────────────────────────────────

export function getDashboardStats(): DashboardStats {
  const stats = getStatsCache();
  const projects = getProjects();
  const afterDate = stats?.lastComputedDate || '';
  const supplemental = computeSupplementalStats(afterDate);

  let totalTokens = 0;
  let estimatedCost = 0;
  const modelUsageWithCost: Record<string, DashboardStats['modelUsage'][string]> = {};

  if (stats?.modelUsage) {
    for (const [model, usage] of Object.entries(stats.modelUsage)) {
      const cost   = calculateCost(model, usage.inputTokens, usage.outputTokens, usage.cacheCreationInputTokens, usage.cacheReadInputTokens);
      const tokens = usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
      totalTokens   += tokens;
      estimatedCost += cost;
      modelUsageWithCost[model] = { ...usage, estimatedCost: cost };
    }
  }

  for (const [model, usage] of Object.entries(supplemental.modelUsage)) {
    const cost = calculateCost(model, usage.inputTokens, usage.outputTokens, usage.cacheCreationInputTokens, usage.cacheReadInputTokens);
    totalTokens   += usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
    estimatedCost += cost;
    if (modelUsageWithCost[model]) {
      modelUsageWithCost[model].inputTokens              += usage.inputTokens;
      modelUsageWithCost[model].outputTokens             += usage.outputTokens;
      modelUsageWithCost[model].cacheReadInputTokens     += usage.cacheReadInputTokens;
      modelUsageWithCost[model].cacheCreationInputTokens += usage.cacheCreationInputTokens;
      modelUsageWithCost[model].estimatedCost            += cost;
    } else {
      modelUsageWithCost[model] = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadInputTokens: usage.cacheReadInputTokens, cacheCreationInputTokens: usage.cacheCreationInputTokens, costUSD: 0, contextWindow: 0, maxOutputTokens: 0, webSearchRequests: 0, estimatedCost: cost };
    }
  }

  const dailyActivityMap = new Map<string, DailyActivity>();
  for (const d of (stats?.dailyActivity || [])) { dailyActivityMap.set(d.date, { ...d }); }
  for (const d of supplemental.dailyActivity) {
    const existing = dailyActivityMap.get(d.date);
    if (existing) {
      existing.messageCount  += d.messageCount;
      existing.sessionCount  += d.sessionCount;
      existing.toolCallCount += d.toolCallCount;
    } else {
      dailyActivityMap.set(d.date, { ...d });
    }
  }
  const mergedDailyActivity = Array.from(dailyActivityMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const dailyModelMap = new Map<string, Record<string, number>>();
  for (const d of (stats?.dailyModelTokens || [])) { dailyModelMap.set(d.date, { ...d.tokensByModel }); }
  for (const d of supplemental.dailyModelTokens) {
    const existing = dailyModelMap.get(d.date);
    if (existing) {
      for (const [model, tokens] of Object.entries(d.tokensByModel)) { existing[model] = (existing[model] || 0) + tokens; }
    } else {
      dailyModelMap.set(d.date, { ...d.tokensByModel });
    }
  }
  const mergedDailyModelTokens = Array.from(dailyModelMap.entries())
    .map(([date, tokensByModel]) => ({ date, tokensByModel }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const mergedHourCounts = { ...(stats?.hourCounts || {}) };
  for (const [hour, count] of Object.entries(supplemental.hourCounts)) {
    mergedHourCounts[hour] = (mergedHourCounts[hour] || 0) + count;
  }

  // Rate usage stats — lightweight scan of this week's sessions
  const rateUsage = computeRateUsageStats();

  return {
    totalSessions: (stats?.totalSessions || 0) + supplemental.totalSessions,
    totalMessages: (stats?.totalMessages || 0) + supplemental.totalMessages,
    totalTokens,
    estimatedCost,
    dailyActivity: mergedDailyActivity,
    dailyModelTokens: mergedDailyModelTokens,
    modelUsage: modelUsageWithCost,
    hourCounts: mergedHourCounts,
    firstSessionDate: stats?.firstSessionDate || '',
    longestSession: stats?.longestSession || { sessionId: '', duration: 0, messageCount: 0, timestamp: '' },
    projectCount: projects.length,
    recentSessions: getSessions(10),
    rateUsage,
  };
}

// ── Skill & Agent stats ────────────────────────────────────────────────────────

const SKILL_RX = /<command-name>\/([^<]+)<\/command-name>/;

/** Tool names used by Claude Code for sub-agent invocations. Older sessions use 'Task', newer use 'Agent'. */
const AGENT_TOOL_NAMES = new Set(['Task', 'Agent']);

/** Extract plain text from a message content that may be a string or an array of content blocks. */
function getMessageText(content: unknown): string {
  if (typeof content === 'string') { return content; }
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        if (!c || typeof c !== 'object') { return ''; }
        const block = c as Record<string, unknown>;
        if (block.type === 'text' && typeof block.text === 'string') { return block.text; }
        return '';
      })
      .join('\n');
  }
  return '';
}

type AgentProgressMsg = SessionMessage & {
  data?: { type?: string; agentId?: string };
  parentToolUseID?: string;
};

export function getSkillAgentStats(opts?: SkillAgentStatsOptions): SkillAgentStats {
  const { timeRange = 'all', filter } = opts || {};

  let cutoffMs = 0;
  if (timeRange !== 'all') {
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  }

  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) {
    return { totalInvocations: 0, totalCost: 0, totalAgentTokens: 0, totalSkillTokens: 0, skillCount: 0, agentCount: 0, entries: [] };
  }

  // ── Accumulators ────────────────────────────────────────────────────────────
  type SubAgentAccum  = { spawns: number; totalTokens: number; totalCost: number };
  type SessionAccum   = { invocations: number; tokens: number; cost: number; duration: number; timestamp: string; projectName: string };
  type EntryAccum = {
    type:          'skill' | 'agent';
    invocations:   number;
    totalCost:     number;
    totalTokens:   number;
    lastUsed:      string;
    totalDuration: number;
    sessionIds:    Set<string>;
    subAgentMap:   Map<string, SubAgentAccum>;
    sessions:      Map<string, SessionAccum>;
  };

  const map = new Map<string, EntryAccum>();

  function getOrCreate(name: string, type: 'skill' | 'agent'): EntryAccum {
    let e = map.get(name);
    if (!e) {
      e = { type, invocations: 0, totalCost: 0, totalTokens: 0, lastUsed: '',
            totalDuration: 0, sessionIds: new Set(), subAgentMap: new Map(), sessions: new Map() };
      map.set(name, e);
    }
    return e;
  }

  function upsertEntry(
    name: string, type: 'skill' | 'agent',
    cost: number, tokens: number, ts: string,
    sessionId: string, projectName: string, duration: number,
  ) {
    const e = getOrCreate(name, type);
    e.invocations++;
    e.totalCost     += cost;
    e.totalTokens   += tokens;
    e.totalDuration += duration;
    e.sessionIds.add(sessionId);
    if (ts > e.lastUsed) { e.lastUsed = ts; }
    // Per-session breakdown — only stored for the filtered entry to limit memory
    if (!filter || name === filter) {
      const sa = e.sessions.get(sessionId) ?? { invocations: 0, tokens: 0, cost: 0, duration: 0, timestamp: ts, projectName };
      sa.invocations++;
      sa.tokens   += tokens;
      sa.cost     += cost;
      sa.duration += duration;
      e.sessions.set(sessionId, sa);
    }
  }

  // ── Scan ─────────────────────────────────────────────────────────────────────
  for (const projectEntry of fs.readdirSync(projectsDir)) {
    const projectPath = path.join(projectsDir, projectEntry);
    try {
      if (!fs.statSync(projectPath).isDirectory()) { continue; }
    } catch { continue; }

    const projectName = projectIdToName(projectEntry);
    const jsonlFiles  = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));

    for (const file of jsonlFiles) {
      const sessionId = file.replace(/\.jsonl$/, '');
      const filePath  = path.join(projectPath, file);

      if (cutoffMs > 0) {
        try { if (fs.statSync(filePath).mtimeMs < cutoffMs) { continue; } } catch { continue; }
      }

      let lines: string[];
      try {
        lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
      } catch { continue; }

      // Pass 1: tooluId → agentId
      const tooluToAgent = new Map<string, string>();
      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as AgentProgressMsg;
          if (msg.type === 'progress' && msg.data?.type === 'agent_progress'
              && msg.data.agentId && msg.parentToolUseID) {
            tooluToAgent.set(msg.parentToolUseID, msg.data.agentId);
          }
        } catch { /* skip */ }
      }

      // Pass 2: skill windows + agent detection
      let openSkill:       string | null = null;
      let openSkillTs      = '';
      let openSkillLastTs  = '';
      let openSkillTokens  = 0;
      let openSkillCost    = 0;

      function flushSkill() {
        if (!openSkill) { return; }
        const duration = (openSkillTs && openSkillLastTs)
          ? Math.max(0, new Date(openSkillLastTs).getTime() - new Date(openSkillTs).getTime())
          : 0;
        upsertEntry(openSkill, 'skill', openSkillCost, openSkillTokens, openSkillTs, sessionId, projectName, duration);
        openSkill = null; openSkillTs = ''; openSkillLastTs = ''; openSkillTokens = 0; openSkillCost = 0;
      }

      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as SessionMessage & { isMeta?: boolean };

          if (msg.type === 'user') {
            if (!msg.isMeta) {
              const text = getMessageText(msg.message?.content);
              const m = SKILL_RX.exec(text);
              if (m) {
                flushSkill();
                openSkill  = m[1].trim();
                openSkillTs = msg.timestamp || '';
                continue;
              }
              flushSkill();
            }
          }

          if (msg.type === 'assistant' && msg.message?.usage) {
            const u = msg.message.usage;
            const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) +
              (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
            const cost = calculateCost(msg.message.model || '', u.input_tokens || 0,
              u.output_tokens || 0, u.cache_creation_input_tokens || 0, u.cache_read_input_tokens || 0);
            if (openSkill) {
              openSkillTokens += tokens;
              openSkillCost   += cost;
              if (msg.timestamp) { openSkillLastTs = msg.timestamp; }
            }
          }

          if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
            for (const c of msg.message!.content as Record<string, unknown>[]) {
              if (c.type !== 'tool_use' || !AGENT_TOOL_NAMES.has(c.name as string) || !c.input) { continue; }

              const input     = c.input as { subagent_type?: string };
              const agentType = input.subagent_type || 'unknown';
              const agentId   = tooluToAgent.get(c.id as string);

              let agentCost = 0, agentTokens = 0, agentDur = 0;
              let firstAgentTs = '', lastAgentTs = '';

              if (agentId) {
                const agentPath = path.join(projectPath, sessionId, 'subagents', `agent-${agentId}.jsonl`);
                if (fs.existsSync(agentPath)) {
                  try {
                    for (const al of fs.readFileSync(agentPath, 'utf-8').split('\n').filter(Boolean)) {
                      try {
                        const am = JSON.parse(al) as SessionMessage;
                        if (am.timestamp) {
                          if (!firstAgentTs) { firstAgentTs = am.timestamp; }
                          lastAgentTs = am.timestamp;
                        }
                        if (am.type === 'assistant' && am.message?.usage) {
                          const u = am.message.usage;
                          agentCost += calculateCost(am.message.model || '', u.input_tokens || 0,
                            u.output_tokens || 0, u.cache_creation_input_tokens || 0, u.cache_read_input_tokens || 0);
                          agentTokens += (u.input_tokens || 0) + (u.output_tokens || 0) +
                            (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
                        }
                      } catch { /* skip */ }
                    }
                    agentDur = (firstAgentTs && lastAgentTs)
                      ? Math.max(0, new Date(lastAgentTs).getTime() - new Date(firstAgentTs).getTime())
                      : 0;
                  } catch { /* skip */ }
                }
              }

              upsertEntry(agentType, 'agent', agentCost, agentTokens, msg.timestamp || '', sessionId, projectName, agentDur);

              // Track sub-agent spawns under the open skill window
              if (openSkill) {
                const skillAccum = getOrCreate(openSkill, 'skill');
                const existing = skillAccum.subAgentMap.get(agentType) ?? { spawns: 0, totalTokens: 0, totalCost: 0 };
                existing.spawns++;
                existing.totalTokens += agentTokens;
                existing.totalCost   += agentCost;
                skillAccum.subAgentMap.set(agentType, existing);
              }
            }
          }
        } catch { /* skip */ }
      }
      flushSkill();
    }
  }

  // ── Build entries ─────────────────────────────────────────────────────────
  const entries: SkillAgentEntry[] = Array.from(map.entries())
    .map(([name, a]) => {
      const subAgentBreakdown: SubAgentMetric[] = Array.from(a.subAgentMap.entries())
        .map(([t, sa]) => ({ type: t, spawns: sa.spawns, totalTokens: sa.totalTokens, totalCost: sa.totalCost,
                             avgTokens: sa.spawns > 0 ? Math.round(sa.totalTokens / sa.spawns) : 0 }))
        .sort((x, y) => y.totalCost - x.totalCost);

      const sessionBreakdown: SessionMetric[] = Array.from(a.sessions.entries())
        .map(([sid, s]) => ({ sessionId: sid, projectName: s.projectName, timestamp: s.timestamp,
                              invocations: s.invocations, tokens: s.tokens, cost: s.cost, duration: s.duration }))
        .sort((x, y) => y.timestamp.localeCompare(x.timestamp));

      return {
        name,
        type:             a.type,
        invocations:      a.invocations,
        totalCost:        a.totalCost,
        avgCost:          a.invocations > 0 ? a.totalCost / a.invocations : 0,
        totalTokens:      a.totalTokens,
        avgTokens:        a.invocations > 0 ? Math.round(a.totalTokens / a.invocations) : 0,
        lastUsed:         a.lastUsed,
        sessionCount:     a.sessionIds.size,
        totalDuration:    a.totalDuration,
        avgDuration:      a.invocations > 0 ? Math.round(a.totalDuration / a.invocations) : 0,
        subAgentSpawns:   Array.from(a.subAgentMap.values()).reduce((s, sa) => s + sa.spawns, 0),
        subAgentBreakdown,
        sessionBreakdown,
      };
    })
    .sort((a, b) => b.totalCost - a.totalCost || b.invocations - a.invocations);

  const skillCount = new Set(entries.filter(e => e.type === 'skill').map(e => e.name)).size;
  const agentCount = new Set(entries.filter(e => e.type === 'agent').map(e => e.name)).size;

  return {
    totalInvocations: entries.reduce((s, e) => s + e.invocations, 0),
    totalCost:        entries.reduce((s, e) => s + e.totalCost, 0),
    totalAgentTokens: entries.filter(e => e.type === 'agent').reduce((s, e) => s + e.totalTokens, 0),
    totalSkillTokens: entries.filter(e => e.type === 'skill').reduce((s, e) => s + e.totalTokens, 0),
    skillCount,
    agentCount,
    entries,
  };
}

// ── Agent tree ────────────────────────────────────────────────────────────────

function buildAgentTree(
  filePath: string,
  projectPath: string,
  sessionId: string,
  sessionInfo: SessionInfo,
): AgentTreeNode {
  let lines: string[];
  try {
    lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  } catch {
    lines = [];
  }

  // Build tooluId → agentId from progress messages
  const tooluToAgent = new Map<string, string>();
  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as AgentProgressMsg;
      if (
        msg.type === 'progress' &&
        msg.data?.type === 'agent_progress' &&
        msg.data.agentId &&
        msg.parentToolUseID
      ) {
        tooluToAgent.set(msg.parentToolUseID, msg.data.agentId);
      }
    } catch { /* skip */ }
  }

  const parentTokens =
    sessionInfo.totalInputTokens +
    sessionInfo.totalOutputTokens +
    sessionInfo.totalCacheReadTokens +
    sessionInfo.totalCacheWriteTokens;

  // ── Helper: load agent node from its JSONL ──────────────────────────────
  function loadAgentNode(agentId: string, agentType: string, idx: number): AgentTreeNode {
    const agentPath = path.join(projectPath, sessionId, 'subagents', `agent-${agentId}.jsonl`);
    let agentTokens = 0, agentCost = 0, agentModel = '';
    if (fs.existsSync(agentPath)) {
      try {
        for (const al of fs.readFileSync(agentPath, 'utf-8').split('\n').filter(Boolean)) {
          try {
            const am = JSON.parse(al) as SessionMessage;
            if (am.type === 'assistant' && am.message?.usage) {
              const u = am.message.usage;
              agentTokens += (u.input_tokens || 0) + (u.output_tokens || 0) +
                (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
              agentCost += calculateCost(am.message.model || '', u.input_tokens || 0,
                u.output_tokens || 0, u.cache_creation_input_tokens || 0, u.cache_read_input_tokens || 0);
              if (!agentModel && am.message.model) { agentModel = am.message.model; }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    return { id: agentId || `unknown-${idx}`, label: agentType, type: 'agent', tokens: agentTokens, cost: agentCost, model: agentModel || undefined, children: [] };
  }

  // ── Skill-window scan: detect skills and attribute agents to them ────────
  type SkillAccum = { name: string; tokens: number; cost: number; invocations: number; agentNodes: AgentTreeNode[] };

  const skillMap = new Map<string, SkillAccum>();   // skill name → accum (merged across re-invocations for tree)
  const skillOrder: string[] = [];                  // ordered first-seen skill names
  let openSkill: SkillAccum | null = null;
  const claimedAgentIds = new Set<string>();
  const directAgentNodes: AgentTreeNode[] = [];

  let agentIdx = 0;
  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as SessionMessage & { isMeta?: boolean };

      if (msg.type === 'user') {
        if (!msg.isMeta) {
          const text = getMessageText(msg.message?.content);
          const m = SKILL_RX.exec(text);
          if (m) {
            const name = m[1].trim();
            if (!skillMap.has(name)) {
              skillMap.set(name, { name, tokens: 0, cost: 0, invocations: 0, agentNodes: [] });
              skillOrder.push(name);
            }
            openSkill = skillMap.get(name)!;
            openSkill.invocations++;
            continue;
          }
        }
        if (!msg.isMeta) { openSkill = null; }
      }

      if (msg.type === 'assistant') {
        // Accumulate tokens into open skill
        if (openSkill && msg.message?.usage) {
          const u = msg.message.usage;
          openSkill.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) +
            (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          openSkill.cost += calculateCost(msg.message.model || '', u.input_tokens || 0,
            u.output_tokens || 0, u.cache_creation_input_tokens || 0, u.cache_read_input_tokens || 0);
        }

        // Detect Task tool_use
        if (Array.isArray(msg.message?.content)) {
          for (const c of msg.message!.content as Record<string, unknown>[]) {
            if (c.type !== 'tool_use' || !AGENT_TOOL_NAMES.has(c.name as string)) { continue; }
            const input     = c.input as { subagent_type?: string } | undefined;
            const agentType = input?.subagent_type || 'unknown';
            const agentId   = tooluToAgent.get(c.id as string) ?? `unknown-${agentIdx}`;
            const node      = loadAgentNode(agentId, agentType, agentIdx++);

            if (openSkill) {
              openSkill.agentNodes.push(node);
              claimedAgentIds.add(agentId);
            } else {
              directAgentNodes.push(node);
            }
          }
        }
      }
    } catch { /* skip */ }
  }

  // ── Build children: skill nodes (with their agents) + unclaimed agents ──
  const children: AgentTreeNode[] = [];

  for (const name of skillOrder) {
    const s = skillMap.get(name)!;
    children.push({
      id:          `skill-${name}`,
      label:       name,
      type:        'skill',
      tokens:      s.tokens,
      cost:        s.cost,
      invocations: s.invocations,
      children:    s.agentNodes,
    });
  }

  for (const node of directAgentNodes) {
    if (!claimedAgentIds.has(node.id)) { children.push(node); }
  }

  return {
    id: 'root',
    label: 'Parent Session',
    type: 'root',
    tokens: parentTokens,
    cost: sessionInfo.estimatedCost,
    model: sessionInfo.model,
    children,
  };
}

export async function getSessionDetailV2(sessionId: string): Promise<SessionDetailV2 | null> {
  if (!fs.existsSync(getProjectsDir())) { return null; }
  const projectEntries = fs.readdirSync(getProjectsDir());

  for (const entry of projectEntries) {
    const projectPath = path.join(getProjectsDir(), entry);
    if (!fs.statSync(projectPath).isDirectory()) { continue; }

    const filePath = path.join(projectPath, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) { continue; }

    const sessionInfo = parseSessionFile(filePath, entry, projectIdToName(entry));
    const { skillsInSession, agentsInSession } = parseSessionSkillAgents(filePath, projectPath, sessionInfo.id);
    const agentTree = buildAgentTree(filePath, projectPath, sessionId, sessionInfo);
    const messages: SessionMessageDisplay[] = [];

    // ── Tool metrics accumulators ─────────────────────────────────────────
    // Maps tool_use_id → { name, timestamp, inputEstTokens }
    const pendingTools = new Map<string, { name: string; ts: string; inputEst: number; model: string; actualTokens: number; actualCost: number }>();
    // Per-tool accumulator: name → { count, totalMs, tokens, actualTokens, actualCost, models }
    const toolAccum = new Map<string, { count: number; totalMs: number; tokens: number; actualTokens: number; actualCost: number; models: Set<string> }>();

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) { continue; }
      try {
        const msg = JSON.parse(line) as SessionMessage;

        if (msg.type === 'user' && msg.message?.role === 'user') {
          const content = msg.message.content;
          let text = '';
          if (typeof content === 'string') {
            text = content;
          } else if (Array.isArray(content)) {
            for (const c of content as Record<string, unknown>[]) {
              if (c.type === 'text') {
                text += (c.text as string ?? '');
              } else if (c.type === 'tool_result') {
                // Compute duration and output token estimate
                const toolUseId = c.tool_use_id as string | undefined;
                const pending   = toolUseId ? pendingTools.get(toolUseId) : undefined;
                const resultContent = typeof c.content === 'string'
                  ? c.content
                  : JSON.stringify(c.content ?? '');
                const outputEst = Math.round(resultContent.length / 4);

                if (pending && msg.timestamp && pending.ts) {
                  const durationMs = Math.max(0, new Date(msg.timestamp).getTime() - new Date(pending.ts).getTime());
                  const existing = toolAccum.get(pending.name) ?? { count: 0, totalMs: 0, tokens: 0, actualTokens: 0, actualCost: 0, models: new Set<string>() };
                  existing.count        += 1;
                  existing.totalMs      += durationMs;
                  existing.tokens       += pending.inputEst + outputEst;
                  existing.actualTokens += pending.actualTokens;
                  existing.actualCost   += pending.actualCost;
                  if (pending.model) { existing.models.add(pending.model); }
                  toolAccum.set(pending.name, existing);
                  pendingTools.delete(toolUseId!);
                }
              }
            }
          }
          if (text.trim()) {
            messages.push({ role: 'user', content: text.trim(), timestamp: msg.timestamp });
          }
        }

        if (msg.type === 'assistant' && msg.message?.content) {
          const content = msg.message.content;
          const toolCalls: { name: string; id: string }[] = [];
          let text = '';
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c && typeof c === 'object') {
                const cc = c as Record<string, unknown>;
                if (cc.type === 'text') {
                  text += (cc.text as string) + '\n';
                } else if (cc.type === 'tool_use') {
                  const toolId  = (cc.id as string) || '';
                  const toolName = cc.name as string;
                  const inputEst = Math.round(JSON.stringify(cc.input ?? {}).length / 4);
                  toolCalls.push({ name: toolName, id: toolId });
                  // Attribute the assistant turn's API tokens/cost to each tool_use in it
                  const turnModel = msg.message?.model || '';
                  const turnUsage = msg.message?.usage;
                  const toolCountInTurn = Array.isArray(content)
                    ? (content as Record<string, unknown>[]).filter(b => b && typeof b === 'object' && (b as Record<string, unknown>).type === 'tool_use').length
                    : 1;
                  let actualTokens = 0;
                  let actualCost = 0;
                  if (turnUsage && toolCountInTurn > 0) {
                    const total = (turnUsage.input_tokens || 0) + (turnUsage.output_tokens || 0) +
                      (turnUsage.cache_read_input_tokens || 0) + (turnUsage.cache_creation_input_tokens || 0);
                    // Split proportionally across tools in this turn
                    actualTokens = Math.round(total / toolCountInTurn);
                    actualCost = calculateCost(turnModel,
                      Math.round((turnUsage.input_tokens || 0) / toolCountInTurn),
                      Math.round((turnUsage.output_tokens || 0) / toolCountInTurn),
                      Math.round((turnUsage.cache_creation_input_tokens || 0) / toolCountInTurn),
                      Math.round((turnUsage.cache_read_input_tokens || 0) / toolCountInTurn));
                  }
                  if (toolId && msg.timestamp) {
                    pendingTools.set(toolId, { name: toolName, ts: msg.timestamp, inputEst, model: turnModel, actualTokens, actualCost });
                  }
                }
              }
            }
          }
          if (text.trim() || toolCalls.length > 0) {
            messages.push({
              role: 'assistant',
              content: text.trim() || `[Used ${toolCalls.length} tool(s): ${toolCalls.map(t => t.name).join(', ')}]`,
              timestamp: msg.timestamp,
              model: msg.message.model,
              usage: msg.message.usage as TokenUsage | undefined,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            });
          }
        }
      } catch { /* skip malformed lines */ }
    }

    // ── Build toolMetrics ─────────────────────────────────────────────────
    const byTool: ToolMetricEntry[] = Array.from(toolAccum.entries())
      .map(([name, a]) => ({
        name,
        count:           a.count,
        totalDurationMs: a.totalMs,
        avgDurationMs:   a.count > 0 ? Math.round(a.totalMs / a.count) : 0,
        estimatedTokens: a.tokens,
        actualTokens:    a.actualTokens,
        actualCost:      a.actualCost,
        models:          Array.from(a.models),
      }))
      .sort((x, y) => y.actualTokens - x.actualTokens || y.totalDurationMs - x.totalDurationMs);

    const toolMetrics: ToolMetrics = {
      totalDurationMs:  byTool.reduce((s, e) => s + e.totalDurationMs, 0),
      estimatedTokens:  byTool.reduce((s, e) => s + e.estimatedTokens, 0),
      byTool,
    };

    return { ...sessionInfo, messages, skillsInSession, agentsInSession, agentTree, toolMetrics };
  }

  return null;
}

// ── Session list (lightweight, no messages) ───────────────────────────────────

export function getSessionList(opts?: { query?: string; limit?: number; offset?: number }): {
  sessions: SessionInfo[];
  total: number;
} {
  const { query, limit = 50, offset = 0 } = opts || {};
  // Cap the backing scan — no need to load 1000 sessions when only showing 50
  const scanLimit = Math.min(offset + limit + 50, 500);
  const all = query ? searchSessions(query, scanLimit) : getSessions(scanLimit, 0);
  return {
    sessions: all.slice(offset, offset + limit),
    total: all.length,
  };
}

// ── CSV export for cost tracking ──────────────────────────────────────────────

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function generateSessionsCsv(): string {
  const sessions = getSessions(10000, 0);
  const headers = [
    'Session ID', 'Project', 'Timestamp', 'Duration (min)', 'Messages',
    'Input Tokens', 'Output Tokens', 'Cache Read Tokens', 'Cache Write Tokens',
    'Estimated Cost (USD)', 'Model', 'Git Branch', 'First Message',
  ];
  const rows = sessions.map(s => [
    s.id,
    csvEscape(s.projectName),
    s.timestamp,
    (s.duration / 60000).toFixed(1),
    s.messageCount.toString(),
    s.totalInputTokens.toString(),
    s.totalOutputTokens.toString(),
    s.totalCacheReadTokens.toString(),
    s.totalCacheWriteTokens.toString(),
    s.estimatedCost.toFixed(4),
    s.model,
    csvEscape(s.gitBranch || ''),
    csvEscape(s.firstMessage || ''),
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ── Cost optimization analysis via Claude API ─────────────────────────────────

function getAnthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || null;
}

function callAnthropicApi(body: string): Promise<string> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) { return Promise.reject(new Error('ANTHROPIC_API_KEY not set. Set it in your environment to use cost analysis.')); }

  return new Promise((resolve, reject) => {
    const data = Buffer.from(body, 'utf-8');
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': data.length,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const responseText = Buffer.concat(chunks).toString('utf-8');
        try {
          const json = JSON.parse(responseText);
          if (json.error) { reject(new Error(json.error.message || 'API error')); return; }
          const text = json.content?.[0]?.text || '';
          resolve(text);
        } catch { reject(new Error('Failed to parse API response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('API request timed out')); });
    req.write(data);
    req.end();
  });
}

export async function analyzeCostOptimization(sessionId: string): Promise<CostAnalysis> {
  const detail = await getSessionDetailV2(sessionId);
  if (!detail) { throw new Error('Session not found'); }

  const toolData = detail.toolMetrics.byTool.map(t => ({
    tool: t.name,
    calls: t.count,
    tokens: t.actualTokens,
    cost: Math.round(t.actualCost * 10000) / 10000,
    models: t.models,
    avgDurationMs: t.avgDurationMs,
  }));

  const skillData = (detail.skillsInSession || []).map(s => ({
    skill: s.name,
    invocations: s.invocations,
    tokens: s.tokens,
    cost: Math.round(s.cost * 10000) / 10000,
  }));

  const sessionSummary = {
    totalCost: Math.round(detail.estimatedCost * 10000) / 10000,
    totalTokens: detail.totalInputTokens + detail.totalOutputTokens + detail.totalCacheReadTokens + detail.totalCacheWriteTokens,
    models: detail.models,
    duration: detail.duration,
    toolCallCount: detail.toolCallCount,
    messageCount: detail.messageCount,
  };

  const prompt = `Analyze this Claude Code session's tool and skill usage for cost optimization. Identify which tools or operations could have used a cheaper model (e.g. Haiku instead of Sonnet/Opus) without sacrificing quality.

Session summary: ${JSON.stringify(sessionSummary)}

Per-tool breakdown:
${JSON.stringify(toolData, null, 2)}

Skills used:
${JSON.stringify(skillData, null, 2)}

Model pricing reference:
- Opus: $15/M input, $75/M output (most capable, use for complex reasoning)
- Sonnet: $3/M input, $15/M output (balanced, good for most coding tasks)
- Haiku: $0.80/M input, $4/M output (fastest, good for simple/mechanical tasks)

Respond ONLY with a JSON object (no markdown fences) in this exact format:
{
  "suggestions": [
    {
      "toolName": "ToolName",
      "currentModel": "Current model family",
      "suggestedModel": "Cheaper model",
      "reason": "Brief reason why this tool could use a cheaper model",
      "estimatedSavings": 60,
      "tokenCount": 12345,
      "callCount": 5
    }
  ],
  "summary": "One paragraph summary of cost optimization opportunities",
  "totalPotentialSavings": "e.g. ~$0.45 (30%)"
}

Only suggest downgrades for tools where quality would genuinely not suffer. Tools like Read, Glob, Grep, Write, Edit, Bash (for simple commands) are often fine with Haiku. Complex reasoning, planning, and code generation usually need Sonnet or Opus. If no meaningful savings are possible, return empty suggestions array with a summary explaining why.`;

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const response = await callAnthropicApi(body);

  try {
    // Try to extract JSON from the response (handles markdown fences too)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { throw new Error('No JSON in response'); }
    const analysis = JSON.parse(jsonMatch[0]) as CostAnalysis;
    // Validate structure
    if (!Array.isArray(analysis.suggestions)) { analysis.suggestions = []; }
    if (!analysis.summary) { analysis.summary = 'Analysis complete.'; }
    if (!analysis.totalPotentialSavings) { analysis.totalPotentialSavings = 'N/A'; }
    return analysis;
  } catch {
    return {
      suggestions: [],
      summary: response.slice(0, 500),
      totalPotentialSavings: 'N/A',
    };
  }
}
