import * as vscode from 'vscode';
import { getProjects, getProjectSessions } from '../data/reader';
import { formatCost, formatDuration, timeAgo } from '../lib/format';
import type { ProjectInfo, SessionInfo } from '../data/types';

// ── Tree node types ───────────────────────────────────────────────────────────

class ProjectNode extends vscode.TreeItem {
  constructor(readonly project: ProjectInfo) {
    super(project.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${project.sessionCount} sessions · ${formatCost(project.estimatedCost)}`;
    this.tooltip     = new vscode.MarkdownString(
      `**${project.name}**\n\n` +
      `Path: \`${project.path}\`\n\n` +
      `Sessions: ${project.sessionCount}  ·  Cost: ${formatCost(project.estimatedCost)}\n\n` +
      `Models: ${(project.models || []).join(', ') || '—'}`
    );
    this.iconPath    = new vscode.ThemeIcon('folder');
    this.contextValue = 'project';
  }
}

class SessionNode extends vscode.TreeItem {
  constructor(readonly session: SessionInfo) {
    super(timeAgo(session.timestamp), vscode.TreeItemCollapsibleState.None);

    const tokens = session.totalInputTokens + session.totalOutputTokens;
    this.description = `${formatCost(session.estimatedCost)} · ${session.messageCount} msgs`;
    this.tooltip     = new vscode.MarkdownString(
      `**${session.projectName}**\n\n` +
      `Duration: ${formatDuration(session.duration)}\n\n` +
      `Messages: ${session.messageCount}  ·  Tool calls: ${session.toolCallCount}\n\n` +
      `Tokens: ${tokens.toLocaleString()}  ·  Cost: ${formatCost(session.estimatedCost)}\n\n` +
      (session.gitBranch ? `Branch: \`${session.gitBranch}\`\n\n` : '') +
      `Models: ${(session.models || []).join(', ') || '—'}`
    );
    this.iconPath     = new vscode.ThemeIcon('comment-discussion');
    this.contextValue = 'session';
    this.command      = {
      command:   'klawops.openSession',
      title:     'Open Session',
      arguments: [session.id],
    };
  }
}

type TreeNode = ProjectNode | SessionNode;

// ── Provider ──────────────────────────────────────────────────────────────────

export class SessionTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onChange = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onChange.event;

  constructor(_context: vscode.ExtensionContext) {}

  refresh(): void {
    this._onChange.fire(undefined);
  }

  getTreeItem(el: TreeNode): vscode.TreeItem {
    return el;
  }

  getChildren(el?: TreeNode): TreeNode[] {
    if (!el) {
      // Root: list projects
      try {
        const projects = getProjects();
        if (projects.length === 0) {
          const empty = new vscode.TreeItem('No sessions found');
          empty.iconPath = new vscode.ThemeIcon('info');
          return [empty];
        }
        return projects.map(p => new ProjectNode(p));
      } catch {
        const err = new vscode.TreeItem('Error reading ~/.claude/');
        err.iconPath = new vscode.ThemeIcon('error');
        return [err];
      }
    }

    if (el instanceof ProjectNode) {
      // Project expanded: list sessions
      try {
        const sessions = getProjectSessions(el.project.id);
        if (sessions.length === 0) {
          const empty = new vscode.TreeItem('No sessions');
          empty.iconPath = new vscode.ThemeIcon('info');
          return [empty];
        }
        return sessions.map(s => new SessionNode(s));
      } catch {
        const err = new vscode.TreeItem('Error reading sessions');
        err.iconPath = new vscode.ThemeIcon('error');
        return [err];
      }
    }

    return [];
  }
}
