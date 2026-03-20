export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface DailyModelTokens {
  date: string;
  tokensByModel: Record<string, number>;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
  webSearchRequests: number;
}

export interface LongestSession {
  sessionId: string;
  duration: number;
  messageCount: number;
  timestamp: string;
}

export interface StatsCache {
  version: number;
  lastComputedDate: string;
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  modelUsage: Record<string, ModelUsage>;
  totalSessions: number;
  totalMessages: number;
  longestSession: LongestSession;
  firstSessionDate: string;
  hourCounts: Record<string, number>;
  totalSpeculationTimeSavedMs: number;
}

export interface HistoryEntry {
  display: string;
  pastedContents: Record<string, unknown>;
  timestamp: number;
  project: string;
}

export interface CompactMetadata {
  trigger: string;
  preTokens: number;
}

export interface MicrocompactMetadata {
  trigger: string;
  preTokens: number;
  tokensSaved: number;
  compactedToolIds: string[];
  clearedAttachmentUUIDs: string[];
}

export interface SessionMessage {
  type: 'user' | 'assistant' | 'progress' | 'system' | 'file-history-snapshot';
  sessionId: string;
  timestamp: string;
  uuid: string;
  parentUuid: string | null;
  cwd: string;
  version: string;
  gitBranch: string;
  compactMetadata?: CompactMetadata;
  microcompactMetadata?: MicrocompactMetadata;
  isCompactSummary?: boolean;
  message?: {
    role: string;
    model?: string;
    content: unknown;
    usage?: TokenUsage;
    stop_reason?: string | null;
  };
  data?: {
    type: string;
    elapsedTimeMs?: number;
    toolName?: string;
    serverName?: string;
    statusMessage?: string;
  };
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
  service_tier?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  sessionCount: number;
  totalMessages: number;
  totalTokens: number;
  estimatedCost: number;
  lastActive: string;
  models: string[];
}

export interface CompactionInfo {
  compactions: number;
  microcompactions: number;
  totalTokensSaved: number;
  compactionTimestamps: string[];
}

export interface SessionInfo {
  id: string;
  projectId: string;
  projectName: string;
  timestamp: string;
  duration: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  estimatedCost: number;
  model: string;
  models: string[];
  gitBranch: string;
  cwd: string;
  version: string;
  toolsUsed: Record<string, number>;
  compaction: CompactionInfo;
  /** Truncated first user message for preview in session list. */
  firstMessage: string;
}

export interface SessionSkillEntry {
  name: string;
  invocations: number;
  tokens: number;
  cost: number;
}

export interface SessionAgentEntry {
  type: string;
  invocations: number;
  tokens: number;
  cost: number;
}

export interface SessionDetail extends SessionInfo {
  messages: SessionMessageDisplay[];
  skillsInSession: SessionSkillEntry[];
  agentsInSession: SessionAgentEntry[];
}

export interface SessionMessageDisplay {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  model?: string;
  usage?: TokenUsage;
  toolCalls?: { name: string; id: string }[];
}

export interface DashboardStats {
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  estimatedCost: number;
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  modelUsage: Record<string, ModelUsage & { estimatedCost: number }>;
  hourCounts: Record<string, number>;
  firstSessionDate: string;
  longestSession: LongestSession;
  projectCount: number;
  recentSessions: SessionInfo[];
  rateUsage?: RateUsageStats;
}

export interface SubAgentMetric {
  type: string;
  spawns: number;
  totalTokens: number;
  totalCost: number;
  avgTokens: number;
}

export interface SessionMetric {
  sessionId: string;
  projectName: string;
  timestamp: string;
  invocations: number;
  tokens: number;
  cost: number;
  duration: number;
}

export interface SkillAgentStatsOptions {
  timeRange?: '7d' | '30d' | '90d' | 'all';
  filter?: string;
}

export interface SkillAgentEntry {
  name: string;
  type: 'skill' | 'agent';
  invocations: number;
  totalCost: number;
  avgCost: number;
  totalTokens: number;
  avgTokens: number;
  lastUsed: string;
  sessionCount: number;
  totalDuration: number;
  avgDuration: number;
  subAgentSpawns: number;
  subAgentBreakdown: SubAgentMetric[];
  sessionBreakdown: SessionMetric[];
}

