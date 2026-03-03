import * as vscode from 'vscode';
import * as path from 'path';
import { getMostRecentSession, getConfiguredClaudeDir } from '../data/reader';
import { formatCost, formatTokens } from '../lib/format';

export class StatusBarProvider implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private watcher: vscode.FileSystemWatcher;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor(_context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.tooltip = 'KlawOps — click to open dashboard';
    this.item.command = 'klawops.openDashboard';

    // Watch ~/.claude/projects/**/*.jsonl for any write
    const projectsDir = path.join(getConfiguredClaudeDir(), 'projects');
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(projectsDir), '**/*.jsonl')
    );
    this.watcher.onDidChange(() => this.scheduleUpdate());
    this.watcher.onDidCreate(() => this.scheduleUpdate());

    // Render immediately on activation
    this.update();
    this.item.show();
  }

  private scheduleUpdate(): void {
    if (this.debounce) { clearTimeout(this.debounce); }
    this.debounce = setTimeout(() => this.update(), 500);
  }

  update(): void {
    try {
      const session = getMostRecentSession();
      if (!session) {
        this.item.text = '$(pulse) KlawOps';
        this.item.tooltip = 'KlawOps — no sessions found';
        return;
      }
      const cost   = formatCost(session.estimatedCost);
      const tokens = formatTokens(session.totalInputTokens + session.totalOutputTokens);
      this.item.text = `$(pulse) ${cost} | ${tokens}`;
      this.item.tooltip = [
        `KlawOps — most recent session`,
        `Project: ${session.projectName}`,
        `Cost:    ${cost}`,
        `Tokens:  ${tokens}`,
        `Branch:  ${session.gitBranch || '—'}`,
        ``,
        `Click to open dashboard`,
      ].join('\n');
    } catch {
      this.item.text = '$(pulse) KlawOps';
    }
  }

  dispose(): void {
    if (this.debounce) { clearTimeout(this.debounce); }
    this.watcher.dispose();
    this.item.dispose();
  }
}
