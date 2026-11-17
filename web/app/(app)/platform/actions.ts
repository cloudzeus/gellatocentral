"use server";
// Ενέργειες της κονσόλας πλατφόρμας: ο διαχειριστής ενεργεί για ΟΠΟΙΑΔΗΠΟΤΕ επιχείρηση (orgId από τη φόρμα).
// Κάθε action ξεκινά με requirePlatform(δικαίωμα): οι server actions καλούνται και απευθείας, όχι μόνο από τη σελίδα.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { randomInt } from "node:crypto";
import { validAfm } from "@/lib/afm";
import { requirePlatform } from "@/lib/auth";
import { PLATFORM_ROLES, SYSTEM_ROLES } from "@/lib/permissions";
import { hashPassword } from "@/lib/password";
import { settleCharge } from "@/lib/billing";
import { DEVICE_KIND } from "@/lib/devices";
import { db } from "@/lib/db";
import { appUrl, billingRecipients, platformSettings, sendMail } from "@/lib/mail/send";
import { templates } from "@/lib/mail/templates";
import { BILLABLE_KINDS, monthlyCharge } from "@/lib/pricing";
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
  await requirePlatform("billing.manage");
  const orgId = id.parse(form.get("orgId"));
  const d = read(z.object({ status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED"]), currentPeriodEnd: z.coerce.date() }), form, `/platform/${orgId}`);
  await db.subscription.upsert({ where: { orgId }, update: d, create: { orgId, ...d } });
  done(orgId, "subscription");
}

/** Εκδίδει τη χρέωση του επόμενου μήνα με το πλήθος καταστημάτων/συσκευών ΑΥΤΗΣ της στιγμής. */
export async function issueCharge(orgId: string) {
  await requirePlatform("billing.manage");
  id.parse(orgId);
  const [sub, stores, devices] = await Promise.all([
    db.subscription.findUnique({ where: { orgId } }),
    db.store.count({ where: { orgId, active: true } }),
    db.device.count({ where: { orgId, active: true, kind: { in: [...BILLABLE_KINDS] } } }),
  ]);
  if (!sub) redirect(`/platform/${orgId}?error=${encodeURIComponent("Δεν υπάρχει συνδρομή")}`);
  const periodStart = sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date(new Date().toDateString());
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  // unique (συνδρομή, αρχή περιόδου): διπλό πάτημα δεν βγάζει δεύτερη χρέωση
  const amountCents = monthlyCharge(stores, devices).totalCents;
  const { count } = await db.subscriptionCharge.createMany({ data: [{ subscriptionId: sub.id, periodStart, periodEnd, stores, devices, amountCents }], skipDuplicates: true });
  if (count) {
    const { org, to } = await billingRecipients(orgId);
    const mail = templates.chargeIssued(await platformSettings(), { orgName: org!.name, periodStart, periodEnd, stores, devices, amountCents, payUrl: `${await appUrl(org)}/billing` });
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
  await requirePlatform("users.manage");
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
  done(orgId, "users");
}

/** Αφαίρεση πρόσβασης: σβήνει τη συμμετοχή και τις ανοιχτές συνεδρίες του χρήστη. */
export async function removeMember(orgId: string, membershipId: string) {
  await requirePlatform("users.manage");
  const m = await db.membership.findFirst({ where: { id: id.parse(membershipId), orgId: id.parse(orgId) } });
  if (m) await db.$transaction([db.membership.delete({ where: { id: m.id } }), db.session.deleteMany({ where: { userId: m.userId } })]);
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

/** Στέλνει το δοκιμαστικό email στον ίδιο τον διαχειριστή που πάτησε το κουμπί. */
export async function sendTestMail() {
  const admin = await requirePlatform("settings.manage");
  const status = await sendMail({ to: admin.email, template: "test", mail: templates.test(await platformSettings(), { to: admin.email }) });
  redirect(`/platform/settings?test=${status}`);
}

// ---- Προσωπικό πλατφόρμας (Super Admin, Manager, Υπάλληλος εφαρμογής, Υπάλληλος υποστήριξης) ----
const platformRole = z.enum(Object.keys(PLATFORM_ROLES) as [keyof typeof PLATFORM_ROLES, ...(keyof typeof PLATFORM_ROLES)[]]);
const staffFail = (message: string): never => redirect(`/platform/settings?error=${encodeURIComponent(message)}#staff`);
const staffDone = (): never => {
  revalidatePath("/platform/settings");
  redirect("/platform/settings?saved=staff#staff");
};
// Σε κάθε αλλαγή ελέγχεται ότι μένει τουλάχιστον ένας Super Admin, αλλιώς κανείς δεν θα μπορούσε να ξαναδώσει ρόλους.
export async function addStaff(form: FormData) {
  await requirePlatform("staff.manage");
  const d = read(z.object({ name, email, platformRole }), form, "/platform/settings");
  if (await db.user.findUnique({ where: { email: d.email } })) staffFail("Υπάρχει ήδη χρήστης με αυτό το email");
  const user = await db.user.create({ data: d });
  const brand = await platformSettings();
  const url = await createResetLink(user.id, 72);
  await sendMail({ to: user.email, template: "invitation", mail: templates.invitation(brand, { name: user.name, orgName: brand.brandName, role: PLATFORM_ROLES[d.platformRole].label, url }) });
  staffDone();
}

export async function setStaffRole(form: FormData) {
  await requirePlatform("staff.manage");
  const d = read(z.object({ userId: id, platformRole }), form, "/platform/settings");
  try {
    await db.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { id: d.userId, platformRole: { not: null } }, data: { platformRole: d.platformRole } });
      if ((await tx.user.count({ where: { platformRole: "SUPER_ADMIN" } })) === 0) throw new Error("LOCKOUT");
    });
  } catch (e) {
    if (e instanceof Error && e.message === "LOCKOUT") staffFail("Πρέπει να μείνει τουλάχιστον ένας Super Admin");
    throw e;
  }
  staffDone();
}

/** Αφαιρεί την πρόσβαση στην κονσόλα και αποσυνδέει τον χρήστη. */
export async function removeStaff(userId: string) {
  await requirePlatform("staff.manage");
  try {
    await db.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { id: id.parse(userId), platformRole: { not: null } }, data: { platformRole: null } });
      await tx.session.deleteMany({ where: { userId } });
      if ((await tx.user.count({ where: { platformRole: "SUPER_ADMIN" } })) === 0) throw new Error("LOCKOUT");
    });
  } catch (e) {
    if (e instanceof Error && e.message === "LOCKOUT") staffFail("Πρέπει να μείνει τουλάχιστον ένας Super Admin");
    throw e;
  }
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
