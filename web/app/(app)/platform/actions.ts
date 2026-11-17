"use server";
// Ενέργειες της κονσόλας πλατφόρμας: ο διαχειριστής ενεργεί για ΟΠΟΙΑΔΗΠΟΤΕ επιχείρηση (orgId από τη φόρμα).
// Κάθε action ξεκινά με requirePlatform(δικαίωμα): οι server actions καλούνται και απευθείας, όχι μόνο από τη σελίδα.

import { pingAi } from "@/lib/ai/openrouter";
import { cleanRemoteId } from "@/lib/remote";
import { type Group, GROUPS, saveGroup } from "@/lib/config";
import { ping } from "@/lib/storage/bunny";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { randomInt } from "node:crypto";
import { validAfm } from "@/lib/afm";
import { logAccess } from "@/lib/access-log";
import { requirePlatform } from "@/lib/auth";
import { permissionDiff } from "@/lib/access";
import { canGrant, isPlatformPermission, PLATFORM_PERMISSIONS, PLATFORM_ROLES, platformPermissionsOf, type PlatformRoleKey, staffPermissions, staffRoleLabel, SYSTEM_ROLES } from "@/lib/permissions";
import { savePlatformRoles, storedPlatformRoles } from "@/lib/platform-roles";
import { hashPassword } from "@/lib/password";
import { settleCharge } from "@/lib/billing";
import { DEVICE_KIND } from "@/lib/devices";
import { isRefList, REF_LISTS } from "@/lib/refs";
import { isModule } from "@/lib/modules";
import { db } from "@/lib/db";
import { appUrl, billingRecipients, platformSettings, sendMail } from "@/lib/mail/send";
import { templates } from "@/lib/mail/templates";
import { closingChecks, deleteOrgForever } from "@/lib/org-close";
import { canDelete, CLOSING_DAYS } from "@/lib/org-state";
import { nextCharge } from "@/lib/plan-data";
import { createResetLink } from "@/lib/reset";
import { testIsvCredentials } from "@/lib/viva/cloud-terminal";

const id = z.string().cuid();
const name = z.string().trim().min(2, "Το όνομα θέλει τουλάχιστον 2 χαρακτήρες").max(60);
const optional = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const RESERVED = ["www", "app", "api", "mail", "admin", "platform", "login", "static", "support"];
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/, "Ο υποτομέας: 3–30 μικρά λατινικά γράμματα, αριθμοί ή παύλες").refine((v) => !RESERVED.includes(v), "Αυτός ο υποτομέας είναι δεσμευμένος");
const email = z.string().trim().toLowerCase().email("Το email δεν είναι έγκυρο");
const series = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, "Η σειρά είναι 1–6 λατινικά γράμματα ή αριθμοί");

const identity = {
  macAddress: optional(17).refine((v) => !v || /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(v), "Η MAC γράφεται AA:BB:CC:DD:EE:FF").transform((v) => v?.toUpperCase() ?? null),
  tailscaleIp: optional(15).refine((v) => !v || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(\.\d{1,3}){2}$/.test(v), "Η διεύθυνση Tailscale είναι της μορφής 100.x.y.z (100.64–100.127)"),
};

/** Διαβάζει τη φόρμα· σε λάθος γυρίζει στη σελίδα με το μήνυμα (χωρίς JavaScript στον browser). */
function read<T extends z.ZodType>(schema: T, form: FormData, back: string): z.infer<T> {
  const r = schema.safeParse(Object.fromEntries(form));
  if (!r.success) redirect(`${back}?error=${encodeURIComponent(r.error.issues[0].message)}`);
  return r.data;
}
const done = (orgId: string, section: string): never => {
  revalidatePath("/platform", "layout");
  redirect(`/platform/${orgId}?saved=${section}#${section}`);
};
/** Το κατάστημα/εκτυπωτής πρέπει να ανήκει στην επιχείρηση της φόρμας. */
const ownStore = (orgId: string, storeId: string) => db.store.findFirst({ where: { id: storeId, orgId } });

export async function createOrganization(form: FormData) {
  await requirePlatform("orgs.create");
  const d = read(
    z.object({
      name,
      vatNumber: z.string().trim().refine(validAfm, "Το ΑΦΜ δεν είναι έγκυρο (9 ψηφία με σωστό ψηφίο ελέγχου)"),
      slug,
      contactEmail: email,
      storeName: name,
      storeAddress: optional(120),
      trialDays: z.coerce.number().int().min(0).max(90),
    }),
    form,
    "/platform",
  );
  if (await db.organization.findUnique({ where: { vatNumber: d.vatNumber } }))
    redirect(`/platform?error=${encodeURIComponent("Υπάρχει ήδη επιχείρηση με αυτό το ΑΦΜ")}`);
  if (await db.organization.findUnique({ where: { slug: d.slug } }))
    redirect(`/platform?error=${encodeURIComponent("Ο υποτομέας χρησιμοποιείται ήδη")}`);
  // Μία συναλλαγή: επιχείρηση + έδρα + κεντρική αποθήκη + πρώτο ταμείο + δοκιμαστική συνδρομή — ή τίποτα
  const org = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: d.name,
        vatNumber: d.vatNumber,
        slug: d.slug,
        contactEmail: d.contactEmail,
        subscription: { create: { status: "TRIALING", currentPeriodEnd: new Date(Date.now() + d.trialDays * 864e5) } },
        stores: { create: { name: d.storeName, address: d.storeAddress } },
        // κάθε συνδρομητής είναι και συναλλασσόμενος (πελάτης) της πλατφόρμας
        asParty: { create: { roles: ["customer"], name: d.name, vatNumber: d.vatNumber, email: d.contactEmail } },
      },
      include: { stores: true },
    });
    const at = { orgId: org.id, storeId: org.stores[0].id };
    await tx.orgRole.createMany({ data: SYSTEM_ROLES.map((r) => ({ orgId: org.id, system: true, ...r })) });
    await tx.warehouse.create({ data: { ...at, name: "Κεντρική αποθήκη" } });
    await tx.device.create({ data: { ...at, name: "Ταμείο 1", kind: "POS_WEB", series: "A1" } });
    return org;
  });
  await sendMail({
    to: d.contactEmail, template: "welcome", org,
    mail: templates.welcome(await platformSettings(), { orgName: org.name, trialEnds: new Date(Date.now() + d.trialDays * 864e5), url: await appUrl(org) }),
  });
  revalidatePath("/platform");
  redirect(`/platform/${org.id}`);
}

