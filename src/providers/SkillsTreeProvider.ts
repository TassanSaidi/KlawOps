import * as vscode from 'vscode';
import * as fs    from 'fs';
import * as path  from 'path';
import * as os    from 'os';

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
  constructor(public readonly meta: SkillMeta) {
    super(meta.name, vscode.TreeItemCollapsibleState.None);
    this.description  = `${meta.type} · ${meta.installed ? 'installed' : 'not installed'}`;
    this.tooltip      = meta.description;
    this.iconPath     = new vscode.ThemeIcon(meta.installed ? 'check' : 'cloud-download');
    this.contextValue = meta.installed ? 'skill-installed' : 'skill-available';
    this.command = undefined; // leaf — no default click action
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
    return loadSkillMetas(this.context).map(m => new SkillItem(m));
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
