import * as vscode from 'vscode';
import { getDashboardStats, getSessionList, getSessionDetailV2, getSkillAgentStats, getSessions } from '../data/reader';
import type { SkillAgentStatsOptions } from '../data/types';
import { getWebviewHtml } from '../utils/webview';

export interface UnifiedPanelOptions {
  tab?:         'dashboard' | 'sessions' | 'skills';
  sessionId?:   string;
  skillFilter?: string;
}

// Singleton — only one unified panel at a time
let unifiedPanel: vscode.WebviewPanel | undefined;

export function openUnifiedPanel(context: vscode.ExtensionContext, options?: UnifiedPanelOptions): void {
  if (unifiedPanel) {
    unifiedPanel.reveal(vscode.ViewColumn.One);
    if (options) {
      unifiedPanel.webview.postMessage({ type: 'NAVIGATE', ...options });
    }
    return;
  }

  unifiedPanel = vscode.window.createWebviewPanel(
    'klawops.unified',
    'KlawOps',
    vscode.ViewColumn.One,
    {
      enableScripts:           true,
      retainContextWhenHidden: true,
      localResourceRoots:      [vscode.Uri.joinPath(context.extensionUri, 'out')],
    },
  );

  unifiedPanel.webview.html = getWebviewHtml(
    unifiedPanel.webview, context, 'webview/unified.js'
  );

  unifiedPanel.webview.onDidReceiveMessage(async (msg: { type: string; query?: string; limit?: number; offset?: number; sessionId?: string; timeRange?: string; filter?: string }) => {
    switch (msg.type) {
      case 'REQUEST_STATS': {
        try {
          const stats = getDashboardStats();
          unifiedPanel!.webview.postMessage({ type: 'STATS_DATA', payload: stats });
        } catch (err) {
          unifiedPanel!.webview.postMessage({ type: 'STATS_ERROR', message: String(err) });
        }
        break;
      }

      case 'REQUEST_SESSION_LIST': {
        try {
          const result = getSessionList({ query: msg.query, limit: msg.limit, offset: msg.offset });
          unifiedPanel!.webview.postMessage({ type: 'SESSION_LIST_DATA', payload: result });
        } catch (err) {
          unifiedPanel!.webview.postMessage({ type: 'SESSION_LIST_ERROR', message: String(err) });
        }
        break;
      }

      case 'REQUEST_SESSION_DETAIL': {
        if (!msg.sessionId) { break; }
        try {
          const detail = await getSessionDetailV2(msg.sessionId);
          if (detail) {
            unifiedPanel!.webview.postMessage({ type: 'SESSION_DETAIL_DATA', payload: detail });
          } else {
            unifiedPanel!.webview.postMessage({ type: 'SESSION_DETAIL_ERROR', message: 'Session not found.' });
          }
        } catch (err) {
          unifiedPanel!.webview.postMessage({ type: 'SESSION_DETAIL_ERROR', message: String(err) });
        }
        break;
      }

      case 'REQUEST_SKILLS_STATS': {
        try {
          const skillOpts: SkillAgentStatsOptions = {};
          if (msg.timeRange && msg.timeRange !== 'all') {
            skillOpts.timeRange = msg.timeRange as SkillAgentStatsOptions['timeRange'];
          }
          if (msg.filter) { skillOpts.filter = msg.filter; }
          const stats = getSkillAgentStats(skillOpts);
          unifiedPanel!.webview.postMessage({ type: 'SKILLS_STATS_DATA', payload: stats });
        } catch (err) {
          unifiedPanel!.webview.postMessage({ type: 'SKILLS_STATS_ERROR', message: String(err) });
        }
        break;
      }
    }
  });

  unifiedPanel.onDidDispose(() => { unifiedPanel = undefined; });

  // Navigate after a tick so React has mounted
  if (options) {
    setTimeout(() => {
      unifiedPanel?.webview.postMessage({ type: 'NAVIGATE', ...options });
    }, 200);
  }
}

// Called by file watcher in extension.ts to push live data updates
export function pushUpdate(): void {
  if (!unifiedPanel) { return; }
  try {
    const stats = getDashboardStats();
    unifiedPanel.webview.postMessage({ type: 'STATS_DATA', payload: stats });
  } catch { /* ignore errors during background refresh */ }
  try {
    const skills = getSkillAgentStats({});
    unifiedPanel.webview.postMessage({ type: 'SKILLS_STATS_DATA', payload: skills });
  } catch { /* ignore */ }
  try {
    const result = getSessionList({ limit: 50, offset: 0 });
    unifiedPanel.webview.postMessage({ type: 'SESSION_LIST_DATA', payload: result });
  } catch { /* ignore */ }
}
