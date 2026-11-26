// Σενάριο του πρώτου πελάτη (beta tester): 4 σημεία, ψυγεία ως αποθήκες, εργαστήριο στον Πειραιά,
// αυτόματοι πωλητές, τραπέζια μόνο στη Δορυλαίου. Περιγραφή και κενά: docs/analysis/BETA-CUSTOMER.md
// Επαναλήψιμο (upsert με σταθερά ids)· δεν φτιάχνει χρήστες, κωδικούς ή κλήσεις σε Viva/ΑΑΔΕ.
// Χρήση: BETA_SEED_CONFIRM=yes npx tsx prisma/beta-seed.ts
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type DeviceKind } from "../lib/generated/prisma/client";
import { SYSTEM_ROLES } from "../lib/permissions";

const ORG = "beta_org";
const FREEZER = { tempMin: -22, tempMax: -18 };
const VITRINE = { tempMin: -14, tempMax: -11 };
const CHILLER = { tempMin: 2, tempMax: 5 };
const VENDING = { tempMin: -20, tempMax: -16 };

type Space = { code: string; name: string; kind?: DeviceKind; temps?: { tempMin: number; tempMax: number }; isDefault?: boolean };
type Site = {
  id: string; name: string; address: string; city: string; postalCode: string | null; region: string;
  // pos.warehouse: από πού πουλά το ταμείο, αν όχι η προεπιλογή του σημείου
  pos?: { series: string; name: string; warehouse?: string }; spaces: Space[];
};

// shortcut: οδός/αριθμός Κάστορος, διευθύνσεις Τήνου και αεροδρομίου είναι ενδεικτικές — τις διορθώνει ο πελάτης στις Ρυθμίσεις.
export const SITES: Site[] = [
  {
    id: "beta_store_dor", name: "Δορυλαίου", address: "Δορυλαίου 2, Αθήνα", city: "Αθήνα", postalCode: "11521", region: "Αττική",
    pos: { series: "DOR1", name: "Κεντρικό ταμείο Δορυλαίου" },
    spaces: [
      { code: "DOR-VIT", name: "Δορυλαίου · Βιτρίνα παγωτού", kind: "FRIDGE", temps: VITRINE, isDefault: true },
      { code: "DOR-FRZ1", name: "Δορυλαίου · Καταψύκτης αποθέματος 1", kind: "FRIDGE", temps: FREEZER },
      { code: "DOR-FRZ2", name: "Δορυλαίου · Καταψύκτης αποθέματος 2", kind: "FRIDGE", temps: FREEZER },
      { code: "DOR-CHL", name: "Δορυλαίου · Ψυγείο γλυκών & γάλακτος", kind: "FRIDGE", temps: CHILLER },
      { code: "DOR-BEV", name: "Δορυλαίου · Ψυγείο ποτών", kind: "FRIDGE", temps: CHILLER },
      { code: "DOR-DRY", name: "Δορυλαίου · Ξηρή αποθήκη (χωνάκια, κύπελλα)" },
    ],
  },
  {
    id: "beta_store_pir", name: "Πειραιάς · Εργαστήριο Κάστορος", address: "Κάστορος, Πειραιάς", city: "Πειραιάς", postalCode: null, region: "Αττική",
    pos: { series: "PIR1", name: "Κεντρικό ταμείο Πειραιά", warehouse: "PIR-VIT" },
    spaces: [
      { code: "PIR-LAB", name: "Πειραιάς · Εργαστήριο παραγωγής", isDefault: true },
      { code: "PIR-DRY", name: "Πειραιάς · Ξηρή αποθήκη πρώτων υλών" },
      { code: "PIR-CHL", name: "Πειραιάς · Θάλαμος συντήρησης πρώτων υλών", kind: "FRIDGE", temps: CHILLER },
      { code: "PIR-BLAST", name: "Πειραιάς · Blast freezer", kind: "FRIDGE", temps: { tempMin: -40, tempMax: -30 } },
      { code: "PIR-FRZ1", name: "Πειραιάς · Καταψύκτης έτοιμου προϊόντος 1", kind: "FRIDGE", temps: FREEZER },
      { code: "PIR-FRZ2", name: "Πειραιάς · Καταψύκτης έτοιμου προϊόντος 2", kind: "FRIDGE", temps: FREEZER },
      { code: "PIR-FRZ3", name: "Πειραιάς · Καταψύκτης χονδρικής (αποστολές)", kind: "FRIDGE", temps: FREEZER },
      { code: "PIR-VIT", name: "Πειραιάς · Βιτρίνα λιανικής", kind: "FRIDGE", temps: VITRINE },
      { code: "PIR-VM", name: "Πειραιάς · Αυτόματος πωλητής (λιανική + efood/Wolt)", kind: "VENDING_MACHINE", temps: VENDING },
    ],
  },
  {
    id: "beta_store_ath", name: "Αεροδρόμιο Ελ. Βενιζέλος", address: "Διεθνής Αερολιμένας Αθηνών Ελ. Βενιζέλος, Σπάτα", city: "Σπάτα", postalCode: "19019", region: "Αττική",
    spaces: [{ code: "ATH-VM", name: "Αεροδρόμιο · Αυτόματος πωλητής", kind: "VENDING_MACHINE", temps: VENDING, isDefault: true }],
  },
  {
    id: "beta_store_tin", name: "Τήνος", address: "Χώρα Τήνου", city: "Τήνος", postalCode: "84200", region: "Κυκλάδες",
    spaces: [
      { code: "TIN-VM", name: "Τήνος · Αυτόματος πωλητής", kind: "VENDING_MACHINE", temps: VENDING, isDefault: true },
      { code: "TIN-FRZ1", name: "Τήνος · Καταψύκτης αποθέματος 1", kind: "FRIDGE", temps: FREEZER },
      { code: "TIN-FRZ2", name: "Τήνος · Καταψύκτης αποθέματος 2", kind: "FRIDGE", temps: FREEZER },
    ],
  },
];

