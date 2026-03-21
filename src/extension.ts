import * as vscode from 'vscode';
import * as fs     from 'fs';
import * as path   from 'path';
import * as os     from 'os';
import { SessionTreeProvider } from './providers/SessionTreeProvider';
import { SkillsTreeProvider, getBundledCommandFilenames }  from './providers/SkillsTreeProvider';
import { StatusBarProvider }   from './providers/StatusBarProvider';
import { setClaudeDir, getConfiguredClaudeDir, loadCustomSkills } from './data/reader';
import { openUnifiedPanel, pushUpdate } from './panels/UnifiedPanel';

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
  // Debounced: coalesce rapid writes into a single refresh cycle.
  const projectsDir = path.join(getConfiguredClaudeDir(), 'projects');
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(projectsDir), '**/*.jsonl')
  );
  let watcherDebounce: ReturnType<typeof setTimeout> | null = null;
  const WATCHER_DEBOUNCE_MS = 1_000;
  function onSessionFileChange(isCreate: boolean) {
    if (watcherDebounce) { clearTimeout(watcherDebounce); }
    watcherDebounce = setTimeout(() => {
      if (isCreate) { sessionTree.refresh(); }
      statusBar.update();
      pushUpdate();
    }, WATCHER_DEBOUNCE_MS);
  }
  watcher.onDidCreate(() => onSessionFileChange(true));
  watcher.onDidChange(() => onSessionFileChange(false));
  context.subscriptions.push(watcher);

  // ── Custom skills file watcher ────────────────────────────────────────────
  const claudeDir = getConfiguredClaudeDir();
  const customSkillsWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(claudeDir), 'klawops-custom-skills.json')
  );
  customSkillsWatcher.onDidChange(() => { skillsTree.refresh(); pushUpdate(); });
  customSkillsWatcher.onDidCreate(() => { skillsTree.refresh(); pushUpdate(); });
  context.subscriptions.push(customSkillsWatcher);

  // ── Commands ──────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('klawops.openDashboard', () => {
      openUnifiedPanel(context, { tab: 'dashboard' });
    }),

    vscode.commands.registerCommand('klawops.openSession', (sessionId: string) => {
      openUnifiedPanel(context, { tab: 'sessions', sessionId });
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

    vscode.commands.registerCommand('klawops.openSkillsAgents', () => {
      openUnifiedPanel(context, { tab: 'skills' });
    }),

    vscode.commands.registerCommand('klawops.openSkillDetail', (name: string) => {
      openUnifiedPanel(context, { tab: 'skills', skillFilter: name });
    }),

    vscode.commands.registerCommand('klawops.registerCustomSkill', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Skill/agent name (as used in Claude Code)', placeHolder: 'e.g. my-skill or general-purpose' });
      if (!name?.trim()) { return; }

      const type = await vscode.window.showQuickPick(['command', 'agent'], { placeHolder: 'Select type' });
      if (!type) { return; }

      const description = await vscode.window.showInputBox({ prompt: 'Description (optional)', placeHolder: 'What does this skill do?' });

      const configPath = path.join(getConfiguredClaudeDir(), 'klawops-custom-skills.json');
      let config: { skills: { name: string; type: string; description?: string }[] } = { skills: [] };
      if (fs.existsSync(configPath)) {
        try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch { /* reset */ }
      }
      if (!Array.isArray(config.skills)) { config.skills = []; }

      const trimmedName = name.trim();
      if (config.skills.find(s => s.name === trimmedName)) {
        vscode.window.showWarningMessage(`"${trimmedName}" is already registered.`);
        return;
      }

      config.skills.push({ name: trimmedName, type, ...(description?.trim() ? { description: description.trim() } : {}) });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      skillsTree.refresh();
      vscode.window.showInformationMessage(`Custom ${type} "${trimmedName}" registered. It will appear in metrics once detected in sessions.`);
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
