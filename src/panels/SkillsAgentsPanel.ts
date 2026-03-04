import * as vscode from 'vscode';
import { getSkillAgentStats } from '../data/reader';
import { getWebviewHtml } from '../utils/webview';

// Singleton — only one skills/agents panel at a time
let skillsAgentsPanel: vscode.WebviewPanel | undefined;

export function openSkillsAgentsPanel(context: vscode.ExtensionContext): void {
  if (skillsAgentsPanel) {
    skillsAgentsPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  skillsAgentsPanel = vscode.window.createWebviewPanel(
    'klawops.skillsAgents',
    'KlawOps: Skills & Agents',
    vscode.ViewColumn.One,
    {
      enableScripts:           true,
      retainContextWhenHidden: true,
      localResourceRoots:      [vscode.Uri.joinPath(context.extensionUri, 'out')],
    },
  );

  skillsAgentsPanel.webview.html = getWebviewHtml(
    skillsAgentsPanel.webview, context, 'webview/skills-agents.js'
  );

  skillsAgentsPanel.webview.onDidReceiveMessage((msg: { type: string }) => {
    if (msg.type === 'REQUEST_SKILLS_STATS') {
      try {
        const stats = getSkillAgentStats();
        skillsAgentsPanel!.webview.postMessage({ type: 'SKILLS_STATS_DATA', payload: stats });
      } catch (err) {
        skillsAgentsPanel!.webview.postMessage({ type: 'SKILLS_STATS_ERROR', message: String(err) });
      }
    }
  });

  skillsAgentsPanel.onDidDispose(() => { skillsAgentsPanel = undefined; });
}

// Called by the file watcher in extension.ts to push live updates
export function pushSkillsAgentsUpdate(): void {
  if (!skillsAgentsPanel) { return; }
  try {
    const stats = getSkillAgentStats();
    skillsAgentsPanel.webview.postMessage({ type: 'SKILLS_STATS_DATA', payload: stats });
  } catch { /* ignore errors during background refresh */ }
}
