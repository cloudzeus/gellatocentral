"use client";
// Γενικός renderer ροών πάνω σε React Flow: παίρνει plain nodes/edges (lib/traceability-graph.ts)
// και τα ζωγραφίζει με custom κόμβο στο ύφος του kit. Read-only — ο χρήστης μόνο σύρει/ζουμάρει.
import { useMemo } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/components/ui";
import type { FlowGraph, FlowNodeData, FlowTone } from "@/lib/traceability-graph";

const COL_W = 300;
const ROW_H = 108;

const TONE_BAR: Record<FlowTone, string> = {
  neutral: "border-l-primary",
  success: "border-l-success",
  warning: "border-l-gold",
  danger: "border-l-destructive",
};

type FlowRfNode = Node<FlowNodeData, "gelato">;

function GelatoNode({ data }: NodeProps<FlowRfNode>) {
  const body = (
    <>
      <Handle type="target" position={Position.Left} className="!size-0 !border-0 !bg-transparent" />
      <p className="truncate text-sm font-medium leading-tight">{data.title}</p>
      {data.subtitle ? <p className="truncate text-xs text-muted-foreground">{data.subtitle}</p> : null}
      {data.lines?.map((line) => (
        <p key={line} className="truncate text-xs text-muted-foreground">
          {line}
        </p>
      ))}
      <Handle type="source" position={Position.Right} className="!size-0 !border-0 !bg-transparent" />
    </>
  );
  const cls = cn(
    "block w-[240px] rounded-xl border border-border border-l-4 bg-card px-3 py-2 text-card-foreground shadow-[var(--shadow-card)]",
    TONE_BAR[data.tone ?? "neutral"],
  );
  return data.href ? (
    <a href={data.href} className={cn(cls, "nodrag transition-colors hover:bg-secondary/60")} title="Άνοιγμα καρτέλας">
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const nodeTypes = { gelato: GelatoNode };

/** Κεντράρισμα στηλών: η στήλη με λιγότερους κόμβους κατεβαίνει ώστε να ισορροπεί οπτικά. */
function toReactFlow(graph: FlowGraph): { nodes: FlowRfNode[]; edges: Edge[] } {
  const rowsPerCol = new Map<number, number>();
  for (const n of graph.nodes) rowsPerCol.set(n.col, Math.max(rowsPerCol.get(n.col) ?? 0, n.row + 1));
  const maxRows = Math.max(...rowsPerCol.values(), 1);

  const nodes: FlowRfNode[] = graph.nodes.map((n) => {
    const rows = rowsPerCol.get(n.col) ?? 1;
    const offsetY = ((maxRows - rows) * ROW_H) / 2;
    return { id: n.id, type: "gelato", position: { x: n.col * COL_W, y: offsetY + n.row * ROW_H }, data: n.data, draggable: true };
  });
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    labelStyle: { fontSize: 11, fill: "var(--muted-foreground)" },
    labelBgStyle: { fill: "var(--card)", fillOpacity: 0.9 },
    style: { stroke: "var(--muted-foreground)", strokeWidth: 1.5, opacity: 0.6 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--muted-foreground)" },
  }));
  return { nodes, edges };
}

/** Οπτικοποίηση ροής (π.χ. διαδρομή παρτίδας). Τα δεδομένα έρχονται έτοιμα από τον server. */
export function FlowGraphView({ graph, height = 380 }: { graph: FlowGraph; height?: number }) {
  const { nodes, edges } = useMemo(() => toReactFlow(graph), [graph]);
  if (nodes.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-b-xl" style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.3}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll
        className="!bg-transparent"
      >
        <Background gap={20} size={1} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
