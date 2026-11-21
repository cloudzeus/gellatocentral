// Δοκιμαστικά δεδομένα για τοπική ανάπτυξη: npx prisma db seed
import { seedGeo } from "./geo/seed-geo";
import { seedKb } from "./kb-starter";
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { hashPassword } from "../lib/password";
import { SYSTEM_ROLES } from "../lib/permissions";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const MENU: Record<string, [string, number, number?][]> = {
  Παγωτό: [["Χωνάκι 1 μπάλα", 280], ["Χωνάκι 2 μπάλες", 450], ["Κύπελλο 3 μπάλες", 600], ["Οικογενειακό 1 kg", 2200]],
  Γλυκά: [["Βάφλα με παγωτό", 750], ["Κρέπα σοκολάτα", 550], ["Προφιτερόλ", 500]],
  Καφές: [["Espresso", 200], ["Freddo espresso", 320], ["Affogato", 450]],
  Ποτά: [["Νερό 500 ml", 50], ["Αναψυκτικό", 250, 24]],
};

/** Υπερδιαχειριστής πλατφόρμας, από ADMIN_EMAIL / ADMIN_PASSWORD του .env (τρέχει και σε βάση με δεδομένα). */
async function admin() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || password.length < 8) return console.log("Χωρίς ADMIN_EMAIL / ADMIN_PASSWORD (8+ χαρακτήρες): δεν δημιουργήθηκε διαχειριστής.");
  // Το .env είναι η πηγή: ξανατρέχοντας το seed, ο κωδικός του διαχειριστή γίνεται αυτός του .env.
  const data = { platformRole: "SUPER_ADMIN" as const, passwordHash: hashPassword(password), failedLogins: 0, lockedUntil: null };
  await db.user.upsert({ where: { email }, update: data, create: { email, name: "Υπερδιαχειριστής", ...data } });
  console.log(`Διαχειριστής πλατφόρμας: ${email}`);
}

async function main() {
  await admin();
  const geo = await seedGeo(db);
  console.log(`Γεωγραφία: ${geo.countries} χώρες, ${geo.regions} περιφέρειες/νομοί/δήμοι, ${geo.cities.length} πόλεις (${geo.added} νέες)`);
  const articles = await seedKb(db);
  if (articles) console.log(`Βοήθεια: ${articles} αρχικά άρθρα`);
  if (await db.organization.count()) return console.log("Η βάση έχει ήδη δεδομένα — δεν άλλαξε τίποτα.");
  const org = await db.organization.create({ data: { name: "Gelateria Demo", vatNumber: "000000000" } });
  await db.orgRole.createMany({ data: SYSTEM_ROLES.map((r) => ({ orgId: org.id, system: true, ...r })) });
  const store = await db.store.create({ data: { orgId: org.id, name: "Κατάστημα Πειραιά", address: "Ακτή Μουτσοπούλου 1, Πειραιάς" } });
  await db.device.create({ data: { orgId: org.id, storeId: store.id, name: "Ταμείο 1", kind: "POS_WEB", series: "A1" } });
  // οι κοινοί συντελεστές ΦΠΑ σπέρνονται από το migration· αν λείπει κάποιος, τον προσθέτουμε
  const vatIds = new Map<number, string>();
  for (const r of new Set(Object.values(MENU).flat().map(([, , vatRate = 13]) => vatRate)))
    vatIds.set(r, (await db.vatRate.upsert({ where: { id: `vat_${r}` }, update: {}, create: { id: `vat_${r}`, name: `ΦΠΑ ${r}%`, rate: r } })).id);
  let position = 0;
  for (const [name, products] of Object.entries(MENU)) {
    await db.category.create({
      data: { orgId: org.id, name, position: position++, products: { create: products.map(([n, priceCents, vatRate = 13]) => ({ orgId: org.id, name: n, priceCents, vatRateId: vatIds.get(vatRate)! })) } },
    });
  }
  await db.subscription.create({ data: { orgId: org.id, currentPeriodEnd: new Date(Date.now() + 30 * 864e5) } });
  console.log("Έτοιμο: Gelateria Demo");
}

main().finally(() => db.$disconnect());
