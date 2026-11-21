// Μαζική εισαγωγή τροφίμων Ελλάδας από το Open Food Facts στον κεντρικό κατάλογο (TradeItem, orgId=null).
// Χρήση: npx tsx scripts/import-off.ts [--file δικό-μας.csv.gz] [--images] [--limit N]
// Προεπιλογή: ροή από το ημερήσιο TSV export (~0,9 GB gz) — φιλτράρονται μόνο τα «en:greece».
// Με --images η φωτογραφία κατεβαίνει από το OFF και ανεβαίνει στο Bunny (catalog/off/<ean>.jpg).
// Δεδομένα: ODbL — η εφαρμογή αναγράφει «Περιέχει δεδομένα από Open Food Facts» στον κατάλογο.
import "dotenv/config";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { mapOffRow, type OffMapped } from "../lib/off-import";
import { cdnUrl, put, storageConfigured } from "../lib/storage/bunny";

const OFF_URL = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz";
const FIELDS = ["code", "product_name", "generic_name", "brands", "packaging", "quantity", "countries_tags", "image_front_url", "image_url"] as const;

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const WITH_IMAGES = args.includes("--images");
const LIMIT = Number(opt("limit") ?? 0) || Infinity;
const FILE = opt("file");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

/** Ροή γραμμών TSV από αρχείο ή από το ημερήσιο export (gunzip on the fly). */
async function* lines() {
  let stream: Readable;
  if (FILE) {
    stream = createReadStream(FILE);
    if (FILE.endsWith(".gz")) stream = stream.pipe(createGunzip());
  } else {
    console.log(`Λήψη ${OFF_URL} …`);
    const res = await fetch(OFF_URL);
    if (!res.ok || !res.body) throw new Error(`OFF export: HTTP ${res.status}`);
    stream = Readable.fromWeb(res.body as import("stream/web").ReadableStream).pipe(createGunzip());
  }
  yield* createInterface({ input: stream, crlfDelay: Infinity });
}

/** Φωτογραφία OFF → Bunny. Επιστρέφει τη διεύθυνση CDN ή null. */
async function mirrorImage(ean: string, url: string): Promise<string | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 1000 || bytes.length > 5_000_000) return null; // κενές/τεράστιες εικόνες εκτός
  const ext = url.endsWith(".png") ? "png" : "jpg";
  const path = `catalog/off/${ean}.${ext}`;
  await put(path, bytes, ext === "png" ? "image/png" : "image/jpeg");
  return (await cdnUrl(path)) ?? path;
}

