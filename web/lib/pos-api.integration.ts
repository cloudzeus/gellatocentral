import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { GET as catalog } from "../app/api/pos/catalog/route.ts";
import { POST as createSale } from "../app/api/pos/sales/route.ts";
import { GET as checkResult, POST as reportResult } from "../app/api/pos/sales/[id]/result/route.ts";
import { db } from "./db.ts";
import { hashToken } from "./device-auth.ts";
import { resolveStaleSales, STALE_SALE_MS } from "./sale-resolve.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };

// Το συμβόλαιο που περιμένει η εφαρμογή Android (mobile/api.ts). Όποιος το αλλάξει, σπάει ταμεία στα καταστήματα.
async function fixture() {
  const suffix = randomUUID();
  const org = await db.organization.create({ data: { name: `POS API ${suffix}`, vatNumber: `POS-${suffix}` } });
  const store = await db.store.create({ data: { orgId: org.id, name: "Κατάστημα POS API" } });
  const token = randomBytes(32).toString("base64url");
  const device = await db.device.create({ data: { orgId: org.id, storeId: store.id, name: "Ταμείο API", kind: "POS_ANDROID", series: `T${suffix.slice(0, 6)}`, apiTokenHash: hashToken(token) } });
  const vat = await db.vatRate.upsert({ where: { name: "POS API 13%" }, update: {}, create: { name: "POS API 13%", rate: 13 } });
  const category = await db.category.create({ data: { orgId: org.id, name: "Παγωτά" } });
  const product = await db.product.create({ data: { orgId: org.id, categoryId: category.id, vatRateId: vat.id, name: "Φιστίκι", priceCents: 350 } });
  const call = (handler: (req: Request, ctx: never) => Promise<Response>, path: string, body?: unknown, id?: string) =>
    handler(new Request(`http://till.test/api/pos${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve({ id }) } as never);
  return { org, device, product, call };
}

test("PostgreSQL POS API: η πώληση δέχεται method ή methodId και το busy επιστρέφει την ίδια εκκρεμή πώληση", databaseOptions, async () => {
  const f = await fixture();
  try {
    const cat = await (await f.call(catalog, "/catalog")).json();
    assert.equal(cat.categories[0].products[0].priceCents, 350);
    assert.equal(cat.categories[0].products[0].vatRate, 13);
    const card = cat.paymentMethods.find((m: { code: string }) => m.code === "card");
    assert.ok(card?.id, "ο κατάλογος δίνει τους τρόπους πληρωμής του ταμείου");

    assert.equal((await f.call(createSale, "/sales", { lines: [{ productId: f.product.id, quantity: 2 }] })).status, 400, "χωρίς τρόπο πληρωμής");
    assert.equal((await (await f.call(createSale, "/sales", { methodId: "δεν-υπάρχει", lines: [{ productId: f.product.id, quantity: 2 }] })).json()).error, "method_unavailable");

    // όπως στέλνει το παλιό build της εφαρμογής
    const first = await f.call(createSale, "/sales", { method: "CARD", lines: [{ productId: f.product.id, quantity: 2 }] });
    assert.equal(first.status, 200);
    const sale = await first.json();
    assert.equal(sale.amountCents, 700);
    assert.ok(sale.saleId && sale.reference && sale.fiscalisationData);

    // δεύτερη πώληση όσο η πρώτη περιμένει: 409 με την εκκρεμή, ίδια ακριβώς δεδομένα σήμανσης
    const second = await f.call(createSale, "/sales", { methodId: card.id, lines: [{ productId: f.product.id, quantity: 1 }] });
    assert.equal(second.status, 409);
    const busy = await second.json();
    assert.equal(busy.error, "busy");
    assert.equal(busy.pending.saleId, sale.saleId);
    assert.equal(busy.pending.amountCents, 700);
    assert.equal(busy.pending.fiscalisationData, sale.fiscalisationData);

    // χωρίς κλειδιά Viva ο έλεγχος δεν αποφασίζει: η πώληση μένει σε αναμονή, δεν γίνεται «πληρώθηκε»
    const check = await f.call(checkResult, `/sales/${sale.saleId}/result`, undefined, sale.saleId);
    assert.notEqual((await check.json()).status, "completed");
    assert.equal((await db.sale.findUniqueOrThrow({ where: { id: sale.saleId } })).status, "AWAITING_PAYMENT");

    // η συσκευή δηλώνει αποτυχία: η πώληση γυρίζει σε πρόχειρο και το ταμείο ελευθερώνεται
    const failed = await f.call(reportResult, `/sales/${sale.saleId}/result`, { success: false, callback: "gelatosystem://viva-result?status=fail" }, sale.saleId);
    assert.deepEqual(await failed.json(), { ok: true });
    assert.equal((await (await f.call(checkResult, `/sales/${sale.saleId}/result`, undefined, sale.saleId)).json()).status, "failed");
    const again = await f.call(createSale, "/sales", { method: "CASH", lines: [{ productId: f.product.id, quantity: 1 }] });
    assert.equal(again.status, 200);

    // η πώληση έκλεισε ως πληρωμένη και η συσκευή ξαναστέλνει παλιά δήλωση αποτυχίας: η απάντηση λέει «πληρώθηκε»
    const paid = await again.json();
    await db.sale.update({ where: { id: paid.saleId }, data: { status: "COMPLETED" } });
    const repeated = await (await f.call(reportResult, `/sales/${paid.saleId}/result`, { success: false, callback: "gelatosystem://viva-result?status=fail" }, paid.saleId)).json();
    assert.equal(repeated.ok, true);
    assert.ok(repeated.aa != null && repeated.series, "με αριθμό απόδειξης, ώστε η συσκευή να μην το διαβάσει ως αποτυχία");
    assert.equal((await db.sale.findUniqueOrThrow({ where: { id: paid.saleId } })).status, "COMPLETED");
  } finally {
    await db.sale.deleteMany({ where: { orgId: f.org.id } }); // πρώτα οι πωλήσεις: το SaleLine → Product δεν σβήνει αλυσιδωτά
    await db.organization.delete({ where: { id: f.org.id } });
  }
});

test("PostgreSQL POS API: χωρίς έγκυρο κλειδί συσκευής 401", databaseOptions, async () => {
  const res = await catalog(new Request("http://till.test/api/pos/catalog", { headers: { Authorization: `Bearer ${"x".repeat(40)}` } }));
  assert.equal(res.status, 401);
});

test("PostgreSQL POS API: ίδιο clientRef δεν φτιάχνει δεύτερη πώληση, ούτε μετά την πληρωμή ούτε ταυτόχρονα", databaseOptions, async () => {
  const f = await fixture();
  try {
    const sale = (ref: string, quantity = 1) => f.call(createSale, "/sales", { method: "CARD", clientRef: ref, lines: [{ productId: f.product.id, quantity }] });
    const first = await sale("ref-aaaaaaaa", 2);
    assert.equal(first.status, 200);
    const started = await first.json();

    // η απάντηση χάθηκε, το ταμείο ξαναστέλνει: η ίδια εκκρεμής πώληση
    const retry = await sale("ref-aaaaaaaa", 2);
    assert.equal(retry.status, 409);
    assert.equal((await retry.json()).pending.saleId, started.saleId);

    // πληρώθηκε στο μεταξύ (π.χ. τερματικό σε άλλη συσκευή): «πληρώθηκε», όχι νέα χρέωση
    await db.sale.update({ where: { id: started.saleId }, data: { status: "COMPLETED", series: "T", aa: 7 } });
    const paid = await sale("ref-aaaaaaaa", 2);
    assert.equal(paid.status, 200);
    assert.deepEqual(await paid.json(), { paid: true, saleId: started.saleId, series: "T", aa: 7 });
    assert.equal(await db.sale.count({ where: { orgId: f.org.id } }), 1);

    // δύο ταυτόχρονα με νέο κλειδί: μία πώληση
    const both = await Promise.all([sale("ref-bbbbbbbb"), sale("ref-bbbbbbbb")]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await db.sale.count({ where: { orgId: f.org.id, clientRef: "ref-bbbbbbbb" } }), 1);
  } finally {
    await db.sale.deleteMany({ where: { orgId: f.org.id } });
    await db.organization.delete({ where: { id: f.org.id } });
  }
});

test("PostgreSQL cron: πώληση που κόλλησε σε αναμονή λύνεται από τη Viva, και χωρίς απάντηση μένει όπως είναι", databaseOptions, async () => {
  const f = await fixture();
  try {
    await db.device.update({ where: { id: f.device.id }, data: { vivaTerminalId: "TERM-1" } });
    const start = async () => {
      const r = await (await f.call(createSale, "/sales", { method: "CARD", lines: [{ productId: f.product.id, quantity: 1 }] })).json();
      const sale = await db.sale.findUniqueOrThrow({ where: { id: r.saleId }, include: { payment: true } });
      return sale;
    };
    const later = (sale: { issuedAt: Date | null }) => new Date(sale.issuedAt!.getTime() + STALE_SALE_MS + 1000);
    const session = (sale: { id: string; payment: { vivaSessionId: string | null } | null }, success: boolean) => async (id: string) =>
      id !== sale.payment!.vivaSessionId ? null
        : { sessionId: id, merchantReference: sale.id, cashRegisterId: f.device.id, terminalId: "TERM-1", amount: 350, success, eventId: success ? 0 : 1100, ...(success ? { transactionId: "tx-1", cardType: "VISA" } : {}) };

    // χωρίς απάντηση της Viva: μένει σε αναμονή, ποτέ «απέτυχε» από μόνο του
    const a = await start();
    assert.ok((await resolveStaleSales(later(a), async () => null)).unknown >= 1);
    assert.equal((await db.sale.findUniqueOrThrow({ where: { id: a.id } })).status, "AWAITING_PAYMENT");
    // πριν περάσουν τα λεπτά αναμονής δεν ρωτάμε καθόλου
    assert.equal((await resolveStaleSales(a.issuedAt!, session(a, true))).checked, 0);

    // η Viva λέει «πληρώθηκε»: απόδειξη
    await resolveStaleSales(later(a), session(a, true));
    assert.equal((await db.sale.findUniqueOrThrow({ where: { id: a.id } })).status, "COMPLETED");

    // η Viva λέει «απέτυχε»: πρόχειρο, το ταμείο ελευθερώνεται
    const b = await start();
    await resolveStaleSales(later(b), session(b, false));
    assert.equal((await db.sale.findUniqueOrThrow({ where: { id: b.id } })).status, "DRAFT");
  } finally {
    await db.sale.deleteMany({ where: { orgId: f.org.id } });
    await db.organization.delete({ where: { id: f.org.id } });
  }
});
