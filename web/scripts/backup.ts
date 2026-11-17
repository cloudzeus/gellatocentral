// Αντίγραφο ασφαλείας της βάσης στο Bunny: pg_dump → platform/backup/ → καταγραφή (φαίνεται στη «Συνέχεια λειτουργίας»).
// Χρήση: npm run backup   (από cron του server, π.χ. κάθε νύχτα). Θέλει το pg_dump στο PATH και BUNNY_STORAGE_KEY.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { saveFile } from "../lib/storage";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Λείπει το DATABASE_URL");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  // shortcut: το αντίγραφο περνά ολόκληρο από τη μνήμη (όριο 1 GB εδώ). Για μεγαλύτερη βάση: ροή προς το Bunny ή WAL archiving.
  const dump = execFileSync("pg_dump", ["--format=custom", "--no-owner", url.split("?")[0]], { maxBuffer: 1024 ** 3 });
  const file = await saveFile({ orgId: null, category: "backup", name: `gelato-${stamp}.dump`, data: new Uint8Array(dump) });
  console.log(`Αντίγραφο ${file.path} (${(file.size / 1048576).toFixed(1)} MB)`);
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