async function main() {
  const units = new Map((await db.unit.findMany({ where: { code: { in: ["g", "ml", "pcs"] } }, select: { id: true, code: true } })).map((u) => [u.code, u.id]));
  if (!units.has("g") || !units.has("ml") || !units.has("pcs")) throw new Error("Λείπουν οι μονάδες g/ml/pcs από τη βάση");
  const imagesReady = WITH_IMAGES && (await storageConfigured());
  if (WITH_IMAGES && !imagesReady) console.warn("Το Bunny δεν έχει ρυθμιστεί — οι φωτογραφίες παραλείπονται");

  const brandIds = new Map<string, string>(); // όνομα (πεζά) → brandId
  const brandId = async (name: string) => {
    const key = name.toLowerCase();
    const cached = brandIds.get(key);
    if (cached) return cached;
    // Το OFF δεν ξεχωρίζει κατασκευαστή από brand — ο κατασκευαστής παίρνει το όνομα του brand
    const manufacturer = await db.manufacturer.upsert({ where: { name }, update: {}, create: { name } });
    const brand = await db.brand.upsert({ where: { manufacturerId_name: { manufacturerId: manufacturer.id, name } }, update: {}, create: { manufacturerId: manufacturer.id, name } });
    brandIds.set(key, brand.id);
    return brand.id;
  };

  let header: string[] | null = null;
  let scanned = 0, matched = 0, created = 0, updated = 0, imagesOk = 0, imagesFailed = 0;
  let buffer: OffMapped[] = [];

  const flush = async () => {
    if (!buffer.length) return;
    // dedupe μέσα στη δέσμη: ο πρώτος EAN κερδίζει
    const seen = new Map<string, OffMapped>();
    for (const m of buffer) if (!seen.has(m.ean)) seen.set(m.ean, m);
    const batch = [...seen.values()];
    buffer = [];
    const existing = new Map((await db.tradeItem.findMany({ where: { orgId: null, ean: { in: batch.map((m) => m.ean) } }, select: { id: true, ean: true, imageUrl: true } })).map((t) => [t.ean, t]));

    const toCreate = batch.filter((m) => !existing.has(m.ean));
    for (let i = 0; i < toCreate.length; i += 500) {
      const slice = toCreate.slice(i, i + 500);
      // το brandId θέλει upsert, οπότε δημιουργία ανά γραμμή αλλά σε πακέτα των 500
      for (const m of slice) {
        await db.tradeItem.create({
          data: {
            orgId: null,
            ean: m.ean,
            name: m.name,
            packaging: m.packaging,
            contentQty: m.contentQty,
            contentUnitId: units.get(m.unitCode)!,
            brandId: m.brand ? await brandId(m.brand) : null,
          },
        });
      }
      created += slice.length;
    }
    for (const m of batch.filter((x) => existing.has(x.ean))) {
      const cur = existing.get(m.ean)!;
      let imageUrl = cur.imageUrl;
      if (imagesReady && m.imageUrl && !cur.imageUrl) {
        try {
          imageUrl = await mirrorImage(m.ean, m.imageUrl);
          if (imageUrl) imagesOk++; else imagesFailed++;
        } catch { imagesFailed++; }
      }
      await db.tradeItem.update({
        where: { id: cur.id },
        // το brand δεν μηδενίζεται ποτέ από εισαγωγή — μόνο συμπληρώνεται
        data: { name: m.name, packaging: m.packaging, contentQty: m.contentQty, contentUnitId: units.get(m.unitCode)!, ...(m.brand ? { brandId: await brandId(m.brand) } : {}), imageUrl },
      });
      updated++;
    }
    // φωτογραφίες για νέες εγγραφές
    if (imagesReady) {
      for (const m of toCreate) {
        if (!m.imageUrl) continue;
        try {
          const url = await mirrorImage(m.ean, m.imageUrl);
          if (url) {
            await db.tradeItem.updateMany({ where: { orgId: null, ean: m.ean }, data: { imageUrl: url } });
            imagesOk++;
          } else imagesFailed++;
        } catch { imagesFailed++; }
      }
    }
  };

  for await (const line of lines()) {
    if (!header) { header = line.split("\t"); continue; }
    scanned++;
    if (scanned % 100_000 === 0) console.log(`… ${scanned.toLocaleString("el-GR")} γραμμές, ${matched.toLocaleString("el-GR")} από Ελλάδα`);
    const cells = line.split("\t");
    if (cells.length < header.length / 2) continue; // σπασμένη γραμμή (tab μέσα σε τιμή)
    const row: Record<string, string> = {};
    for (const f of FIELDS) row[f] = cells[header.indexOf(f)] ?? "";
    const mapped = mapOffRow(row);
    if (!mapped) continue;
    matched++;
    buffer.push(mapped);
    if (buffer.length >= 500) await flush();
    if (matched >= LIMIT) break;
  }
  await flush();
  console.log(`Έτοιμο: ${scanned.toLocaleString("el-GR")} γραμμές · ${matched.toLocaleString("el-GR")} Ελλάδας · ${created} νέα · ${updated} ενημερώθηκαν${WITH_IMAGES ? ` · φωτογραφίες: ${imagesOk} ok, ${imagesFailed} απέτυχαν` : ""}`);
  console.log("Υπενθύμιση ODbL: ο κατάλογος αναγράφει «Περιέχει δεδομένα από Open Food Facts».");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