export async function saveSubscription(form: FormData) {
  const orgId = id.parse(form.get("orgId"));
  const admin = await requirePlatform("billing.manage");
  const d = read(z.object({ status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED"]), currentPeriodEnd: z.coerce.date(), planId: z.string().max(60).optional() }), form, `/platform/${orgId}`);
  const plan = d.planId ? await db.plan.findUnique({ where: { id: d.planId } }) : null;
  const before = await db.subscription.findUnique({ where: { orgId }, include: { plan: true } });
  const data = { status: d.status, currentPeriodEnd: d.currentPeriodEnd, planId: plan?.id ?? null };
  await db.subscription.upsert({ where: { orgId }, update: data, create: { orgId, ...data } });
  // διακοπή συνδρομής: από εδώ μετρά ο ένας μήνας που κρατάμε ΟΛΑ τα στοιχεία πριν επιτραπεί η διαγραφή
  if (d.status === "CANCELLED" && before?.status !== "CANCELLED") {
    const org = await db.organization.findUnique({ where: { id: orgId } });
    if (org && !org.closingAt) {
      const now = new Date();
      await db.organization.update({ where: { id: orgId }, data: { closingAt: now, deleteAfter: new Date(now.getTime() + CLOSING_DAYS * 864e5) } });
      await logAccess({ orgId, actorName: `${admin.name} (πλατφόρμα)`, action: "org.closing", target: org.name, detail: `Διακοπή συνδρομής: τα στοιχεία κρατιούνται ${CLOSING_DAYS} ημέρες` });
    }
  }
  if ((before?.planId ?? null) !== data.planId) await logAccess({ orgId, actorName: `${admin.name} (πλατφόρμα)`, action: "plan.changed", target: plan?.name ?? "Προεπιλεγμένο πακέτο", detail: `Πριν: ${before?.plan?.name ?? "προεπιλεγμένο"}` });
  done(orgId, "subscription");
}

/** Εκδίδει τη χρέωση του επόμενου μήνα από το πακέτο: καταστήματα και συσκευές ΑΥΤΗΣ της στιγμής, μείον την έκπτωση παύσης. */
export async function issueCharge(orgId: string) {
  await requirePlatform("billing.manage");
  const next = await nextCharge(id.parse(orgId));
  if (!next) redirect(`/platform/${orgId}?error=${encodeURIComponent("Δεν υπάρχει συνδρομή")}`);
  const { sub, plan, periodStart, periodEnd, calc, stores, devices } = next;
  const amountCents = calc.totalCents;
  // unique (συνδρομή, αρχή περιόδου): διπλό πάτημα δεν βγάζει δεύτερη χρέωση ούτε δίνει δεύτερη φορά την έκπτωση παύσης
  const created = await db.$transaction(async (tx) => {
    const { count } = await tx.subscriptionCharge.createMany({ data: [{ subscriptionId: sub.id, periodStart, periodEnd, stores: stores.length, devices, amountCents, planName: plan.name, lines: calc.lines }], skipDuplicates: true });
    if (count) {
      for (const p of calc.settled) await tx.storePause.update({ where: { id: p.pauseId }, data: { settledThrough: p.through } });
      await tx.subscription.update({ where: { id: sub.id }, data: { creditCents: calc.carryCents } });
    }
    return count;
  });
  // χρέωση 0 € (η έκπτωση παύσης κάλυψε τον μήνα): δεν υπάρχει κάτι να πληρωθεί, εξοφλείται αμέσως και η συνδρομή παρατείνεται
  if (created && amountCents === 0) {
    const zero = await db.subscriptionCharge.findUnique({ where: { subscriptionId_periodStart: { subscriptionId: sub.id, periodStart } } });
    if (zero) await settleCharge(zero.id);
  } else if (created) {
    const { org, to } = await billingRecipients(orgId);
    const mail = templates.chargeIssued(await platformSettings(), { orgName: org!.name, periodStart, periodEnd, stores: stores.length, devices, amountCents, payUrl: `${await appUrl(org)}/billing` });
    for (const address of to) await sendMail({ to: address, template: "chargeIssued", org, mail });
  }
  done(orgId, "subscription");
}

/** Σημειώνει τη χρέωση πληρωμένη και προχωρά τη λήξη της συνδρομής στο τέλος της περιόδου της. */
export async function markChargePaid(chargeId: string) {
  await requirePlatform("billing.manage");
  const charge = await settleCharge(id.parse(chargeId));
  if (!charge) return;
  done(charge.subscription.orgId, "subscription");
}

export async function saveViva(form: FormData) {
  await requirePlatform("setup.manage");
  const orgId = id.parse(form.get("orgId"));
  const d = read(z.object({ vivaMerchantId: optional(60).refine((v) => !v || /^[0-9a-f-]{36}$/i.test(v), "Ο κωδικός εμπόρου Viva είναι UUID (36 χαρακτήρες)") }), form, `/platform/${orgId}`);
  await db.organization.update({ where: { id: orgId }, data: d });
  done(orgId, "viva");
}

export async function addStore(form: FormData) {
  await requirePlatform("setup.manage");
  const orgId = id.parse(form.get("orgId"));
  const d = read(z.object({ name, address: optional(120), vivaSourceCode: optional(20) }), form, `/platform/${orgId}`);
  await db.store.create({ data: { orgId, ...d } });
  done(orgId, "stores");
}

export async function addWarehouse(form: FormData) {
  await requirePlatform("setup.manage");
  const orgId = id.parse(form.get("orgId"));
  const d = read(z.object({ name, storeId: id }), form, `/platform/${orgId}`);
  if (await ownStore(orgId, d.storeId)) await db.warehouse.create({ data: { orgId, ...d } });
  done(orgId, "warehouses");
}

export async function addPrinter(form: FormData) {
  await requirePlatform("setup.manage");
  const orgId = id.parse(form.get("orgId"));
  const d = read(
    z
      .object({ name, storeId: id, connection: z.enum(["NETWORK", "BLUETOOTH", "USB"]), address: optional(40), paperWidth: z.coerce.number().refine((w) => w === 58 || w === 80) })
      .refine((p) => p.connection !== "NETWORK" || /^\d{1,3}(\.\d{1,3}){3}(:\d{2,5})?$/.test(p.address ?? ""), "Δικτυακός εκτυπωτής: γράψε IP, π.χ. 192.168.1.50:9100")
      .refine((p) => p.connection !== "BLUETOOTH" || /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(p.address ?? ""), "Bluetooth: γράψε τη διεύθυνση MAC, π.χ. AA:BB:CC:DD:EE:FF"),
    form,
    `/platform/${orgId}`,
  );
  if (await ownStore(orgId, d.storeId)) await db.printer.create({ data: { orgId, ...d } });
  done(orgId, "printers");
}

const temperature = z.string().trim().refine((v) => v === "" || (Number.isFinite(Number(v.replace(",", "."))) && Math.abs(Number(v.replace(",", "."))) <= 100), "Η θερμοκρασία είναι αριθμός, π.χ. -18").transform((v) => (v === "" ? null : Number(v.replace(",", "."))));
/** Πεδία που έχουν νόημα μόνο σε ορισμένα είδη: τα υπόλοιπα μηδενίζονται ό,τι κι αν έστειλε η φόρμα. */
function forKind<T extends { kind: keyof typeof DEVICE_KIND; series?: string | null; vivaTerminalId: string | null; tempMin: number | null; tempMax: number | null; linkedDeviceId: string | null }>(v: T) {
  const k = DEVICE_KIND[v.kind];
  return {
    ...v,
    ...(k.invoices ? {} : { series: null, vivaTerminalId: null }),
    ...(k.storage ? {} : { tempMin: null, tempMax: null }),
    ...(v.kind === "SCALE" ? {} : { linkedDeviceId: null }),
  };
}
const limits = (v: { tempMin: number | null; tempMax: number | null }) => v.tempMin === null || v.tempMax === null || v.tempMin < v.tempMax;
/** Η ζυγαριά δένεται μόνο με ταμείο της ίδιας επιχείρησης. */
const ownTill = async (orgId: string, deviceId: string | null) => (deviceId && (await db.device.findFirst({ where: { id: deviceId, orgId, kind: { in: ["POS_WEB", "POS_ANDROID"] } } })) ? deviceId : null);

export async function addDevice(form: FormData) {
  await requirePlatform("setup.manage");
  const orgId = id.parse(form.get("orgId"));
  const d = read(
    z
      .object({ name, storeId: id, kind: z.enum(Object.keys(DEVICE_KIND) as [keyof typeof DEVICE_KIND, ...(keyof typeof DEVICE_KIND)[]]), series: series.or(z.literal("")), vivaTerminalId: optional(20), printerId: optional(40), linkedDeviceId: optional(40), tempMin: temperature, tempMax: temperature, ...identity })
      .refine((v) => !DEVICE_KIND[v.kind].invoices || v.series, "Το ταμείο θέλει σειρά αποδείξεων")
      .refine(limits, "Το κάτω όριο θερμοκρασίας πρέπει να είναι μικρότερο από το πάνω")
      .transform((v) => forKind({ ...v, series: v.series || null })),
    form,
    `/platform/${orgId}`,
  );
  if (!(await ownStore(orgId, d.storeId))) return;
  if (d.printerId && !(await db.printer.findFirst({ where: { id: d.printerId, orgId } }))) d.printerId = null;
  const linkedDeviceId = await ownTill(orgId, d.linkedDeviceId);
  if (d.series && (await db.device.findFirst({ where: { orgId, series: d.series } })))
    redirect(`/platform/${orgId}?error=${encodeURIComponent(`Η σειρά ${d.series} χρησιμοποιείται ήδη από άλλο ταμείο`)}#devices`);
  await db.$transaction(async (tx) => {
    // ψυγείο και αυτόματος πωλητής είναι και αποθηκευτικοί χώροι: ο χώρος δημιουργείται μαζί με τη συσκευή
    const warehouse = DEVICE_KIND[d.kind].storage ? await tx.warehouse.create({ data: { orgId, storeId: d.storeId, name: d.name } }) : null;
    await tx.device.create({ data: { orgId, ...d, linkedDeviceId, warehouseId: warehouse?.id } });
  });
  done(orgId, "devices");
}

/** Αλλαγή ρυθμίσεων σε υπάρχουσα συσκευή (είδος και σειρά δεν αλλάζουν ποτέ: θα έσπαγε η αρίθμηση). */
export async function updateDevice(form: FormData) {
  await requirePlatform("setup.manage");
  const orgId = id.parse(form.get("orgId"));
  const d = read(z.object({ deviceId: id, vivaTerminalId: optional(20), printerId: optional(40), linkedDeviceId: optional(40), tempMin: temperature, tempMax: temperature, ...identity }).refine(limits, "Το κάτω όριο θερμοκρασίας πρέπει να είναι μικρότερο από το πάνω"), form, `/platform/${orgId}`);
  const device = await db.device.findFirst({ where: { id: d.deviceId, orgId } });
  if (!device) return;
  if (d.printerId && !(await db.printer.findFirst({ where: { id: d.printerId, orgId } }))) d.printerId = null;
  // γράφονται μόνο αυτά τα πεδία· είδος και σειρά μένουν όπως είναι
  const v = forKind({ ...d, kind: device.kind, linkedDeviceId: await ownTill(orgId, d.linkedDeviceId === device.id ? null : d.linkedDeviceId) });
  await db.device.update({
    where: { id: device.id },
    data: { vivaTerminalId: v.vivaTerminalId, printerId: v.printerId, linkedDeviceId: v.linkedDeviceId, tempMin: v.tempMin, tempMax: v.tempMax, macAddress: v.macAddress, tailscaleIp: v.tailscaleIp },
  });
  done(orgId, "devices");
}

// ---- Απομακρυσμένη υποστήριξη (RustDesk) ----

/** Ο αριθμός RustDesk μιας συσκευής, όπως τον δείχνει το πρόγραμμα στη συσκευή. Κενό = αφαίρεση. */
export async function setRemoteId(orgId: string, deviceId: string, form: FormData) {
  await requirePlatform("setup.manage");
  const raw = String(form.get("remoteId") ?? "").trim();
  const remoteId = raw ? cleanRemoteId(raw) : null;
  if (raw && !remoteId) redirect(`/platform/${id.parse(orgId)}?error=${encodeURIComponent("Ο αριθμός RustDesk έχει 6 έως 32 ψηφία ή λατινικά γράμματα")}#devices`);
  await db.device.updateMany({ where: { id: id.parse(deviceId), orgId: id.parse(orgId) }, data: { remoteId } });
  done(orgId, "devices");
}

/** Καταγράφει ποιος συνδέεται, σε ποια συσκευή και γιατί, και μετά δείχνει τη σελίδα από όπου ανοίγει το RustDesk. */
export async function startRemote(orgId: string, deviceId: string, form: FormData) {
  const me = await requirePlatform("support.remote");
  const reason = String(form.get("reason") ?? "").trim().slice(0, 300);
  if (reason.length < 5) redirect(`/platform/${id.parse(orgId)}?error=${encodeURIComponent("Γράψε τον λόγο της σύνδεσης: τον βλέπει ο πελάτης στο ιστορικό του")}#devices`);
  const device = await db.device.findFirst({ where: { id: id.parse(deviceId), orgId: id.parse(orgId), remoteId: { not: null } } });
  if (!device) redirect(`/platform/${orgId}#devices`);
  const access = await db.remoteAccess.create({ data: { orgId, deviceId: device.id, startedById: me.id, startedByName: me.name, reason } });
  redirect(`/platform/remote/${access.id}`);
}

const TABLES = { stores: "store", warehouses: "warehouse", printers: "printer", devices: "device" } as const;
/** Ενεργοποίηση/απενεργοποίηση. Τίποτα δεν διαγράφεται: οι αποδείξεις δείχνουν σε καταστήματα και ταμεία. */
export async function toggleActive(orgId: string, section: keyof typeof TABLES, rowId: string) {
  await requirePlatform("setup.manage");
  id.parse(orgId);
  id.parse(rowId);
  const where = { id: rowId, orgId };
  // ίδιο σχήμα (id, orgId, active) και στους τέσσερις πίνακες
  const table = db[TABLES[section]] as unknown as typeof db.store;
  const row = await table.findFirst({ where, select: { active: true } });
  if (row) await table.updateMany({ where, data: { active: !row.active } });
  done(orgId, section);
}

export async function checkViva() {
  await requirePlatform("settings.manage");
  const error = await testIsvCredentials();
  redirect(`/platform?viva=${error ? `fail&error=${encodeURIComponent(error)}` : "ok"}`);
}

// ---- Πιστοποίηση συσκευών Android ----
const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // χωρίς 0/O/1/I που μπερδεύονται

/** Κωδικός σύζευξης μίας χρήσης (15′). Τον πληκτρολογεί ο τεχνικός στην εφαρμογή της συσκευής. */
export async function issuePairCode(orgId: string, deviceId: string) {
  await requirePlatform("setup.manage");
  const pairCode = Array.from({ length: 8 }, () => PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)]).join("");
  await db.device.updateMany({
    where: { id: id.parse(deviceId), orgId: id.parse(orgId), kind: { not: "POS_WEB" } },
    data: { pairCode, pairCodeExpiresAt: new Date(Date.now() + 15 * 60_000) },
  });
  done(orgId, "devices");
}

/** Ανάκληση: το κλειδί της συσκευής παύει να ισχύει αμέσως (χαμένη/κλεμμένη συσκευή). */
export async function revokeDevice(orgId: string, deviceId: string) {
  await requirePlatform("setup.manage");
  await db.device.updateMany({ where: { id: id.parse(deviceId), orgId: id.parse(orgId) }, data: { apiTokenHash: null, pairCode: null, pairCodeExpiresAt: null, pairedAt: null } });
  done(orgId, "devices");
}

// ---- Χρήστες και ρόλοι ----
export async function addUser(form: FormData) {
  const admin = await requirePlatform("users.manage");
  const orgId = id.parse(form.get("orgId"));
  const d = read(
    z.object({
      name,
      email: z.string().trim().toLowerCase().email("Το email δεν είναι έγκυρο"),
      roleId: z.string().min(1).max(60),
      storeId: optional(40),
      password: z.string().max(200).refine((p) => p === "" || p.length >= 10, "Ο κωδικός θέλει τουλάχιστον 10 χαρακτήρες"),
    }),
    form,
    `/platform/${orgId}`,
  );
  if (d.storeId && !(await ownStore(orgId, d.storeId))) d.storeId = null;
  const role = await db.orgRole.findFirst({ where: { id: d.roleId, orgId } }); // ο ρόλος πρέπει να είναι της ίδιας επιχείρησης
  if (!role) redirect(`/platform/${orgId}?error=${encodeURIComponent("Άγνωστος ρόλος")}#users`);
  if (await db.user.findUnique({ where: { email: d.email } }))
    redirect(`/platform/${orgId}?error=${encodeURIComponent("Υπάρχει ήδη χρήστης με αυτό το email")}#users`);
  const user = await db.user.create({
    data: { name: d.name, email: d.email, passwordHash: d.password ? hashPassword(d.password) : null, memberships: { create: { orgId, roleId: role.id, storeId: d.storeId } } },
  });
  // Χωρίς αρχικό κωδικό: ο χρήστης τον ορίζει μόνος του από τον σύνδεσμο της πρόσκλησης (72 ώρες)
  if (!d.password) {
    const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
    const url = await createResetLink(user.id, 72, org);
    await sendMail({ to: user.email, template: "invitation", org, mail: templates.invitation(await platformSettings(), { name: user.name, orgName: org.name, role: role.name, url }) });
  }
  await logAccess({ orgId, actorName: `${admin.name} (πλατφόρμα)`, action: "user.invited", target: `${user.name} · ${user.email}`, detail: `Ρόλος: ${role.name}` });
  done(orgId, "users");
}

/** Αφαίρεση πρόσβασης: σβήνει τη συμμετοχή και τις ανοιχτές συνεδρίες του χρήστη. */
export async function removeMember(orgId: string, membershipId: string) {
  const admin = await requirePlatform("users.manage");
  const m = await db.membership.findFirst({ where: { id: id.parse(membershipId), orgId: id.parse(orgId) }, include: { user: true, role: true } });
  if (m) {
    await db.$transaction([db.membership.delete({ where: { id: m.id } }), db.session.deleteMany({ where: { userId: m.userId } })]);
    await logAccess({ orgId, actorName: `${admin.name} (πλατφόρμα)`, action: "user.removed", target: `${m.user.name} · ${m.user.email}`, detail: `Ρόλος: ${m.role.name}` });
  }
  done(orgId, "users");
}

// ---- Στοιχεία επικοινωνίας και email ανά πελάτη ----
export async function saveOrgProfile(form: FormData) {
  await requirePlatform("setup.manage");
  const orgId = id.parse(form.get("orgId"));
  const d = read(z.object({ name, slug, contactEmail: email, emailFromName: optional(60) }), form, `/platform/${orgId}`);
  if (await db.organization.findFirst({ where: { slug: d.slug, NOT: { id: orgId } } }))
    redirect(`/platform/${orgId}?error=${encodeURIComponent("Ο υποτομέας χρησιμοποιείται ήδη")}#profile`);
  await db.organization.update({ where: { id: orgId }, data: d });
  done(orgId, "profile");
}

// ---- Ρυθμίσεις πλατφόρμας ----
export async function savePlatformSettings(form: FormData) {
  await requirePlatform("settings.manage");
  const d = read(
    z.object({
      brandName: name,
      baseDomain: optional(80).refine((v) => !v || /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(v), "Ο βασικός τομέας γράφεται χωρίς https://, π.χ. gelatosystem.app"),
      supportEmail: optional(120).refine((v) => !v || z.string().email().safeParse(v).success, "Το email υποστήριξης δεν είναι έγκυρο"),
    }),
    form,
    "/platform/settings",
  );
  await db.platformSettings.upsert({ where: { id: 1 }, update: d, create: { id: 1, ...d } });
  revalidatePath("/platform", "layout");
  redirect("/platform/settings?saved=1");
}

/** Αποθήκευση μιας ομάδας ρυθμίσεων σύνδεσης (Viva, Mailgun, Bunny, εφαρμογή). */
export async function saveConnection(group: string, form: FormData) {
  await requirePlatform("settings.manage");
  if (!(group in GROUPS)) redirect("/platform/settings");
  const error = await saveGroup(group as Group, form);
  revalidatePath("/platform", "layout");
  redirect(error ? `/platform/settings?error=${encodeURIComponent(error)}#${group}` : `/platform/settings?saved=${group}#${group}`);
}

export async function saveLegalSettings(form: FormData) {
  await requirePlatform("settings.manage");
  const link = (label: string) => optional(300).refine((v) => !v || /^https:\/\/\S+$/.test(v), `${label}: γράψε ολόκληρη διεύθυνση που αρχίζει με https://`);
  const d = read(z.object({ legalVersion: optional(20), termsUrl: link("Όροι χρήσης"), privacyUrl: link("Πολιτική απορρήτου") }), form, "/platform/settings");
  await db.platformSettings.upsert({ where: { id: 1 }, update: d, create: { id: 1, ...d } });
  redirect("/platform/settings?saved=legal#legal");
}

/** Δοκιμή μιας σύνδεσης με τις τιμές που ισχύουν τώρα. Το αποτέλεσμα φαίνεται στην κάρτα της. */
export async function testConnection(group: string) {
  const admin = await requirePlatform("settings.manage");
  let r: { ok: boolean; text: string };
  if (group === "bunny") r = await ping();
  else if (group === "openrouter") r = await pingAi();
  else if (group === "viva_isv") {
    const error = await testIsvCredentials();
    r = error ? { ok: false, text: `Η Viva δεν δέχτηκε τα κλειδιά: ${error}. Έλεγξε και το περιβάλλον (demo ή παραγωγή)` } : { ok: true, text: "Η Viva δέχτηκε τα κλειδιά ISV" };
  } else if (group === "mailgun") {
    const status = await sendMail({ to: admin.email, template: "test", mail: templates.test(await platformSettings(), { to: admin.email }) });
    r = status === "SENT" ? { ok: true, text: `Το δοκιμαστικό email στάλθηκε στο ${admin.email}. Κοίταξε τα εισερχόμενά σου` } : { ok: false, text: status === "SKIPPED" ? "Δεν στάλθηκε: λείπει το κλειδί ή ο τομέας του Mailgun" : "Το Mailgun απέρριψε την αποστολή. Δες το σφάλμα στο ιστορικό email πιο κάτω" };
  } else redirect("/platform/settings");
  redirect(`/platform/settings?test=${group}&ok=${r.ok ? 1 : 0}&msg=${encodeURIComponent(r.text)}#${group}`);
}

// ---- Προσωπικό πλατφόρμας (Super Admin, Manager, Υπάλληλος εφαρμογής, Υπάλληλος υποστήριξης) ----
// Η επιλογή ρόλου στη φόρμα: ένας από τους σταθερούς (π.χ. SUPPORT) ή δικός σας ρόλος ως «custom:<id>»
const platformRole = z.string().min(1).max(80);
const permLabel = (k: string) => PLATFORM_PERMISSIONS[k as keyof typeof PLATFORM_PERMISSIONS] ?? k;
/** Τι γράφεται στον χρήστη για την επιλογή της φόρμας. Κανείς δεν δίνει ρόλο με δικαιώματα που δεν έχει ο ίδιος. */
async function pickStaffRole(value: string, mine: string[]) {
  const custom = value.startsWith("custom:") ? await db.staffRole.findUnique({ where: { id: value.slice(7) } }) : null;
  if (!custom && !(value in PLATFORM_ROLES)) return staffFail("Άγνωστος ρόλος");
  const data = custom ? { platformRole: "STAFF" as const, staffRoleId: custom.id } : { platformRole: value as PlatformRoleKey, staffRoleId: null };
  const who = { platformRole: data.platformRole, staffRole: custom };
  if (!canGrant(mine, staffPermissions(who))) return staffFail(`Δεν μπορείς να δώσεις τον ρόλο «${staffRoleLabel(who)}»: έχει δικαιώματα που δεν έχεις εσύ`);
  return { data, label: staffRoleLabel(who) };
}
const staffFail = (message: string): never => redirect(`/platform/staff?error=${encodeURIComponent(message)}#staff`);
const staffDone = (): never => {
  revalidatePath("/", "layout"); // ρόλοι και δικαιώματα αλλάζουν και το μενού
  redirect("/platform/staff?saved=staff#staff");
};
// Σε κάθε αλλαγή ελέγχεται ότι μένει τουλάχιστον ένας Super Admin, αλλιώς κανείς δεν θα μπορούσε να ξαναδώσει ρόλους.
export async function addStaff(form: FormData) {
  const admin = await requirePlatform("staff.manage");
  const d = read(z.object({ name, email, platformRole }), form, "/platform/staff");
  if (await db.user.findUnique({ where: { email: d.email } })) staffFail("Υπάρχει ήδη χρήστης με αυτό το email");
  const picked = await pickStaffRole(d.platformRole, staffPermissions(admin));
  const user = await db.user.create({ data: { name: d.name, email: d.email, ...picked.data } });
  const brand = await platformSettings();
  const url = await createResetLink(user.id, 72);
  await sendMail({ to: user.email, template: "invitation", mail: templates.invitation(brand, { name: user.name, orgName: brand.brandName, role: picked.label, url }) });
  await logAccess({ orgId: null, actorName: admin.name, action: "user.invited", target: `${user.name} · ${user.email}`, detail: `Ρόλος: ${picked.label}` });
  staffDone();
}

export async function setStaffRole(form: FormData) {
  const admin = await requirePlatform("staff.manage");
  const d = read(z.object({ userId: id, platformRole }), form, "/platform/staff");
  const before = await db.user.findFirst({ where: { id: d.userId, platformRole: { not: null } }, include: { staffRole: true } });
  if (before && !canGrant(staffPermissions(admin), staffPermissions(before))) staffFail(`Ο ρόλος του χρήστη «${before.name}» έχει δικαιώματα που δεν έχεις εσύ`);
  const picked = await pickStaffRole(d.platformRole, staffPermissions(admin));
  try {
    await db.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { id: d.userId, platformRole: { not: null } }, data: picked.data });
      if ((await tx.user.count({ where: { platformRole: "SUPER_ADMIN", disabledAt: null } })) === 0) throw new Error("LOCKOUT");
    });
  } catch (e) {
    if (e instanceof Error && e.message === "LOCKOUT") staffFail("Πρέπει να μείνει τουλάχιστον ένας Super Admin");
    throw e;
  }
  if (before && staffRoleLabel(before) !== picked.label) await logAccess({ orgId: null, actorName: admin.name, action: "user.role", target: before.name, detail: `${staffRoleLabel(before)} → ${picked.label}` });
  staffDone();
}

