import express from 'express';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { setClaudeDir } from '../data/reader';
import { createApiRouter } from './routes';
import { getStandaloneHtml } from './shell';

// ── CLI argument parsing ──────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);

if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(`
KlawOps Terminal Dashboard

Usage: node out/server.js [options]

Options:
  --port <number>       Port to listen on (default: 3131)
  --claude-dir <path>   Path to Claude data directory (default: ~/.claude)
  --no-open             Do not auto-open browser
  --help                Show this message
  `);
  process.exit(0);
}

function parseArgs(): { port: number; claudeDir: string; noOpen: boolean } {
  const args = rawArgs;
  let port      = 3131;
  let claudeDir = path.join(os.homedir(), '.claude');
  let noOpen    = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port'       && args[i + 1]) { port      = Number(args[++i]); }
    if (args[i] === '--claude-dir' && args[i + 1]) { claudeDir = args[++i]; }
    if (args[i] === '--no-open')                   { noOpen    = true; }
  }
  return { port, claudeDir, noOpen };
}

// ── Browser opener ────────────────────────────────────────────────────────────

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? `open "${url}"`
            : process.platform === 'win32'  ? `start "${url}"`
            :                                 `xdg-open "${url}"`;
  exec(cmd);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { port, claudeDir, noOpen } = parseArgs();

setClaudeDir(claudeDir);

const app = express();
app.use(express.json());

// Serve compiled webview bundle — out/webview/ → /webview/
app.use('/webview', express.static(path.join(__dirname, 'webview')));

// API routes
app.use('/api', createApiRouter());

// Shell — serve the HTML for all non-asset routes
app.use((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(getStandaloneHtml());
});

app.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`\nKlawOps dashboard running at ${url}`);
  console.log(`Claude data: ${claudeDir}`);
  console.log(`Press Ctrl+C to stop.\n`);
  if (!noOpen) { openBrowser(url); }
});
