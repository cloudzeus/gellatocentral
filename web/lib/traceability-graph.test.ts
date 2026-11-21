// Tests για τους κατασκευαστές γραφημάτων ιχνηλασιμότητας (lib/traceability-graph.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { batchTraceGraph, lotTraceGraph } from "./traceability-graph.ts";

test("γράφημα παρτίδας: προμηθευτής → τιμολόγιο → παρτίδα → παραγωγές", () => {
  const g = lotTraceGraph({
    lot: { id: "l1", batchNumber: "L-100", itemName: "Γάλα", expiresLabel: "01/02/2027", expired: false },
    document: { id: "d1", number: "Τ-55", issuedLabel: "10/01/2026", supplierName: "Γαλακτοκομική ΑΕ" },
    consumptions: [
      { batchId: "b1", batchNumber: "20261120-1", recipeName: "Σοκολάτα", producedLabel: "20/11/2026", quantityLabel: "5 kg" },
      { batchId: "b2", batchNumber: "20261120-2", recipeName: "Βανίλια", producedLabel: "20/11/2026", quantityLabel: "3 kg" },
    ],
  });

  assert.equal(g.nodes.length, 5);
  assert.deepEqual(
    g.nodes.map((n) => n.col),
    [0, 1, 2, 3, 3],
  );
  // ακμές: supplier→doc, doc→lot, lot→κάθε παραγωγή με ετικέτα ποσότητας
  assert.equal(g.edges.length, 4);
  assert.equal(g.edges.find((e) => e.target === "batch-b1")?.label, "5 kg");
  // οι παραγωγές και το τιμολόγιο είναι clickable
  assert.equal(g.nodes.find((n) => n.id === "batch-b2")?.data.href, "/production/b2");
  assert.equal(g.nodes.find((n) => n.id === "document")?.data.href, "/purchases/d1");
});

test("γράφημα παρτίδας χωρίς τιμολόγιο: η παρτίδα ξεκινά τη ροή", () => {
  const g = lotTraceGraph({
    lot: { id: "l1", batchNumber: null, itemName: "Ζάχαρη", expiresLabel: null, expired: false },
    document: null,
    consumptions: [],
  });
  assert.deepEqual(
    g.nodes.map((n) => n.id),
    ["lot"],
  );
  assert.equal(g.nodes[0].col, 0);
  assert.equal(g.edges.length, 0);
});

test("ληγμένη παρτίδα σημαίνεται danger", () => {
  const g = lotTraceGraph({
    lot: { id: "l1", batchNumber: "L-9", itemName: "Κρέμα", expiresLabel: "01/01/2026", expired: true },
    document: null,
    consumptions: [],
  });
  assert.equal(g.nodes[0].data.tone, "danger");
});

test("γράφημα παραγωγής: υλικά → παρτίδα, ακμή μόνο όταν υπάρχει παρτίδα υλικού", () => {
  const g = batchTraceGraph({
    batch: { batchNumber: "20261120-1", recipeName: "Σοκολάτα", quantityLabel: "10 kg", producedLabel: "20/11/2026" },
    items: [
      { lotId: "l1", itemName: "Γάλα", lotBatchNumber: "L-100", supplierName: "Γαλακτοκομική ΑΕ", quantityLabel: "5 kg" },
      { lotId: null, itemName: "Κακάο", lotBatchNumber: null, supplierName: null, quantityLabel: null },
    ],
  });
  assert.equal(g.nodes.length, 3);
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].source, "item-0");
  assert.equal(g.edges[0].target, "batch");
  // υλικό χωρίς απόθεμα: προειδοποιητικός τόνος, χωρίς σύνδεσμο
  assert.equal(g.nodes[1].data.tone, "warning");
  assert.equal(g.nodes[1].data.href, undefined);
  // η παρτίδα παραγωγής είναι στη στήλη 1 με τόνο επιτυχίας
  assert.equal(g.nodes[2].col, 1);
  assert.equal(g.nodes[2].data.tone, "success");
});

test("γράφημα παραγωγής με προϊόν βιτρίνας: η ροή κλείνει στο ράφι", () => {
  const g = batchTraceGraph({
    batch: { batchNumber: "20261120-1", recipeName: "Σοκολάτα", quantityLabel: "10 kg", producedLabel: "20/11/2026" },
    product: { name: "Παγωτό Σοκολάτα", salesLabel: "14 πωλήσεις" },
    items: [{ lotId: "l1", itemName: "Γάλα", lotBatchNumber: "L-100", supplierName: null, quantityLabel: "5 kg" }],
  });
  const product = g.nodes.find((n) => n.id === "product");
  assert.equal(product?.col, 2);
  assert.equal(product?.data.subtitle, "Προϊόν βιτρίνας");
  assert.ok(g.edges.some((e) => e.source === "batch" && e.target === "product"));
});
