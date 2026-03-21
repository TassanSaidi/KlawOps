import React, { useState } from 'react';
import type { AgentTreeNode } from '../../../data/types';
import { C } from '../theme';
import { formatTokens, formatCost } from '../format';

function maxDepth(node: AgentTreeNode): number {
  if (node.children.length === 0) { return 0; }
  return 1 + Math.max(...node.children.map(maxDepth));
}

// ── Layout ────────────────────────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  label: string;
  type: 'root' | 'agent' | 'skill';
  tokens: number;
  cost: number;
  model?: string;
  invocations?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Edge { parentId: string; childId: string }

function buildLayout(
  node: AgentTreeNode,
  x: number,
  y: number,
  maxTokens: number,
  nodes: Map<string, LayoutNode>,
  edges: Edge[],
): void {
  const nodeWidth = Math.max(120, Math.round(200 * Math.log(1 + node.tokens) / Math.log(1 + maxTokens)));
  nodes.set(node.id, { id: node.id, label: node.label, type: node.type ?? 'agent', tokens: node.tokens, cost: node.cost, model: node.model, invocations: node.invocations, x, y, width: nodeWidth, height: 70 });

  if (node.children.length > 0) {
    const totalWidth = node.children.length * 160;
    const startX     = x - totalWidth / 2 + 80;
    node.children.forEach((child, i) => {
      edges.push({ parentId: node.id, childId: child.id });
      buildLayout(child, startX + i * 160, y + 120, maxTokens, nodes, edges);
    });
  }
}

function curvePath(p: LayoutNode, c: LayoutNode): string {
  const x1 = p.x;
  const y1 = p.y + p.height;
  const x2 = c.x;
  const y2 = c.y;
  const mid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ node, svgWidth }: { node: LayoutNode; svgWidth: number }) {
  const w = 160;
  // Clamp so tooltip stays within SVG viewBox
  const tx = Math.min(Math.max(node.x - w / 2, 4), svgWidth - w - 4);
  const ty = node.y + node.height + 6;

  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={tx} y={ty} width={w} height={56} rx={6} fill={C.card} stroke={C.border} strokeWidth={1} />
      <text x={tx + 8} y={ty + 16} fill={C.text}  fontSize={11} fontWeight={600}>{node.label}</text>
      <text x={tx + 8} y={ty + 30} fill={C.muted} fontSize={10}>{formatTokens(node.tokens)} tokens</text>
      <text x={tx + 8} y={ty + 44} fill={C.muted} fontSize={10}>{formatCost(node.cost)} est. cost</text>
    </g>
  );
}

// ── TreeNode ──────────────────────────────────────────────────────────────────

function TreeNodeSvg({ node, maxTokens, svgWidth }: { node: LayoutNode; maxTokens: number; svgWidth: number }) {
  const [hovered, setHovered] = useState(false);
  const isSkill  = node.type === 'skill';
  const isRoot   = node.type === 'root';
  const opacity  = isSkill ? 1 : 0.4 + 0.6 * (maxTokens > 0 ? node.tokens / maxTokens : 1);
  const fill     = isSkill ? `${C.primary}18` : C.card;
  const stroke   = hovered ? C.primary : isSkill ? `${C.primary}80` : isRoot ? C.mutedDark : C.border;
  const strokeW  = hovered ? 2 : isSkill ? 1.5 : 1;
  const dashArray = isSkill ? '4 3' : undefined;

  const displayLabel = isSkill
    ? `/${node.label.length > 16 ? node.label.slice(0, 14) + '…' : node.label}`
    : node.label.length > 18 ? node.label.slice(0, 16) + '…' : node.label;

  const line2 = isSkill
    ? (node.invocations && node.invocations > 1 ? `${node.invocations}× invoked` : 'skill')
    : formatTokens(node.tokens);

  const line3 = isSkill
    ? (node.tokens > 0 ? formatTokens(node.tokens) : '')
    : formatCost(node.cost);

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ cursor: 'default' }}
    >
      <rect
        x={node.x - node.width / 2} y={node.y}
        width={node.width} height={node.height}
        rx={8} ry={8}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeW}
        strokeDasharray={dashArray}
        opacity={opacity}
      />
      <text
        x={node.x} y={node.y + 24}
        textAnchor="middle"
        fill={isSkill ? C.primary : C.text} fontSize={12} fontWeight={600}
      >
        {displayLabel}
      </text>
      <text x={node.x} y={node.y + 42} textAnchor="middle" fill={C.muted} fontSize={11}>
        {line2}
      </text>
      {line3 && (
        <text x={node.x} y={node.y + 58} textAnchor="middle" fill={C.muted} fontSize={11}>
          {line3}
        </text>
      )}
      {hovered && <Tooltip node={node} svgWidth={svgWidth} />}
    </g>
  );
}

// ── AgentTreeGraph ────────────────────────────────────────────────────────────

export const AgentTreeGraph = React.memo(function AgentTreeGraph({ tree }: { tree: AgentTreeNode }) {
  const SVG_W    = 800;
  const depth    = maxDepth(tree);
  const svgHeight = Math.max(200, (depth + 1) * 120 + 60);

  const nodes = new Map<string, LayoutNode>();
  const edges: Edge[] = [];
  buildLayout(tree, SVG_W / 2, 20, tree.tokens, nodes, edges);

  const noChildren = tree.children.length === 0;

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ fontSize: '11px', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
          Agent Hierarchy
        </p>
        <div style={{ display: 'flex', gap: '12px' }}>
          <span style={{ fontSize: '10px', color: C.primary, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <svg width="14" height="10"><rect x="0" y="0" width="14" height="10" rx="3" fill={`${C.primary}18`} stroke={`${C.primary}80`} strokeWidth="1.5" strokeDasharray="4 3" /></svg>
            Skill
          </span>
          <span style={{ fontSize: '10px', color: C.muted, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <svg width="14" height="10"><rect x="0" y="0" width="14" height="10" rx="3" fill={C.card} stroke={C.border} strokeWidth="1" /></svg>
            Agent
          </span>
        </div>
      </div>
      <svg
        width="100%"
        height={svgHeight}
        viewBox={`0 0 ${SVG_W} ${svgHeight}`}
        style={{ display: 'block' }}
      >
        {/* Connecting lines (behind nodes) */}
        {edges.map(({ parentId, childId }) => {
          const p = nodes.get(parentId);
          const c = nodes.get(childId);
          if (!p || !c) { return null; }
          const edgeColor = p.type === 'skill' ? `${C.primary}60` : C.border;
          return (
            <path
              key={`${parentId}-${childId}`}
              d={curvePath(p, c)}
              stroke={edgeColor}
              strokeWidth={p.type === 'skill' ? 1.5 : 2}
              strokeDasharray={p.type === 'skill' ? '4 3' : undefined}
              fill="none"
            />
          );
        })}

        {/* Nodes */}
        {Array.from(nodes.values()).map(node => (
          <TreeNodeSvg key={node.id} node={node} maxTokens={tree.tokens} svgWidth={SVG_W} />
        ))}
      </svg>
      {noChildren && (
        <p style={{ fontSize: '11px', color: C.muted, textAlign: 'center', marginTop: '4px' }}>
          No skills or sub-agents in this session
        </p>
      )}
    </div>
  );
});
