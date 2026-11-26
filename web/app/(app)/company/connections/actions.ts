"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { redirectUrl } from "@/lib/flash";
import { recordCallEvent } from "@/lib/telephony/calls";
import { requireStockContext } from "@/lib/stock-context";

const back = (query: string): never => { revalidatePath("/company/connections"); redirect(redirectUrl(`/company/connections${query}`)); };
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** Στοιχεία του Yeastar. Κενό Client Secret = μένει το παλιό· το μυστικό του webhook το φτιάχνουμε εμείς μία φορά. */
export async function saveYeastar(form: FormData) {
  const ctx = await requireStockContext("users.edit");
  const baseUrl = text(form, "baseUrl").replace(/\/+$/, "");
  if (baseUrl && !/^https:\/\//i.test(baseUrl)) back(`?error=${encodeURIComponent("Η διεύθυνση του τηλεφωνικού κέντρου πρέπει να αρχίζει με https://")}`);
  const secret = text(form, "clientSecret");
  const data = { baseUrl: baseUrl || null, clientId: text(form, "clientId") || null, enabled: form.get("enabled") === "on", ...(secret ? { clientSecret: secret } : {}) };
  await db.integration.upsert({
    where: { orgId_kind: { orgId: ctx.orgId, kind: "YEASTAR" } },
    create: { orgId: ctx.orgId, kind: "YEASTAR", webhookSecret: randomBytes(16).toString("hex"), ...data },
    update: data,
  });
  back(`?saved=${encodeURIComponent("Τα στοιχεία του τηλεφωνικού κέντρου αποθηκεύτηκαν")}`);
}

/** Ποιο εσωτερικό ανοίγει την καρτέλα σε ποιο ταμείο. */
export async function saveExtensions(form: FormData) {
  const ctx = await requireStockContext("users.edit");
  const tills = await db.device.findMany({ where: { orgId: ctx.orgId, kind: { in: ["POS_ANDROID", "POS_WEB"] }, active: true }, select: { id: true } });
  const values = tills.map((d) => ({ id: d.id, ext: text(form, `ext_${d.id}`) || null }));
  const used = values.filter((v) => v.ext).map((v) => v.ext);
  if (new Set(used).size !== used.length) back(`?error=${encodeURIComponent("Το ίδιο εσωτερικό δόθηκε σε δύο ταμεία")}`);
  if (values.some((v) => v.ext && !/^\d{2,8}$/.test(v.ext))) back(`?error=${encodeURIComponent("Το εσωτερικό είναι αριθμός, π.χ. 201")}`);
  await db.$transaction(values.map((v) => db.device.update({ where: { id: v.id }, data: { pbxExtension: v.ext } })));
  back(`?saved=${encodeURIComponent("Τα εσωτερικά αποθηκεύτηκαν")}`);
}

/** Δοκιμαστική κλήση: σαν να χτυπά το εσωτερικό τώρα, για να δεις την καρτέλα στο ταμείο χωρίς τηλεφωνικό κέντρο. */
export async function testCall(form: FormData) {
  const ctx = await requireStockContext("users.edit");
  const phone = text(form, "phone").replace(/\D/g, "");
  if (phone.length < 10) back(`?error=${encodeURIComponent("Γράψε ένα τηλέφωνο με 10 ψηφία")}`);
  await recordCallEvent(ctx.orgId, { kind: "ring", callId: `test-${Date.now()}`, from: phone, extension: text(form, "extension") || null });
  back(`?saved=${encodeURIComponent("Η δοκιμαστική κλήση στάλθηκε. Η καρτέλα ανοίγει στο ταμείο σε 2 δευτερόλεπτα")}`);
}

/** Δοκιμαστική παραγγελία πλατφόρμας με είδη του καταλόγου και ένα άγνωστο, μέχρι να έρθουν τα κλειδιά της Wolt/efood. */
export async function testPlatformOrder(form: FormData) {
  const ctx = await requireStockContext("users.edit");
  const source = text(form, "source") === "EFOOD" ? "EFOOD" : "WOLT";
  const store = await db.store.findFirst({ where: { orgId: ctx.orgId, active: true, id: text(form, "storeId") || undefined }, select: { id: true } });
  if (!store) back(`?error=${encodeURIComponent("Δεν υπάρχει ενεργό κατάστημα")}`);
  const products = await db.product.findMany({ where: { orgId: ctx.orgId, active: true, modifierGroups: { none: {} } }, take: 2, select: { id: true, name: true, priceCents: true } });
  const lines = [...products.map((p, i) => ({ productId: p.id, name: p.name, quantity: i + 1, unitPriceCents: p.priceCents })), { productId: null, name: "Είδος της πλατφόρμας χωρίς αντιστοίχιση", quantity: 1, unitPriceCents: 350 }];
  const cash = form.get("cash") === "on";
  await db.order.create({
    data: {
      orgId: ctx.orgId, storeId: store!.id, source, externalId: `test-${Date.now()}`, customerName: "Δοκιμαστικός πελάτης", address: "Ερμού 10, Αθήνα",
      delivery: true, status: "NEW", payment: cash ? "DOOR_CASH" : "PLATFORM", totalCents: lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0),
      note: "Δοκιμή από την κονσόλα", lines: { create: lines },
    },
  });
  back(`?saved=${encodeURIComponent(`Η δοκιμαστική παραγγελία ${source === "WOLT" ? "Wolt" : "efood"} εμφανίζεται στο ταμείο, στις Παραγγελίες`)}`);
}