// Ενδεικτικός κατάλογος λιανικής (τιμές με ΦΠΑ)· ο πελάτης τον αντικαθιστά με τον δικό του.
const MENU: Record<string, [code: string, name: string, cents: number, vat?: number][]> = {
  Παγωτό: [["X1", "Χωνάκι 1 μπάλα", 300], ["X2", "Χωνάκι 2 μπάλες", 480], ["K3", "Κύπελλο 3 μπάλες", 650], ["P500", "Πακέτο 500 g", 1300], ["P1K", "Πακέτο 1 kg", 2400]],
  Γλυκά: [["BAF", "Βάφλα με παγωτό", 800], ["KRE", "Κρέπα σοκολάτα", 600]],
  Καφές: [["ESP", "Espresso", 220], ["FRE", "Freddo espresso", 350], ["AFF", "Affogato", 480]],
  Ποτά: [["NER", "Νερό 500 ml", 60], ["ANA", "Αναψυκτικό", 270, 24]],
};
const FLAVOURS = ["Βανίλια", "Σοκολάτα", "Φιστίκι Αιγίνης", "Φράουλα", "Λεμόνι", "Καϊμάκι", "Μαστίχα Χίου", "Stracciatella"];
const PICKS: Record<string, number> = { X1: 1, X2: 2, K3: 3 };

// Χονδρική από το εργαστήριο: ημιτελή/τελικά είδη σε kg, τιμή χονδρικής ανά kg χωρίς ΦΠΑ.
const WHOLESALE: [id: string, name: string, cents: number][] = [
  ["beta_item_vanilla", "Παγωτό βανίλια (λεκάνη 5 lt)", 1100],
  ["beta_item_choco", "Παγωτό σοκολάτα (λεκάνη 5 lt)", 1200],
  ["beta_item_pistachio", "Παγωτό φιστίκι (λεκάνη 5 lt)", 1800],
  ["beta_item_lemon", "Σορμπέ λεμόνι (λεκάνη 5 lt)", 1000],
];

function assertConfirmed() {
  if (process.env.BETA_SEED_CONFIRM !== "yes") throw new Error("Το σενάριο beta απαιτεί BETA_SEED_CONFIRM=yes");
  if (!process.env.DATABASE_URL) throw new Error("Λείπει DATABASE_URL");
}

