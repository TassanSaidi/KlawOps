import * as vscode from 'vscode';
import * as fs    from 'fs';
import * as path  from 'path';
import * as os    from 'os';
import { getSkillAgentStats, loadCustomSkills } from '../data/reader';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SkillMeta {
  name:        string;
  description: string;
  type:        'command' | 'agent';
  filename:    string;
  sourcePath:  string;   // absolute path inside the extension
  installed:   boolean;  // true if file exists at global target
}

// ── Tree item ─────────────────────────────────────────────────────────────────

class SkillItem extends vscode.TreeItem {
  constructor(
    public readonly meta: SkillMeta,
    stats?: { invocations: number; totalCost: number; totalTokens: number },
  ) {
    super(meta.name, vscode.TreeItemCollapsibleState.None);
    const status  = meta.installed ? 'installed' : 'not installed';
    const usageParts: string[] = [];
    if (stats && stats.invocations > 0) {
      usageParts.push(`${stats.invocations}×`);
      if (stats.totalCost > 0) { usageParts.push(`$${stats.totalCost.toFixed(3)}`); }
      if (stats.totalTokens > 0) {
        const t = stats.totalTokens;
        usageParts.push(t >= 1_000_000 ? `${(t/1_000_000).toFixed(1)}M tok` : t >= 1_000 ? `${(t/1_000).toFixed(1)}K tok` : `${t} tok`);
      }
    }
    this.description  = usageParts.length > 0
      ? `${usageParts.join(' · ')} · ${status}`
      : `${meta.type} · ${status}`;
    this.tooltip      = meta.description;
    this.iconPath     = new vscode.ThemeIcon(meta.installed ? 'check' : 'cloud-download');
    this.contextValue = meta.installed ? 'skill-installed' : 'skill-available';
    this.command = {
      command:   'klawops.openSkillDetail',
      title:     'View Skill Details',
      arguments: [meta.name, meta.type],
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse `description:` from YAML frontmatter without a full parser. */
function parseFrontmatterDescription(content: string): string {
  const match = content.match(/^---[\s\S]*?^description:\s*(.+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

/** Absolute path of `~/.claude/<subdir>/<filename>` */
function globalTargetPath(type: 'command' | 'agent', filename: string): string {
  const subdir = type === 'command' ? 'commands' : 'agents';
  return path.join(os.homedir(), '.claude', subdir, filename);
}

/** Absolute path in the user's first workspace folder. */
function workspaceTargetPath(type: 'command' | 'agent', filename: string): string {
  const subdir  = type === 'command' ? 'commands' : 'agents';
  const wsRoot  = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? path.join(os.homedir(), '.claude');
  return path.join(wsRoot, '.claude', subdir, filename);
}

function loadSkillMetas(context: vscode.ExtensionContext): SkillMeta[] {
  const metas: SkillMeta[] = [];

  const dirs: { dir: string; type: 'command' | 'agent' }[] = [
    { dir: path.join(context.extensionPath, 'skills', 'commands'), type: 'command' },
    { dir: path.join(context.extensionPath, 'skills', 'agents'),   type: 'agent'   },
  ];

  for (const { dir, type } of dirs) {
    if (!fs.existsSync(dir)) { continue; }
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const sourcePath  = path.join(dir, file);
      const content     = fs.readFileSync(sourcePath, 'utf-8');
      const description = parseFrontmatterDescription(content);
      const name        = file.replace(/\.md$/, '');
      const installed   = fs.existsSync(globalTargetPath(type, file));

      metas.push({ name, description, type, filename: file, sourcePath, installed });
    }
  }

  return metas.sort((a, b) => a.name.localeCompare(b.name));
}

function copySkill(meta: SkillMeta, scope: 'workspace' | 'global'): void {
  const dest = scope === 'global'
    ? globalTargetPath(meta.type, meta.filename)
    : workspaceTargetPath(meta.type, meta.filename);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(meta.sourcePath, dest);
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class SkillsTreeProvider implements vscode.TreeDataProvider<SkillItem> {
  private _onChange = new vscode.EventEmitter<SkillItem | undefined>();
  readonly onDidChangeTreeData = this._onChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh(): void { this._onChange.fire(undefined); }

  getTreeItem(item: SkillItem): SkillItem { return item; }

  getChildren(): SkillItem[] {
    const metas    = loadSkillMetas(this.context);
    const statsMap = new Map<string, { invocations: number; totalCost: number; totalTokens: number }>();
    let allStats: ReturnType<typeof getSkillAgentStats> | null = null;

    try {
      allStats = getSkillAgentStats();
      for (const e of allStats.entries) {
        statsMap.set(e.name, { invocations: e.invocations, totalCost: e.totalCost, totalTokens: e.totalTokens });
      }
    } catch { /* ignore — show skills without stats on error */ }

    // Don't show bundled KlawOps skills in the sidebar tree —
    // only custom and session-detected skills/agents appear here.
    const items: SkillItem[] = [];
    const bundledSet = new Set(metas.map(m => m.name));

    // Merge custom skills registered via klawops-custom-skills.json
    try {
      for (const cs of loadCustomSkills()) {
        if (bundledSet.has(cs.name)) { continue; }
        bundledSet.add(cs.name);
        items.push(new SkillItem({
          name:        cs.name,
          description: cs.description || `Custom ${cs.type}`,
          type:        cs.type,
          filename:    '',
          sourcePath:  '',
          installed:   true,
        }, statsMap.get(cs.name)));
      }
    } catch { /* ignore */ }

    // Also show detected agents/skills from session data that aren't bundled or custom
    if (allStats) {
      for (const e of allStats.entries) {
        if (bundledSet.has(e.name)) { continue; }
        const detectedMeta: SkillMeta = {
          name:        e.name,
          description: `Detected ${e.type}`,
          type:        e.type === 'agent' ? 'agent' : 'command',
          filename:    '',
          sourcePath:  '',
          installed:   true,
        };
        items.push(new SkillItem(detectedMeta, statsMap.get(e.name)));
      }
    }

    return items.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
  }

  async install(item: vscode.TreeItem): Promise<void> {
    // item may come from the command palette context value, cast safely
    const skillItem = item instanceof SkillItem ? item : undefined;
    if (!skillItem) {
      vscode.window.showErrorMessage('Could not determine which skill to install.');
      return;
    }

    const scope = await this.pickScope(`Install "${skillItem.meta.name}" to…`);
    if (!scope) { return; }

    try {
      copySkill(skillItem.meta, scope);
      this.refresh();
      const subdir = skillItem.meta.type === 'command' ? 'commands' : 'agents';
      vscode.window.showInformationMessage(
        `✓ Installed "${skillItem.meta.name}" to ${scope === 'global' ? '~/.claude' : 'workspace .claude'}/${subdir}/`
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to install skill: ${String(err)}`);
    }
  }

  async installAll(): Promise<void> {
    const scope = await this.pickScope('Install all skills and agents to…');
    if (!scope) { return; }

    try {
      const metas = loadSkillMetas(this.context);
      for (const meta of metas) { copySkill(meta, scope); }
      this.refresh();
      vscode.window.showInformationMessage(
        `✓ All ${metas.length} KlawOps skills installed. ` +
        `Use /research_codebase_generic, /create_plan_generic, etc. in Claude Code.`
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to install skills: ${String(err)}`);
    }
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async pickScope(placeholder: string): Promise<'workspace' | 'global' | undefined> {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label:       '$(home) Global',
          description: '~/.claude/ — available in all projects',
          value:       'global' as const,
        },
        {
          label:       '$(folder) Workspace',
          description: '.claude/ in current workspace root',
          value:       'workspace' as const,
        },
      ],
      { placeHolder: placeholder },
    );
    return choice?.value;
  }
}

// ── Activation helper ─────────────────────────────────────────────────────────

/** Returns filenames of all bundled command skills. */
export function getBundledCommandFilenames(context: vscode.ExtensionContext): string[] {
  const dir = path.join(context.extensionPath, 'skills', 'commands');
  if (!fs.existsSync(dir)) { return []; }
  return fs.readdirSync(dir).filter(f => f.endsWith('.md'));
}
