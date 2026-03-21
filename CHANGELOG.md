# Changelog

## [0.2.0] — 2026-03-20 — Lean Edition

### Performance — RAM reduction

- **Debounced file watcher cascades** — Rapid sequential JSONL writes (e.g. during a single Claude turn) are now coalesced into a single refresh cycle with a 1-second debounce, preventing cascading recomputes of dashboard stats, session lists, and skills stats on every write.
- **Debounced `pushUpdate()`** — Background webview data pushes are debounced at 1.5 seconds. Skills stats are no longer pushed on every file change (fetched on-demand when the tab is active instead).
- **LRU-capped session metadata cache** — `_sessionMetaCache` is now capped at 500 entries with LRU eviction, preventing unbounded memory growth when scanning large session stores.
- **Lazy tab data loading** — Only the Dashboard tab fetches data on initial mount. Sessions and Skills tabs are lazy-loaded on first visit. Session detail data is released when navigating away from the Sessions tab.
- **Paginated message rendering** — Session detail messages are now rendered in pages of 50 instead of mounting all 500+ DOM nodes at once, with a "Show more" button for incremental loading.
- **Memoized expensive React components** — `AgentTreeGraph` and `MessageItem` are now wrapped in `React.memo` to prevent unnecessary re-renders when parent state changes.
- **Bounded full-text search** — Session search skips files larger than 512 KB for full-text content matching, preventing large session files from blocking the search path.
- **Capped session list scan** — `getSessionList()` now scans at most 500 sessions (down from 1000), reducing memory and I/O overhead for the common case of viewing 50 sessions at a time.

### Added

- **Per-tool token & cost breakdown** — The session detail overview now shows a comprehensive `ToolTokenBreakdown` component replacing the old `ToolsUsed` and `ToolMetricsCard` widgets. Each tool displays actual token count, cost attribution, model badges, and proportional stacked bar visualization. Sortable by tokens, cost, call count, or duration.
- **Cost optimization analysis (lazy-loaded)** — New `CostAnalysisCard` lets you ask Claude (via Haiku) which tools in a session could have used a cheaper model. Shows per-tool suggestions with current→suggested model, estimated savings percentage, and reasoning. Lazy: only runs when the user clicks "Analyze". Available in both VS Code extension and standalone server mode.
- **Timezone-aware rate usage limits visualization** — New "Rate Usage" card on the Dashboard shows real-time token, cost, and API call consumption for the current week. Includes:
  - **Weekly view**: progress bars for weekly and current-hour token usage against reference limits, daily breakdown bar chart, and week reset countdown — all adjusted to the selected timezone.
  - **Session view**: per-session token usage for today's active sessions with progress bars and timestamps, showing session-level rate consumption at a glance.

## [0.1.2] — 2026-03-05

### Fixed

- **`@types/express` moved from `dependencies` to `devDependencies`** — Type packages should not ship in the production bundle.
- **`package.json` repository URL corrected** — Changed `tonderaisaidi/klawops` to `TassanSaidi/KlawOps` to match the actual GitHub repo.

### Added

- **CSV export for cost tracking** — "Export CSV" button on the Dashboard exports all sessions with timestamps, token counts, costs, models, branches, and first messages. Also available as `/api/export/csv` in standalone server mode.

### Fixed

- **Install script now works before any GitHub Release exists** — Falls back to cloning the repo and building from source when no release artifacts are available. `server.tar.gz` is also included in the release workflow for future releases.
- **Update script cleans up old extension versions** — The updater now uninstalls old extension versions and removes leftover extension directories before installing the new version, ensuring clean upgrades. Also adds terminal server update support and graceful handling when `code`/`node` CLI tools are missing.

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
