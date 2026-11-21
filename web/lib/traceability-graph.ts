// Κατασκευή κόμβων/ακμών για γραφήματα ροής (ιχνηλασιμότητα, παραγωγή κ.ά.).
// Pure module: ο server φτιάχνει plain data, το components/flow-graph.tsx τα αποτυπώνει.
// Οι στήλες (col) διαβάζονται αριστερά → δεξιά· η κάθετη στοίχιση (row) κεντράρεται στον renderer.

export type FlowTone = "neutral" | "success" | "warning" | "danger";

export type FlowNodeData = {
  title: string;
  subtitle?: string;
  /** Μικρές γραμμές λεπτομέρειας κάτω από τον τίτλο. */
  lines?: string[];
  tone?: FlowTone;
  /** Σύνδεσμος σε σχετική οθόνη (ο κόμβος γίνεται clickable). */
  href?: string;
};

export type FlowNode = { id: string; col: number; row: number; data: FlowNodeData };
export type FlowEdge = { id: string; source: string; target: string; label?: string };
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };

export type LotGraphInput = {
  lot: { id: string; batchNumber: string | null; itemName: string; expiresLabel: string | null; expired: boolean };
  document: { id: string; number: string | null; issuedLabel: string; supplierName: string } | null;
  consumptions: { batchId: string; batchNumber: string; recipeName: string; producedLabel: string; quantityLabel: string }[];
};

/** Προμηθευτής → τιμολόγιο → παρτίδα υλικού → παρτίδες παραγωγής (οθόνη παρτίδας). */
export function lotTraceGraph(input: LotGraphInput): FlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let col = 0;

  if (input.document) {
    nodes.push({
      id: "supplier",
      col: col++,
      row: 0,
      data: { title: input.document.supplierName, subtitle: "Προμηθευτής" },
    });
    nodes.push({
      id: "document",
      col: col++,
      row: 0,
      data: {
        title: input.document.number ? `Τιμολόγιο ${input.document.number}` : "Παραστατικό αγοράς",
        subtitle: input.document.issuedLabel,
        href: `/purchases/${input.document.id}`,
      },
    });
    edges.push({ id: "e-supplier-doc", source: "supplier", target: "document" });
    edges.push({ id: "e-doc-lot", source: "document", target: "lot" });
  }

  nodes.push({
    id: "lot",
    col: col++,
    row: 0,
    data: {
      title: `Παρτίδα ${input.lot.batchNumber ?? "(χύμα)"}`,
      subtitle: input.lot.itemName,
      lines: input.lot.expiresLabel ? [`Λήξη: ${input.lot.expiresLabel}`] : undefined,
      tone: input.lot.expired ? "danger" : "neutral",
    },
  });

  input.consumptions.forEach((c, i) => {
    const id = `batch-${c.batchId}`;
    nodes.push({
      id,
      col,
      row: i,
      data: {
        title: `Παραγωγή ${c.batchNumber}`,
        subtitle: c.recipeName,
        lines: [c.producedLabel],
        href: `/production/${c.batchId}`,
      },
    });
    edges.push({ id: `e-lot-${c.batchId}`, source: "lot", target: id, label: c.quantityLabel });
  });

  return { nodes, edges };
}

export type BatchGraphInput = {
  batch: { batchNumber: string; recipeName: string; quantityLabel: string; producedLabel: string };
  /** Το προϊόν βιτρίνας που πουλάει η γεύση (αν έχει συνδεθεί στη συνταγή) — κλείνει τη ροή ως το ράφι. */
  product?: { name: string; salesLabel: string } | null;
  items: {
    lotId: string | null;
    itemName: string;
    lotBatchNumber: string | null;
    supplierName: string | null;
    quantityLabel: string | null;
  }[];
};

/** Παρτίδες υλικών → παρτίδα παραγωγής → προϊόν βιτρίνας (οθόνη παραγωγής). */
export function batchTraceGraph(input: BatchGraphInput): FlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  input.items.forEach((item, i) => {
    const id = `item-${i}`;
    nodes.push({
      id,
      col: 0,
      row: i,
      data: {
        title: item.itemName,
        subtitle: item.lotId ? `Παρτίδα ${item.lotBatchNumber ?? "(χύμα)"}` : "χωρίς απόθεμα",
        lines: item.supplierName ? [item.supplierName] : undefined,
        tone: item.lotId ? "neutral" : "warning",
        href: item.lotId ? `/traceability/lot/${item.lotId}` : undefined,
      },
    });
    if (item.lotId) {
      edges.push({ id: `e-${id}-batch`, source: id, target: "batch", label: item.quantityLabel ?? undefined });
    }
  });

  nodes.push({
    id: "batch",
    col: 1,
    row: 0,
    data: {
      title: `Παραγωγή ${input.batch.batchNumber}`,
      subtitle: input.batch.recipeName,
      lines: [input.batch.quantityLabel, input.batch.producedLabel],
      tone: "success",
    },
  });

  if (input.product) {
    nodes.push({
      id: "product",
      col: 2,
      row: 0,
      data: { title: input.product.name, subtitle: "Προϊόν βιτρίνας", lines: [input.product.salesLabel], tone: "neutral" },
    });
    edges.push({ id: "e-batch-product", source: "batch", target: "product" });
  }

  return { nodes, edges };
}