export interface SkillAgentStats {
  totalInvocations: number;
  totalCost: number;
  totalAgentTokens: number;
  totalSkillTokens: number;
  skillCount: number;
  agentCount: number;
  entries: SkillAgentEntry[];
}

// ── Agent tree (for session detail Overview tab) ───────────────────────────────

export interface AgentTreeNode {
  id: string;
  label: string;
  type: 'root' | 'agent' | 'skill';
  tokens: number;
  cost: number;
  model?: string;
  duration?: number;
  invocations?: number;   // skills only
  children: AgentTreeNode[];
}

// ── Tool metrics (per session detail) ────────────────────────────────────────

export interface ToolMetricEntry {
  name: string;
  count: number;
  totalDurationMs: number;
  avgDurationMs: number;
  estimatedTokens: number;  // rough: (input JSON chars + output chars) / 4
}

export interface ToolMetrics {
  totalDurationMs: number;  // wall-clock time spent waiting for tools
  estimatedTokens: number;  // total estimated tokens for all tool I/O
  byTool: ToolMetricEntry[];
}

// ── Session detail with agent tree ───────────────────────────────────────────

export interface SessionDetailV2 extends SessionDetail {
  agentTree: AgentTreeNode;
  toolMetrics: ToolMetrics;
}

// ── Rate usage limits ─────────────────────────────────────────────────────────

export interface RateUsageBucket {
  /** ISO date or ISO datetime string for the bucket start */
  start: string;
  /** ISO date or ISO datetime string for the bucket end */
  end: string;
  /** Total tokens consumed in this bucket */
  tokens: number;
  /** Total cost in this bucket */
  cost: number;
  /** Number of API calls in this bucket */
  calls: number;
}

export interface RateUsageStats {
  /** Hourly buckets for the current week (up to 168 buckets, timezone-adjusted) */
  weeklyBuckets: RateUsageBucket[];
  /** Per-session usage for active sessions today */
  sessionBuckets: RateUsageBucket[];
  /** Total tokens this week */
  weeklyTokens: number;
  /** Total cost this week */
  weeklyCost: number;
  /** Total calls this week */
  weeklyCalls: number;
  /** ISO timestamp of when the weekly window resets (next Monday 00:00 in user's timezone) */
  weeklyResetAt: string;
  /** Peak hourly token usage this week */
  peakHourlyTokens: number;
  /** Current hour's token usage */
  currentHourTokens: number;
}

// ── Unified message types ─────────────────────────────────────────────────────

export type UnifiedRequest =
  | { type: 'REQUEST_STATS' }
  | { type: 'REQUEST_SESSION_LIST'; query?: string; limit?: number; offset?: number }
  | { type: 'REQUEST_SESSION_DETAIL'; sessionId: string }
  | { type: 'REQUEST_SKILLS_STATS'; timeRange?: string; filter?: string };

export type UnifiedResponse =
  | { type: 'STATS_DATA'; payload: DashboardStats }
  | { type: 'STATS_ERROR'; message: string }
  | { type: 'SESSION_LIST_DATA'; payload: { sessions: SessionInfo[]; total: number } }
  | { type: 'SESSION_LIST_ERROR'; message: string }
  | { type: 'SESSION_DETAIL_DATA'; payload: SessionDetailV2 }
  | { type: 'SESSION_DETAIL_ERROR'; message: string }
  | { type: 'SKILLS_STATS_DATA'; payload: SkillAgentStats }
  | { type: 'SKILLS_STATS_ERROR'; message: string }
  | { type: 'NAVIGATE'; tab: string; sessionId?: string; skillFilter?: string };

export interface CustomSkillConfig {
  name: string;
  type: 'command' | 'agent';
  description?: string;
  matchPattern?: string;
}

export interface CustomSkillsFile {
  skills: CustomSkillConfig[];
}
