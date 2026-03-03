import * as vscode from 'vscode';
import * as fs     from 'fs';
import * as path   from 'path';
import * as os     from 'os';
import { SessionTreeProvider } from './providers/SessionTreeProvider';
import { SkillsTreeProvider, getBundledCommandFilenames }  from './providers/SkillsTreeProvider';
import { StatusBarProvider }   from './providers/StatusBarProvider';
import { setClaudeDir, getConfiguredClaudeDir } from './data/reader';
import { openSessionPanel } from './panels/SessionPanel';
import { openDashboard, pushStatsUpdate } from './panels/DashboardPanel';

export function activate(context: vscode.ExtensionContext): void {
  // ── Configure data directory ──────────────────────────────────────────────
  const override = vscode.workspace.getConfiguration('klawops').get<string>('claudeDir', '');
  setClaudeDir(override || path.join(os.homedir(), '.claude'));

  // ── Output channel ────────────────────────────────────────────────────────
  const channel = vscode.window.createOutputChannel('KlawOps');
  channel.appendLine(`KlawOps activated — reading from ${getConfiguredClaudeDir()}`);
  context.subscriptions.push(channel);

  // ── Providers ─────────────────────────────────────────────────────────────
  const sessionTree = new SessionTreeProvider(context);
  const skillsTree  = new SkillsTreeProvider(context);
  const statusBar   = new StatusBarProvider(context);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('klawops.sessions', sessionTree),
    vscode.window.registerTreeDataProvider('klawops.skills',   skillsTree),
    statusBar,
  );

  // ── File watcher — refresh tree + status bar on any session write ─────────
  const projectsDir = path.join(getConfiguredClaudeDir(), 'projects');
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(projectsDir), '**/*.jsonl')
  );
  watcher.onDidCreate(() => { sessionTree.refresh(); statusBar.update(); pushStatsUpdate(); });
  watcher.onDidChange(() => { statusBar.update(); pushStatsUpdate(); });
  context.subscriptions.push(watcher);

  // ── Commands ──────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('klawops.openDashboard', () => {
      openDashboard(context);
    }),

    vscode.commands.registerCommand('klawops.openSession', (sessionId: string) => {
      openSessionPanel(context, sessionId);
    }),

    vscode.commands.registerCommand('klawops.refreshSessions', () => {
      sessionTree.refresh();
      statusBar.update();
      channel.appendLine('Sessions refreshed.');
    }),

    vscode.commands.registerCommand('klawops.installSkill', (item: vscode.TreeItem) => {
      skillsTree.install(item);
    }),

    vscode.commands.registerCommand('klawops.installAllSkills', () => {
      skillsTree.installAll();
    }),
  );

  channel.appendLine('All providers and commands registered.');

  // ── Skills notification — offer install if not yet global ─────────────────
  const bundled    = getBundledCommandFilenames(context);
  const globalCmds = path.join(os.homedir(), '.claude', 'commands');
  const allInstalled = bundled.length > 0 &&
    bundled.every(f => fs.existsSync(path.join(globalCmds, f)));

  if (!allInstalled) {
    vscode.window.showInformationMessage(
      'KlawOps: AI workflow skills available (research, plan, implement, validate)',
      'Install Globally', 'View Skills', 'Dismiss',
    ).then(choice => {
      if (choice === 'Install Globally') {
        vscode.commands.executeCommand('klawops.installAllSkills');
      } else if (choice === 'View Skills') {
        vscode.commands.executeCommand('workbench.view.extension.klawops');
      }
    });
  }
}

export function deactivate(): void {
  // Cleanup handled by context.subscriptions
}
