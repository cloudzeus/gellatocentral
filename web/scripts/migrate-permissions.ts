// Μετάβαση δικαιωμάτων στα νέα κλειδιά «περιοχή.ενέργεια»: ξαναγράφει ρόλους επιχειρήσεων, ρόλους/ομάδες
// προσωπικού και τις αλλαγές ρόλων πλατφόρμας (Setting PLATFORM_ROLE_PERMISSIONS). Η εφαρμογή δουλειά και χωρίς
// το script (τα παλιά κλειδιά ανοίγουν στην ανάγνωση — βλ. expandOrg/expandPlatform)· το τρέχουμε ΜΙΑ φορά ώστε
// η βάση να δείχνει πλέον τα νέα κλειδιά και τα παλιά να μη γυρίσουν ποτέ από νέα εγγραφή.
// Χρήση: npx tsx scripts/migrate-permissions.ts
import "dotenv/config";
import { db } from "../lib/db";
import { expandOrg, expandPlatform, parsePlatformOverrides } from "../lib/permissions";

async function main() {
  let roles = 0;
  for (const r of await db.orgRole.findMany()) {
    const next = expandOrg(r.permissions);
    if (next.join() !== r.permissions.join()) {
      await db.orgRole.update({ where: { id: r.id }, data: { permissions: next } });
      roles++;
    }
  }

  let staffRoles = 0;
  for (const r of await db.staffRole.findMany()) {
    const next = expandPlatform(r.permissions);
    if (next.join() !== r.permissions.join()) {
      await db.staffRole.update({ where: { id: r.id }, data: { permissions: next } });
      staffRoles++;
    }
  }

  let staffGroups = 0;
  for (const g of await db.staffGroup.findMany()) {
    const next = expandPlatform(g.permissions);
    if (next.join() !== g.permissions.join()) {
      await db.staffGroup.update({ where: { id: g.id }, data: { permissions: next } });
      staffGroups++;
    }
  }

  let accesses = 0;
  for (const a of await db.staffStoreAccess.findMany()) {
    const next = expandOrg(a.permissions);
    if (next.join() !== a.permissions.join()) {
      await db.staffStoreAccess.update({ where: { id: a.id }, data: { permissions: next } });
      accesses++;
    }
  }

  // οι αλλαγές των σταθερών ρόλων προσωπικού κρατιούνται ως JSON σε Setting
  const setting = await db.setting.findUnique({ where: { key: "PLATFORM_ROLE_PERMISSIONS" } });
  let settings = 0;
  if (setting) {
    const next = parsePlatformOverrides(setting.value);
    const value = JSON.stringify(next);
    if (value !== setting.value) {
      await db.setting.update({ where: { key: setting.key }, data: { value } });
      settings++;
    }
  }

  console.log(`Ρόλοι επιχειρήσεων: ${roles} · ρόλοι προσωπικού: ${staffRoles} · ομάδες προσωπικού: ${staffGroups} · παραχωρήσεις καταστημάτων: ${accesses} · ρυθμίσεις: ${settings}`);
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
