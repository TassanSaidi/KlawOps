# Changelog

## [0.1.2] — 2026-03-05

### Fixed

- **`@types/express` moved from `dependencies` to `devDependencies`** — Type packages should not ship in the production bundle.
- **`package.json` repository URL corrected** — Changed `tonderaisaidi/klawops` to `TassanSaidi/KlawOps` to match the actual GitHub repo.

### Added

- **CSV export for cost tracking** — "Export CSV" button on the Dashboard exports all sessions with timestamps, token counts, costs, models, branches, and first messages. Also available as `/api/export/csv` in standalone server mode.

### Notes

- **Token estimate sanity check** — The `estimatedTokens` on tool metrics uses a `chars / 4` heuristic for tool I/O, which is reasonable for English text/JSON. These are only used for relative tool usage display, not for cost calculation (which uses accurate API-reported token counts).

### Known issues (nice-to-haves for future)

- No React error boundary — a rendering crash white-screens the entire panel

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

## [0.1.0] — 2026-03-03

### Added

- **Live status bar** — shows cost and token count of the most recent Claude Code session; updates in real time via file watching
- **Session browser** — tree view of projects → sessions in the VS Code Activity Bar; click any session to open a conversation replay WebView
- **Conversation replay** — full message history with role icons, model badges, per-turn token usage, tool call badges, context compaction timeline, and token breakdown sidebar
- **Analytics dashboard** — command-palette WebView with stat cards (sessions, messages, tokens, cost), Usage Over Time chart, Model Usage donut, Activity Heatmap, Peak Hours bar chart, and Recent Sessions table
- **Skills panel** — sidebar listing four bundled workflow commands (`research_codebase_generic`, `create_plan_generic`, `implement_plan`, `validate_plan`) and four sub-agents (`codebase-analyzer`, `codebase-locator`, `codebase-pattern-finder`, `web-search-researcher`); per-skill install to workspace or global scope
- **First-run notification** — offers to install all skills globally when none are installed
- **`klawops.claudeDir` setting** — override the default `~/.claude` data directory