/** Αφαιρεί την πρόσβαση στην κονσόλα και αποσυνδέει τον χρήστη. */
export async function removeStaff(userId: string) {
  const admin = await requirePlatform("staff.manage");
  const gone = await db.user.findFirst({ where: { id: id.parse(userId), platformRole: { not: null } } });
  try {
    await db.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { id: id.parse(userId), platformRole: { not: null } }, data: { platformRole: null, staffRoleId: null } });
      await tx.session.deleteMany({ where: { userId } });
      if ((await tx.user.count({ where: { platformRole: "SUPER_ADMIN", disabledAt: null } })) === 0) throw new Error("LOCKOUT");
    });
  } catch (e) {
    if (e instanceof Error && e.message === "LOCKOUT") staffFail("Πρέπει να μείνει τουλάχιστον ένας Super Admin");
    throw e;
  }
  if (gone) await logAccess({ orgId: null, actorName: admin.name, action: "user.removed", target: `${gone.name} · ${gone.email}` });
  staffDone();
}

/** Απενεργοποίηση μέλους προσωπικού: δεν συνδέεται, μένει στη λίστα με τον ρόλο του. */
export async function setStaffActive(userId: string, active: boolean) {
  const admin = await requirePlatform("staff.manage");
  const target = await db.user.findFirst({ where: { id: id.parse(userId), platformRole: { not: null } }, include: { staffRole: true } });
  if (!target?.platformRole) return;
  if (target.id === admin.id) staffFail("Δεν μπορείς να απενεργοποιήσεις τον εαυτό σου");
  if (!canGrant(staffPermissions(admin), staffPermissions(target))) staffFail(`Ο ρόλος του χρήστη «${target.name}» έχει δικαιώματα που δεν έχεις εσύ`);
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { disabledAt: active ? null : new Date() } });
      if (!active) await tx.session.deleteMany({ where: { userId: target.id } });
      if ((await tx.user.count({ where: { platformRole: "SUPER_ADMIN", disabledAt: null } })) === 0) throw new Error("LOCKOUT");
    });
  } catch (e) {
    if (e instanceof Error && e.message === "LOCKOUT") staffFail("Πρέπει να μείνει τουλάχιστον ένας ενεργός Super Admin");
    throw e;
  }
  await logAccess({ orgId: null, actorName: admin.name, action: active ? "user.enabled" : "user.disabled", target: target.name });
  staffDone();
}

