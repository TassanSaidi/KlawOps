import * as vscode from 'vscode';
import { getSessionDetail } from '../data/reader';
import { getWebviewHtml } from '../utils/webview';

// Track open panels to avoid duplicates
const openPanels = new Map<string, vscode.WebviewPanel>();

export function openSessionPanel(
  context: vscode.ExtensionContext,
  sessionId: string,
): void {
  // Reveal if already open
  const existing = openPanels.get(sessionId);
  if (existing) {
    existing.reveal(vscode.ViewColumn.One);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'klawops.session',
    `Session ${sessionId.slice(0, 8)}…`,
    vscode.ViewColumn.One,
    {
      enableScripts:          true,
      retainContextWhenHidden: true,
      localResourceRoots:     [vscode.Uri.joinPath(context.extensionUri, 'out')],
    },
  );

  openPanels.set(sessionId, panel);

  panel.webview.html = getWebviewHtml(panel.webview, context, 'webview/session.js');

  panel.webview.onDidReceiveMessage(async (msg: { type: string }) => {
    if (msg.type !== 'REQUEST_SESSION') { return; }
    try {
      const session = await getSessionDetail(sessionId);
      if (session) {
        panel.title = `${session.projectName} · ${sessionId.slice(0, 8)}`;
        panel.webview.postMessage({ type: 'SESSION_DATA', payload: session });
      } else {
        panel.webview.postMessage({ type: 'SESSION_ERROR', message: 'Session not found.' });
      }
    } catch (err) {
      panel.webview.postMessage({ type: 'SESSION_ERROR', message: String(err) });
    }
  });

  panel.onDidDispose(() => openPanels.delete(sessionId));
}
