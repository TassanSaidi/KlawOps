# Changelog

## [0.1.1] — 2026-03-04

### Fixed

- **PeakHours chart showed 0 for hours 0–9** — `hourCounts` keys are zero-padded (`"00"`, `"09"`) but the chart looked them up unpadded (`"0"`, `"9"`). Morning hours always displayed zero activity.
- **Sub-agent detection missed current Claude Code sessions** — Code only matched tool name `'Task'` but Claude Code now uses `'Agent'`. Agent tree, sub-agent metrics, and per-session agent breakdowns were silently empty for all recent sessions. Now supports both names.
- **Per-session agent data always zero** — `parseSessionSkillAgents()` received a bare directory name instead of the full project path, so the sub-agent JSONL file path never resolved correctly.
- **Status bar token count excluded cache tokens** — Displayed `totalInputTokens + totalOutputTokens` but omitted cache read/write tokens, which are a major portion of usage and already factored into cost.
- **Missing `claude-sonnet-4-5-20250514` from pricing table** — Sessions using the original Sonnet 4.5 fell through to a fuzzy fallback instead of an exact match.
- **Inconsistent `formatCost` across webview tabs** — DashboardTab showed `$0.0000` for zero-cost items while SessionsTab/SkillsTab showed `$0.00`. Normalized to `$0.00`.
- **Sessions tab didn't auto-refresh** — File watcher pushed dashboard and skills stats but not the session list. Now pushes session list updates on file change.

### Added

- **Load More pagination in Sessions tab** — Previously only the first 50 sessions loaded with no way to see more. Now shows a "Load more (N remaining)" button.

### Known issues (nice-to-haves for future)

- `findClosestPricing` silently falls back to Sonnet pricing for completely unknown model IDs — should warn or return 0
- `formatCost`, `formatTokens`, `formatDuration`, `timeAgo`, etc. are copy-pasted across every webview tab — should be a shared module
- `getProjects()` and `getSessions()` read every JSONL file synchronously — will block the extension host for large session directories
- No React error boundary — a rendering crash white-screens the entire panel
- Session search only matches message content, not project name or branch
- No CSV export for cost tracking
- `@types/express` is in `dependencies` instead of `devDependencies`
- `package.json` repository URL uses `tonderaisaidi/klawops` but actual repo is `TassanSaidi/KlawOps`

## [0.1.0] — 2026-03-03

### Added

- **Live status bar** — shows cost and token count of the most recent Claude Code session; updates in real time via file watching
- **Session browser** — tree view of projects → sessions in the VS Code Activity Bar; click any session to open a conversation replay WebView
- **Conversation replay** — full message history with role icons, model badges, per-turn token usage, tool call badges, context compaction timeline, and token breakdown sidebar
- **Analytics dashboard** — command-palette WebView with stat cards (sessions, messages, tokens, cost), Usage Over Time chart, Model Usage donut, Activity Heatmap, Peak Hours bar chart, and Recent Sessions table
- **Skills panel** — sidebar listing four bundled workflow commands (`research_codebase_generic`, `create_plan_generic`, `implement_plan`, `validate_plan`) and four sub-agents (`codebase-analyzer`, `codebase-locator`, `codebase-pattern-finder`, `web-search-researcher`); per-skill install to workspace or global scope
- **First-run notification** — offers to install all skills globally when none are installed
- **`klawops.claudeDir` setting** — override the default `~/.claude` data directory