/** Τα δικαιώματα ενός ρόλου προσωπικού. Ο Super Admin δεν αλλάζει· κανείς δεν δίνει δικαίωμα που δεν έχει ο ίδιος. */
export async function savePlatformRole(form: FormData) {
  const admin = await requirePlatform("staff.manage");
  const role = String(form.get("role")) as PlatformRoleKey;
  if (!(role in PLATFORM_ROLES) || role === "SUPER_ADMIN") staffFail("Αυτός ο ρόλος δεν αλλάζει");
  const mine = staffPermissions(admin);
  const before = platformPermissionsOf(role);
  const wanted = form.get("reset") ? PLATFORM_ROLES[role].permissions : form.getAll("permissions").filter(isPlatformPermission);
  if (!canGrant(mine, before) || !canGrant(mine, wanted)) staffFail("Δεν μπορείς να δώσεις ή να αλλάξεις δικαιώματα που δεν έχεις εσύ");
  await savePlatformRoles({ ...(await storedPlatformRoles()), [role]: wanted });
  await logAccess({ orgId: null, actorName: admin.name, action: "role.changed", target: PLATFORM_ROLES[role].label, detail: permissionDiff(before, wanted, permLabel) });
  staffDone();
}

/** Δικός σας ρόλος προσωπικού: νέος ή αλλαγή ονόματος και δικαιωμάτων. */
export async function saveStaffRole(form: FormData) {
  const admin = await requirePlatform("staff.manage");
  const d = read(z.object({ roleId: z.string().max(60), name }), form, "/platform/staff");
  const mine = staffPermissions(admin);
  const wanted = form.getAll("permissions").filter(isPlatformPermission);
  if (!canGrant(mine, wanted)) staffFail("Δεν μπορείς να δώσεις σε ρόλο δικαιώματα που δεν έχεις εσύ");
  // σύγκριση εδώ και όχι στη βάση: το ILIKE δεν πιάνει πάντα τα ελληνικά κεφαλαία (εξαρτάται από το locale της βάσης)
  const same = (x: string) => x.toLocaleLowerCase("el") === d.name.toLocaleLowerCase("el");
  const taken = [...Object.values(PLATFORM_ROLES).map((r) => r.label), ...(await db.staffRole.findMany({ where: { NOT: { id: d.roleId || undefined } }, select: { name: true } })).map((r) => r.name)];
  if (taken.some(same)) staffFail(`Υπάρχει ήδη ρόλος «${d.name}»`);
  if (!d.roleId) {
    await db.staffRole.create({ data: { name: d.name, permissions: wanted } });
    await logAccess({ orgId: null, actorName: admin.name, action: "role.created", target: d.name, detail: permissionDiff([], wanted, permLabel) });
    return staffDone();
  }
  const role = await db.staffRole.findUnique({ where: { id: d.roleId } });
  if (!role) return staffFail("Άγνωστος ρόλος");
  if (!canGrant(mine, role.permissions)) staffFail(`Ο ρόλος «${role.name}» έχει δικαιώματα που δεν έχεις εσύ`);
  await db.staffRole.update({ where: { id: role.id }, data: { name: d.name, permissions: wanted } });
  await logAccess({ orgId: null, actorName: admin.name, action: "role.changed", target: d.name, detail: `${role.name === d.name ? "" : `Νέο όνομα (πριν: ${role.name}) · `}${permissionDiff(role.permissions, wanted, permLabel)}` });
  staffDone();
}

