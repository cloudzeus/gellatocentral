import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { GET as catalog } from "../app/api/pos/catalog/route.ts";
import { POST as createSale } from "../app/api/pos/sales/route.ts";
import { GET as checkResult, POST as reportResult } from "../app/api/pos/sales/[id]/result/route.ts";
import { db } from "./db.ts";
import { hashToken } from "./device-auth.ts";

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
    assert.equal((await f.call(createSale, "/sales", { method: "CASH", lines: [{ productId: f.product.id, quantity: 1 }] })).status, 200);
  } finally {
    await db.sale.deleteMany({ where: { orgId: f.org.id } }); // πρώτα οι πωλήσεις: το SaleLine → Product δεν σβήνει αλυσιδωτά
    await db.organization.delete({ where: { id: f.org.id } });
  }
});

test("PostgreSQL POS API: χωρίς έγκυρο κλειδί συσκευής 401", databaseOptions, async () => {
  const res = await catalog(new Request("http://till.test/api/pos/catalog", { headers: { Authorization: `Bearer ${"x".repeat(40)}` } }));
  assert.equal(res.status, 401);
});
