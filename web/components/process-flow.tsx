"use client";
// Πορεία μιας διεργασίας ως διάγραμμα (React Flow): κάθε βήμα είναι κόμβος με την κατάστασή του και, όπου έχει νόημα,
// σύνδεσμο προς το σημείο όπου ρυθμίζεται. Μόνο για ανάγνωση: ο χρήστης δεν μετακινεί κόμβους.
// Σε στενή οθόνη τα βήματα μπαίνουν κάθετα.
import { Background, Handle, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Check, CircleDashed, LoaderCircle, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "./ui";

export type Step = { id: string; label: string; detail?: string; state: "done" | "current" | "todo" | "failed"; href?: string; action?: string };
type StepNode = Node<Step & { vertical: boolean; first: boolean; last: boolean }, "step">;

const W = 190, H = 76, GAP = 44;
const STATE = {
  done: { icon: Check, ring: "border-success/50", dot: "bg-success text-success-foreground", word: "Έγινε" },
  current: { icon: LoaderCircle, ring: "border-gold", dot: "bg-gold text-accent-foreground", word: "Τώρα" },
  todo: { icon: CircleDashed, ring: "border-border border-dashed", dot: "bg-secondary text-muted-foreground", word: "Εκκρεμεί" },
  failed: { icon: X, ring: "border-destructive/60", dot: "bg-destructive text-destructive-foreground", word: "Απέτυχε" },
};

function StepCard({ data }: NodeProps<StepNode>) {
  const s = STATE[data.state];
  const Icon = s.icon;
  const body = (
    <div className={cn("flex h-full items-center gap-2.5 rounded-lg border bg-card px-3 text-left", s.ring, data.href && "hover:bg-secondary")} style={{ width: W, height: H }}>
      <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", s.dot)}><Icon className="size-3.5" /></span>
      <span className="min-w-0">
        <span className="block text-sm leading-tight font-medium">{data.label}</span>
        <span className="block truncate text-xs text-muted-foreground">{data.detail ?? s.word}</span>
        {data.href && data.action ? <span className="block text-xs font-semibold text-primary">{data.action}</span> : null}
      </span>
    </div>
  );
  return (
    <>
      {data.first ? null : <Handle type="target" position={data.vertical ? Position.Top : Position.Left} className="!size-1 !border-0 !bg-transparent" />}
      {data.href ? <a href={data.href} aria-label={`${data.label}: ${s.word}`}>{body}</a> : body}
      {data.last ? null : <Handle type="source" position={data.vertical ? Position.Bottom : Position.Right} className="!size-1 !border-0 !bg-transparent" />}
    </>
  );
}
const nodeTypes = { step: StepCard };

const narrowQuery = "(max-width: 767.98px)";
const subscribe = (cb: () => void) => { const m = window.matchMedia(narrowQuery); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };

export function ProcessFlow({ steps, label }: { steps: Step[]; label: string }) {
  const vertical = useSyncExternalStore(subscribe, () => window.matchMedia(narrowQuery).matches, () => false);
  const perRow = vertical ? 1 : 4;
  const rows = Math.ceil(steps.length / perRow);
  const nodes: StepNode[] = steps.map((s, i) => ({
    id: s.id, type: "step", draggable: false, selectable: false,
    position: vertical ? { x: 0, y: i * (H + GAP * 0.6) } : { x: (i % perRow) * (W + GAP), y: Math.floor(i / perRow) * (H + GAP) },
    data: { ...s, vertical, first: i === 0, last: i === steps.length - 1 },
  }));
  const edges = steps.slice(1).map((s, i) => ({
    id: `${steps[i].id}-${s.id}`, source: steps[i].id, target: s.id, type: "smoothstep", animated: s.state === "current",
    style: { stroke: steps[i].state === "done" ? "var(--success)" : "var(--muted-foreground)", strokeWidth: 1.5, opacity: steps[i].state === "done" ? 0.9 : 0.45 },
  }));
  const height = vertical ? steps.length * (H + GAP * 0.6) + 16 : rows * (H + GAP) - GAP + 32;
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <div style={{ height }} role="group" aria-label={`${label}: ${done} από ${steps.length} βήματα έγιναν`}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.04, maxZoom: 1 }}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag={false} panOnScroll={false}
        zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false} preventScrolling={false}
        className="!bg-transparent"
      >
        <Background gap={16} size={1} color="var(--border)" />
      </ReactFlow>
    </div>
  );
}