export async function deleteStaffRole(roleId: string) {
  const admin = await requirePlatform("staff.manage");
  const role = await db.staffRole.findUnique({ where: { id: id.parse(roleId) }, include: { _count: { select: { users: true } } } });
  if (!role) return;
  if (role._count.users) staffFail(`Ο ρόλος «${role.name}» έχει ${role._count.users} άτομα. Άλλαξέ τους ρόλο πρώτα`);
  await db.staffRole.delete({ where: { id: role.id } });
  await logAccess({ orgId: null, actorName: admin.name, action: "role.deleted", target: role.name });
  staffDone();
}

// ---- Συνέχεια λειτουργίας: καταγραφή ότι ο έλεγχος έγινε σήμερα ----
export async function recordContinuityCheck(what: "backup" | "drill") {
  await requirePlatform("settings.manage");
  const data = z.enum(["backup", "drill"]).parse(what) === "backup" ? { lastBackupCheckAt: new Date() } : { lastRestoreDrillAt: new Date() };
  await db.platformSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  revalidatePath("/platform/continuity");
  redirect("/platform/continuity?saved=1");
}

// ---- Πακέτα συνδρομής και τιμές ----
// το πρώτο πακέτο έχει σταθερό id («plan_default»), όχι cuid
const planKey = z.string().min(1).max(60);
const plansBack = (q: string): never => {
  revalidatePath("/", "layout"); // ένα πακέτο αλλάζει τι βλέπει κάθε πελάτης που το έχει
  redirect(`/platform/plans?${q}`);
};
const cents = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "0").replace(",", ".")) * 100);

