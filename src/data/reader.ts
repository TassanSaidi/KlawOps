import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
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
      const stat = fs.statSync(filePath);
      const mtime = stat.mtime.toISOString();
      if (!lastActive || mtime > lastActive) { lastActive = mtime; }

      const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as SessionMessage;
          if (msg.type === 'user') { totalMessages++; }
          if (msg.type === 'assistant') {
            totalMessages++;
            const model = msg.message?.model || '';
            if (model) { modelsSet.add(model); }
            const usage = msg.message?.usage;
            if (usage) {
              const tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0) +
                (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
              totalTokens += tokens;
              estimatedCost += calculateCost(
                model,
                usage.input_tokens || 0,
                usage.output_tokens || 0,
                usage.cache_creation_input_tokens || 0,
                usage.cache_read_input_tokens || 0
              );
            }
          }
        } catch { /* skip malformed lines */ }
      }
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
      models: Array.from(modelsSet).map(getModelDisplayName),
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
    .map(file => parseSessionFile(path.join(projectPath, file), projectId, projectIdToName(projectId)))
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
      allSessions.push(parseSessionFile(path.join(projectPath, file), entry, projectIdToName(entry)));
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
  return parseSessionFile(newestFile, newestProjectId, projectIdToName(newestProjectId));
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
        if (!msg.isMeta && typeof msg.message?.content === 'string') {
          const m = SKILL_RX.exec(msg.message.content);
          if (m) { flushSkill(); openSkill = m[1].trim(); continue; }
        }
        if (!msg.isMeta) { flushSkill(); }
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
          if (c.type === 'tool_use' && (c.name as string) === 'Task' && c.input && typeof c.input === 'object') {
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
    const { skillsInSession, agentsInSession } = parseSessionSkillAgents(filePath, entry, sessionInfo.id);
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

    const jsonlFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
    for (const file of jsonlFiles) {
      const filePath = path.join(projectPath, file);
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
        matchingSessions.push(parseSessionFile(filePath, entry, projectIdToName(entry)));
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
  };
}

// ── Skill & Agent stats ────────────────────────────────────────────────────────

const SKILL_RX = /<command-name>\/([^<]+)<\/command-name>/;

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
            if (!msg.isMeta && typeof msg.message?.content === 'string') {
              const m = SKILL_RX.exec(msg.message.content);
              if (m) {
                flushSkill();
                openSkill  = m[1].trim();
                openSkillTs = msg.timestamp || '';
                continue;
              }
            }
            if (!msg.isMeta) { flushSkill(); }
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
              if (c.type !== 'tool_use' || (c.name as string) !== 'Task' || !c.input) { continue; }

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
        if (!msg.isMeta && typeof msg.message?.content === 'string') {
          const m = SKILL_RX.exec(msg.message.content);
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
            if (c.type !== 'tool_use' || (c.name as string) !== 'Task') { continue; }
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
    const { skillsInSession, agentsInSession } = parseSessionSkillAgents(filePath, entry, sessionInfo.id);
    const agentTree = buildAgentTree(filePath, projectPath, sessionId, sessionInfo);
    const messages: SessionMessageDisplay[] = [];

    // ── Tool metrics accumulators ─────────────────────────────────────────
    // Maps tool_use_id → { name, timestamp, inputEstTokens }
    const pendingTools = new Map<string, { name: string; ts: string; inputEst: number }>();
    // Per-tool accumulator: name → { count, totalMs, tokens }
    const toolAccum = new Map<string, { count: number; totalMs: number; tokens: number }>();

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
                  const existing = toolAccum.get(pending.name) ?? { count: 0, totalMs: 0, tokens: 0 };
                  existing.count   += 1;
                  existing.totalMs += durationMs;
                  existing.tokens  += pending.inputEst + outputEst;
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
                  if (toolId && msg.timestamp) {
                    pendingTools.set(toolId, { name: toolName, ts: msg.timestamp, inputEst });
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
      }))
      .sort((x, y) => y.totalDurationMs - x.totalDurationMs);

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
  const all = query ? searchSessions(query, 1000) : getSessions(1000, 0);
  return {
    sessions: all.slice(offset, offset + limit),
    total: all.length,
  };
}
