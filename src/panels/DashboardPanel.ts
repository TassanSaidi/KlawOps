import * as vscode from 'vscode';
import { getDashboardStats } from '../data/reader';
import { getWebviewHtml } from '../utils/webview';

// Singleton — only one dashboard panel at a time
let dashboardPanel: vscode.WebviewPanel | undefined;

export function openDashboard(context: vscode.ExtensionContext): void {
  // Reveal if already open
  if (dashboardPanel) {
    dashboardPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  dashboardPanel = vscode.window.createWebviewPanel(
    'klawops.dashboard',
    'KlawOps Dashboard',
    vscode.ViewColumn.One,
    {
      enableScripts:           true,
      retainContextWhenHidden: true,
      localResourceRoots:      [vscode.Uri.joinPath(context.extensionUri, 'out')],
    },
  );

  dashboardPanel.webview.html = getWebviewHtml(
    dashboardPanel.webview, context, 'webview/dashboard.js'
  );

  dashboardPanel.webview.onDidReceiveMessage((msg: { type: string; sessionId?: string }) => {
    if (msg.type === 'REQUEST_STATS') {
      try {
        const stats = getDashboardStats();
        dashboardPanel!.webview.postMessage({ type: 'STATS_DATA', payload: stats });
      } catch (err) {
        dashboardPanel!.webview.postMessage({ type: 'STATS_ERROR', message: String(err) });
      }
    }

    if (msg.type === 'OPEN_SESSION' && msg.sessionId) {
      vscode.commands.executeCommand('klawops.openSession', msg.sessionId);
    }
  });

  dashboardPanel.onDidDispose(() => { dashboardPanel = undefined; });
}

// Called by the file watcher in extension.ts to push live updates
export function pushStatsUpdate(): void {
  if (!dashboardPanel) { return; }
  try {
    const stats = getDashboardStats();
    dashboardPanel.webview.postMessage({ type: 'STATS_DATA', payload: stats });
  } catch { /* ignore errors during background refresh */ }
}