export async function savePlan(form: FormData) {
  const admin = await requirePlatform("billing.manage");
  const planId = String(form.get("planId") ?? "");
  const d = z.object({ name, description: z.string().trim().max(200), pausePercent: z.coerce.number().int().min(0).max(100), pauseMaxDaysPerYear: z.coerce.number().int().min(0).max(365) }).safeParse(Object.fromEntries(form));
  if (!d.success) return plansBack(`error=${encodeURIComponent(d.error.issues[0].message)}`);
  const storeCents = cents(form.get("storeCents"));
  const devicePrices = Object.fromEntries(Object.keys(DEVICE_KIND).map((k) => [k, cents(form.get(`device_${k}`))]));
  if (![storeCents, ...Object.values(devicePrices)].every((n) => Number.isInteger(n) && n >= 0 && n <= 1_000_000)) return plansBack(`error=${encodeURIComponent("Οι τιμές είναι ποσά σε ευρώ, από 0 και πάνω")}`);
  const modules = form.getAll("modules").filter(isModule);
  const pausedModules = form.getAll("pausedModules").filter(isModule).filter((m) => modules.includes(m));
  const same = (x: string) => x.toLocaleLowerCase("el") === d.data.name.toLocaleLowerCase("el");
  if ((await db.plan.findMany({ where: { NOT: { id: planId || undefined } }, select: { name: true } })).some((p) => same(p.name))) return plansBack(`error=${encodeURIComponent(`Υπάρχει ήδη πακέτο «${d.data.name}»`)}`);
  const data = { ...d.data, description: d.data.description || null, storeCents, devicePrices, modules, pausedModules };
  if (planId) await db.plan.update({ where: { id: planKey.parse(planId) }, data });
  else await db.plan.create({ data: { ...data, isDefault: (await db.plan.count()) === 0 } });
  await logAccess({ orgId: null, actorName: admin.name, action: "plan.changed", target: d.data.name, detail: planId ? "Αλλαγή τιμών ή ενοτήτων" : "Νέο πακέτο" });
  plansBack("saved=1");
}

