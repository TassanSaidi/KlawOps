# Changelog

## [0.1.0] — 2026-03-03

### Added

- **Live status bar** — shows cost and token count of the most recent Claude Code session; updates in real time via file watching
- **Session browser** — tree view of projects → sessions in the VS Code Activity Bar; click any session to open a conversation replay WebView
- **Conversation replay** — full message history with role icons, model badges, per-turn token usage, tool call badges, context compaction timeline, and token breakdown sidebar
- **Analytics dashboard** — command-palette WebView with stat cards (sessions, messages, tokens, cost), Usage Over Time chart, Model Usage donut, Activity Heatmap, Peak Hours bar chart, and Recent Sessions table
- **Skills panel** — sidebar listing four bundled workflow commands (`research_codebase_generic`, `create_plan_generic`, `implement_plan`, `validate_plan`) and four sub-agents (`codebase-analyzer`, `codebase-locator`, `codebase-pattern-finder`, `web-search-researcher`); per-skill install to workspace or global scope
- **First-run notification** — offers to install all skills globally when none are installed
- **`klawops.claudeDir` setting** — override the default `~/.claude` data directory