export async function seedBeta(db: PrismaClient) {
  return db.$transaction(async (tx) => {
    // shortcut: επωνυμία και ΑΦΜ είναι placeholder μέχρι να τα δώσει ο πελάτης.
    const org = await tx.organization.upsert({
      where: { id: ORG },
      update: {},
      create: { id: ORG, name: "Beta · Πρώτος πελάτης", vatNumber: "BETA-000000001", city: "Πειραιάς" },
    });
    for (const [i, role] of SYSTEM_ROLES.entries())
      await tx.orgRole.upsert({ where: { orgId_name: { orgId: ORG, name: role.name } }, update: { permissions: role.permissions, locked: role.locked, system: true }, create: { id: `beta_role_${i}`, orgId: ORG, system: true, ...role } });
    await tx.subscription.upsert({ where: { orgId: ORG }, update: {}, create: { orgId: ORG, status: "TRIALING", currentPeriodEnd: new Date(Date.now() + 60 * 864e5) } });

    let devices = 0, spaces = 0;
    for (const site of SITES) {
      const { id, name, address, city, postalCode, region } = site;
      await tx.store.upsert({ where: { id }, update: { name, address, city, postalCode, region, active: true }, create: { id, orgId: ORG, name, address, city, postalCode, region } });
      let defaultWarehouseId: string | null = null;
      for (const [priority, space] of site.spaces.entries()) {
        const warehouseId = `beta_wh_${space.code}`;
        await tx.warehouse.upsert({ where: { id: warehouseId }, update: { name: space.name, code: space.code, active: true }, create: { id: warehouseId, orgId: ORG, code: space.code, name: space.name } });
        await tx.storeWarehouse.upsert({
          where: { storeId_warehouseId: { storeId: id, warehouseId } },
          update: { isDefault: !!space.isDefault, priority: priority * 10 },
          create: { storeId: id, warehouseId, isDefault: !!space.isDefault, priority: priority * 10 },
        });
        if (space.isDefault) defaultWarehouseId = warehouseId;
        spaces++;
        if (!space.kind) continue;
        // Ψυγείο / αυτόματος πωλητής = συσκευή ΚΑΙ αποθηκευτικός χώρος (Device.warehouseId)
        const deviceId = `beta_dev_${space.code}`;
        const data = { name: space.name, kind: space.kind, warehouseId, ...space.temps, active: true };
        await tx.device.upsert({ where: { id: deviceId }, update: data, create: { id: deviceId, orgId: ORG, storeId: id, ...data } });
        devices++;
      }
      if (site.pos) {
        const printerId = `beta_printer_${site.pos.series}`;
        await tx.printer.upsert({ where: { id: printerId }, update: {}, create: { id: printerId, orgId: ORG, storeId: id, name: `Εκτυπωτής ${site.name}`, connection: "NETWORK", paperWidth: 80 } });
        const deviceId = `beta_dev_${site.pos.series}`;
        const data = { name: site.pos.name, kind: "POS_ANDROID" as const, series: site.pos.series, printerId, defaultWarehouseId: site.pos.warehouse ? `beta_wh_${site.pos.warehouse}` : defaultWarehouseId, active: true };
        await tx.device.upsert({ where: { id: deviceId }, update: data, create: { id: deviceId, orgId: ORG, storeId: id, ...data } });
        devices++;
      }
    }

    // Η παραγωγή του Πειραιά τροφοδοτεί τα άλλα σημεία: ο καταψύκτης αποστολών εξυπηρετεί και αυτά (χαμηλή προτεραιότητα).
    for (const storeId of ["beta_store_dor", "beta_store_ath", "beta_store_tin"])
      await tx.storeWarehouse.upsert({ where: { storeId_warehouseId: { storeId, warehouseId: "beta_wh_PIR-FRZ3" } }, update: { isDefault: false, priority: 900 }, create: { storeId, warehouseId: "beta_wh_PIR-FRZ3", isDefault: false, priority: 900 } });

    // Τραπέζια μόνο στη Δορυλαίου
    const tables = [
      ...Array.from({ length: 8 }, (_, i) => ({ name: String(i + 1), zone: "Σάλα", seats: i < 6 ? 4 : 2 })),
      ...Array.from({ length: 6 }, (_, i) => ({ name: `Ε${i + 1}`, zone: "Πεζοδρόμιο", seats: 2 })),
    ];
    for (const [position, t] of tables.entries())
      await tx.diningTable.upsert({ where: { storeId_name: { storeId: "beta_store_dor", name: t.name } }, update: { zone: t.zone, seats: t.seats, position, active: true }, create: { orgId: ORG, storeId: "beta_store_dor", position, ...t } });

    // Σειρές παραστατικών εκτός ταμείου: χονδρική και διακίνηση από το εργαστήριο
    for (const s of [
      { docType: "1.1", code: "ΤΙΜ-Π", name: "Τιμολόγια χονδρικής Πειραιά" },
      { docType: "5.1", code: "ΠΙΣ-Π", name: "Πιστωτικά χονδρικής Πειραιά" },
      { docType: "9.3", code: "ΔΑ-Π", name: "Δελτία αποστολής (πελάτες και δικά μας σημεία)" },
    ])
      await tx.documentSeries.upsert({ where: { orgId_docType_code: { orgId: ORG, docType: s.docType, code: s.code } }, update: { name: s.name, storeId: "beta_store_pir", isDefault: true, active: true }, create: { orgId: ORG, storeId: "beta_store_pir", isDefault: true, ...s } });

    // Κατάλογος λιανικής + γεύσεις
    let position = 0;
    const productIds = new Map<string, string>();
    for (const [category, items] of Object.entries(MENU)) {
      const categoryId = `beta_cat_${position}`;
      await tx.category.upsert({ where: { id: categoryId }, update: { name: category, position }, create: { id: categoryId, orgId: ORG, name: category, position } });
      for (const [code, name, priceCents, vat = 13] of items) {
        const productId = `beta_prod_${code}`;
        await tx.product.upsert({ where: { id: productId }, update: { name, priceCents, code, active: true }, create: { id: productId, orgId: ORG, categoryId, vatRateId: `vat_${vat}`, name, priceCents, code } });
        productIds.set(code, productId);
      }
      position++;
    }
    await tx.modifierGroup.upsert({ where: { id: "beta_mod_flavours" }, update: { name: "Γεύσεις" }, create: { id: "beta_mod_flavours", orgId: ORG, name: "Γεύσεις", kind: "REQUIRED" } });
    for (const [i, name] of FLAVOURS.entries())
      await tx.modifierOption.upsert({ where: { id: `beta_flavour_${i}` }, update: { name, position: i }, create: { id: `beta_flavour_${i}`, groupId: "beta_mod_flavours", name, position: i } });
    for (const [code, pick] of Object.entries(PICKS))
      await tx.productModifierGroup.upsert({ where: { productId_groupId: { productId: productIds.get(code)!, groupId: "beta_mod_flavours" } }, update: { pick }, create: { productId: productIds.get(code)!, groupId: "beta_mod_flavours", pick } });

    // Χονδρική: είδη και τιμοκατάλογος
    for (const [id, name] of WHOLESALE)
      await tx.genericItem.upsert({ where: { id }, update: { name, active: true }, create: { id, orgId: ORG, name, baseUnitId: "unit_kg", vatRateId: "vat_13" } });
    const priceList = await tx.priceList.upsert({ where: { orgId_name: { orgId: ORG, name: "Χονδρική 2026" } }, update: {}, create: { orgId: ORG, name: "Χονδρική 2026", validFrom: new Date("2026-01-01T00:00:00.000Z") } });
    for (const [genericItemId, , unitPriceCents] of WHOLESALE)
      await tx.priceListItem.upsert({ where: { priceListId_genericItemId: { priceListId: priceList.id, genericItemId } }, update: { unitPriceCents }, create: { orgId: ORG, priceListId: priceList.id, genericItemId, unitPriceCents, vatRate: 13 } });

    // Πλατφόρμες delivery ως συνεργάτες (το κανάλι ανά κατάστημα δεν έχει ακόμη θέση στο σχήμα — βλ. BETA-CUSTOMER.md)
    for (const p of [
      { id: "beta_party_efood", name: "efood", notes: "Delivery: Δορυλαίου (από το κατάστημα), Πειραιάς (από τον αυτόματο πωλητή)" },
      { id: "beta_party_wolt", name: "Wolt", notes: "Delivery: Δορυλαίου (από το κατάστημα), Πειραιάς (από τον αυτόματο πωλητή)" },
    ])
      await tx.party.upsert({ where: { id: p.id }, update: { name: p.name, notes: p.notes, roles: ["partner"] }, create: { orgId: ORG, roles: ["partner"], ...p } });

    return { stores: SITES.length, spaces, devices, tables: tables.length, products: productIds.size, flavours: FLAVOURS.length, wholesale: WHOLESALE.length };
  }, { timeout: 60_000 });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assertConfirmed();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  seedBeta(db).then((r) => console.log("Σενάριο beta:", r)).finally(() => db.$disconnect());
}