/** Ανενεργό πακέτο: δεν δίνεται σε νέους πελάτες· όσοι το έχουν το κρατούν. Το προεπιλεγμένο δεν απενεργοποιείται. */
export async function togglePlan(planId: string) {
  await requirePlatform("billing.manage");
  const plan = await db.plan.findUnique({ where: { id: planKey.parse(planId) } });
  if (!plan) return;
  if (plan.isDefault && plan.active) return plansBack(`error=${encodeURIComponent("Το προεπιλεγμένο πακέτο δεν απενεργοποιείται. Όρισε πρώτα άλλο ως προεπιλογή")}`);
  await db.plan.update({ where: { id: plan.id }, data: { active: !plan.active } });
  plansBack("saved=1");
}

export async function setDefaultPlan(planId: string) {
  await requirePlatform("billing.manage");
  const plan = await db.plan.findFirst({ where: { id: planKey.parse(planId), active: true } });
  if (!plan) return;
  await db.$transaction([db.plan.updateMany({ data: { isDefault: false } }), db.plan.update({ where: { id: plan.id }, data: { isDefault: true } })]);
  plansBack("saved=1");
}

export async function deletePlan(planId: string) {
  await requirePlatform("billing.manage");
  const plan = await db.plan.findUnique({ where: { id: planKey.parse(planId) }, include: { _count: { select: { subscriptions: true } } } });
  if (!plan) return;
  if (plan.isDefault || plan._count.subscriptions) return plansBack(`error=${encodeURIComponent(plan.isDefault ? "Το προεπιλεγμένο πακέτο δεν διαγράφεται" : `Το πακέτο «${plan.name}» το έχουν ${plan._count.subscriptions} πελάτες. Απενεργοποίησέ το`)}`);
  await db.plan.delete({ where: { id: plan.id } });
  plansBack("saved=1");
}

// ---- Αναστολή και κλείσιμο επιχείρησης ----
const lifeBack = (orgId: string, q: string): never => {
  revalidatePath("/", "layout"); // αλλάζει τι βλέπουν όλοι οι χρήστες της επιχείρησης
  redirect(`/platform/${orgId}?${q}#lifecycle`);
};
const kick = (orgId: string) => db.session.deleteMany({ where: { user: { memberships: { some: { orgId } } } } });

/** Αναστολή: το ταμείο και οι ενότητες κλείνουν αμέσως· μένουν αποδείξεις, συνδρομή και υποστήριξη. Τίποτα δεν σβήνεται. */
export async function suspendOrg(form: FormData) {
  const admin = await requirePlatform("billing.manage");
  const orgId = id.parse(form.get("orgId"));
  const reason = z.string().trim().min(5, "Γράψε τον λόγο της αναστολής (τον βλέπει ο πελάτης)").max(300).safeParse(form.get("reason"));
  if (!reason.success) return lifeBack(orgId, `error=${encodeURIComponent(reason.error.issues[0].message)}`);
  const org = await db.organization.update({ where: { id: orgId }, data: { suspendedAt: new Date(), suspendedReason: reason.data } });
  await logAccess({ orgId, actorName: `${admin.name} (πλατφόρμα)`, action: "org.suspended", target: org.name, detail: reason.data });
  lifeBack(orgId, "saved=lifecycle");
}

export async function resumeOrg(orgId: string) {
  const admin = await requirePlatform("billing.manage");
  const org = await db.organization.update({ where: { id: id.parse(orgId) }, data: { suspendedAt: null, suspendedReason: null } });
  await logAccess({ orgId, actorName: `${admin.name} (πλατφόρμα)`, action: "org.resumed", target: org.name });
  lifeBack(orgId, "saved=lifecycle");
}

/** Έναρξη κλεισίματος: περιορισμένη λειτουργία και προθεσμία για εξαγωγή δεδομένων. Αναιρείται μέχρι την οριστική διαγραφή. */
export async function startClosing(form: FormData) {
  const admin = await requirePlatform("orgs.create");
  const orgId = id.parse(form.get("orgId"));
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) return;
  if (String(form.get("confirm") ?? "").trim() !== org.vatNumber) return lifeBack(orgId, `error=${encodeURIComponent("Για επιβεβαίωση γράψε το ΑΦΜ της επιχείρησης")}`);
  const now = new Date();
  await db.organization.update({ where: { id: orgId }, data: { closingAt: now, deleteAfter: new Date(now.getTime() + CLOSING_DAYS * 864e5) } });
  await db.subscription.updateMany({ where: { orgId }, data: { status: "CANCELLED" } });
  await logAccess({ orgId, actorName: `${admin.name} (πλατφόρμα)`, action: "org.closing", target: org.name, detail: `Διαγραφή επιτρέπεται μετά από ${CLOSING_DAYS} ημέρες` });
  lifeBack(orgId, "saved=lifecycle");
}

export async function cancelClosing(orgId: string) {
  const admin = await requirePlatform("orgs.create");
  const org = await db.organization.update({ where: { id: id.parse(orgId) }, data: { closingAt: null, deleteAfter: null } });
  await logAccess({ orgId, actorName: `${admin.name} (πλατφόρμα)`, action: "org.closing_cancelled", target: org.name, detail: "Η συνδρομή μένει ακυρωμένη: όρισέ την ξανά από την κάρτα Συνδρομή" });
  lifeBack(orgId, "saved=lifecycle");
}

/** Οριστική διαγραφή: μόνο Super Admin, μόνο μετά την προθεσμία, και με το ΑΦΜ γραμμένο για επιβεβαίωση. ΔΕΝ αναιρείται. */
export async function deleteOrg(form: FormData) {
  const admin = await requirePlatform("settings.manage");
  const orgId = id.parse(form.get("orgId"));
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) return;
  if (!canDelete(org, new Date())) return lifeBack(orgId, `error=${encodeURIComponent("Η διαγραφή επιτρέπεται μόνο σε επιχείρηση που κλείνει και αφού περάσει η προθεσμία εξαγωγής")}`);
  if (String(form.get("confirm") ?? "").trim() !== org.vatNumber) return lifeBack(orgId, `error=${encodeURIComponent("Για επιβεβαίωση γράψε το ΑΦΜ της επιχείρησης")}`);
  // δεν σβήνουμε επιχείρηση με αποδείξεις που δεν έφτασαν στο myDATA, ούτε πριν πάρει ο έμπορος το αρχείο του
  const checks = await closingChecks(orgId);
  if (checks.stuck) return lifeBack(orgId, `error=${encodeURIComponent(`${checks.stuck} αποδείξεις δεν έχουν διαβιβαστεί (εκκρεμείς ή αποτυχημένες). Τακτοποίησέ τες πρώτα`)}`);
  if (checks.receipts && !checks.exportedAt) return lifeBack(orgId, `error=${encodeURIComponent("Δεν έχει κατέβει ακόμα το αντίγραφο των δεδομένων. Κατέβασέ το και δώσ' το στον πελάτη πριν από τη διαγραφή")}`);
  await kick(orgId);
  let result: { files: number; users: number };
  try {
    result = await deleteOrgForever(orgId);
  } catch (e) {
    console.error("org delete", orgId, e);
    return lifeBack(orgId, `error=${encodeURIComponent("Η διαγραφή σταμάτησε: κάποιο αρχείο δεν σβήστηκε από το Bunny. Τίποτα άλλο δεν χάθηκε· δοκίμασε ξανά")}`);
  }
  await logAccess({ orgId: null, actorName: admin.name, action: "org.deleted", target: `${org.name} · ΑΦΜ ${org.vatNumber}`, detail: `${checks.receipts} αποδείξεις${checks.first && checks.last ? ` (${checks.first.toLocaleDateString("el-GR")} – ${checks.last.toLocaleDateString("el-GR")})` : ""}, ${result.files} αρχεία, ${result.users} χρήστες · αντίγραφο δεδομένων: ${checks.exportedAt ? `${checks.exportedBy}, ${checks.exportedAt.toLocaleDateString("el-GR")}` : "δεν χρειάστηκε"}` });
  revalidatePath("/platform");
  redirect("/platform?saved=deleted");
}

// ---- Λίστες αναφοράς (κοινές για όλους τους συνδρομητές) ----
const refsBack = (list: string, q: string): never => {
  revalidatePath("/", "layout");
  redirect(`/platform/refs?list=${list}&${q}`);
};
export async function saveRef(form: FormData) {
  await requirePlatform("settings.manage");
  const list = form.get("list");
  if (!isRefList(list)) redirect("/platform/refs");
  const d = z.object({ refId: z.string().max(80), code: z.string().trim().min(1, "Γράψε κωδικό").max(20), label: z.string().trim().min(1, "Γράψε περιγραφή").max(120), value: z.string().trim().transform((v) => (v === "" ? null : Number(v))).refine((v) => v === null || Number.isInteger(v), "Η τιμή είναι ακέραιος αριθμός") }).safeParse(Object.fromEntries(form));
  if (!d.success) return refsBack(list, `error=${encodeURIComponent(d.error.issues[0].message)}`);
  const code = list === "country" ? d.data.code.toUpperCase() : d.data.code;
  if (list === "country" && !/^[A-Z]{2}$/.test(code)) return refsBack(list, `error=${encodeURIComponent("Ο κωδικός χώρας έχει δύο λατινικά γράμματα, π.χ. GR")}`);
  if (await db.refItem.findFirst({ where: { list, code, NOT: { id: d.data.refId || undefined } } })) return refsBack(list, `error=${encodeURIComponent(`Υπάρχει ήδη τιμή με κωδικό «${code}» στη λίστα «${REF_LISTS[list].label}»`)}`);
  const data = { code, label: d.data.label, value: d.data.value };
  if (d.data.refId) await db.refItem.updateMany({ where: { id: d.data.refId, list }, data });
  else await db.refItem.create({ data: { ...data, list, sort: await db.refItem.count({ where: { list } }) } });
  refsBack(list, "saved=1");
}
/** Τιμή που μπορεί να χρησιμοποιείται δεν σβήνεται: κρύβεται από τις νέες καταχωρίσεις και ξαναεμφανίζεται με ένα κλικ. */
export async function toggleRef(refId: string) {
  await requirePlatform("settings.manage");
  const r = await db.refItem.findUnique({ where: { id: refId } });
  if (!r) return;
  await db.refItem.update({ where: { id: r.id }, data: { active: !r.active } });
  refsBack(r.list, "saved=1");
}
