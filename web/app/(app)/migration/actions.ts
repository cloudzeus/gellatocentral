"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { rollbackLegacyMigration, runLegacyMigration, type LegacyMigrationOptions, type MigrationMode } from "@/lib/legacy-migration-db";
import { activateMigrationCutover, createMigrationCutover, freezeMigrationCutover, markMigrationCutoverReady, rollbackMigrationCutover } from "@/lib/migration-cutover-db";
import { requireStockContext } from "@/lib/stock-context";
import { workflowMessage } from "@/lib/workflow-db";

const back = (query: string): never => { revalidatePath("/migration"); redirect(`/migration${query}`); };
const value = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function migrateLegacy(form: FormData) {
  const ctx = await requireStockContext("migration.add");
  try {
    const raw: unknown = JSON.parse(value(form, "payload"));
    const mode: MigrationMode = form.get("mode") === "import" ? "import" : "dry-run";
    const cutoverId = value(form, "cutoverId").trim();
    const options: LegacyMigrationOptions | undefined = cutoverId ? {
      cutoverId,
      kind: form.get("kind") === "DELTA" ? "DELTA" : "BASELINE",
      exportId: value(form, "exportId"),
      previousCursor: value(form, "previousCursor") || null,
      sourceCursor: value(form, "sourceCursor"),
      exportedAt: value(form, "exportedAt"),
    } : undefined;
    const result = await runLegacyMigration(ctx, raw, mode, options);
    back(`?run=${encodeURIComponent(result.run.id)}&saved=${encodeURIComponent(result.replayed ? "Το ίδιο export επαναλήφθηκε χωρίς νέα εγγραφή" : mode === "dry-run" ? "Το dry-run ολοκληρώθηκε χωρίς επιχειρησιακές εγγραφές" : "Η εισαγωγή και το reconciliation ολοκληρώθηκαν")}`);
  } catch (error) { back(`?error=${encodeURIComponent(error instanceof SyntaxError ? "Το αρχείο δεν είναι έγκυρο JSON" : workflowMessage(error))}`); }
}

export async function startCutover(form: FormData) {
  const ctx = await requireStockContext("migration.add");
  try {
    const cutover = await createMigrationCutover(ctx, value(form, "source"));
    back(`?saved=${encodeURIComponent(`Δημιουργήθηκε cutover ${cutover.id} σε PREPARING`)}`);
  } catch (error) { back(`?error=${encodeURIComponent(workflowMessage(error))}`); }
}

export async function freezeCutover(form: FormData) {
  const ctx = await requireStockContext("migration.add");
  try {
    await freezeMigrationCutover(ctx, value(form, "cutoverId"));
    back("?saved=Το legacy freeze τεκμηριώθηκε και ο tenant μπλοκάρει νέες business writes");
  } catch (error) { back(`?error=${encodeURIComponent(workflowMessage(error))}`); }
}

export async function readyCutover(form: FormData) {
  const ctx = await requireStockContext("migration.add");
  try {
    await markMigrationCutoverReady(ctx, value(form, "cutoverId"));
    back("?saved=Το server-recomputed smoke συμφωνεί· το cutover είναι READY");
  } catch (error) { back(`?error=${encodeURIComponent(workflowMessage(error))}`); }
}

export async function activateCutover(form: FormData) {
  const ctx = await requireStockContext("migration.add");
  try {
    await activateMigrationCutover(ctx, value(form, "cutoverId"), value(form, "confirmation"));
    back("?saved=Το cutover ενεργοποιήθηκε με φρέσκο read-only evidence");
  } catch (error) { back(`?error=${encodeURIComponent(workflowMessage(error))}`); }
}

export async function rollbackCutover(form: FormData) {
  const ctx = await requireStockContext("migration.add");
  try {
    await rollbackMigrationCutover(ctx, value(form, "cutoverId"), value(form, "reason"));
    back("?saved=Το cutover σημειώθηκε ROLLED_BACK χωρίς διαγραφή ιστορικού· ο tenant παραμένει frozen");
  } catch (error) { back(`?error=${encodeURIComponent(workflowMessage(error))}`); }
}

export async function rollbackMigration(form: FormData) {
  const ctx = await requireStockContext("migration.add");
  try {
    const result = await rollbackLegacyMigration(ctx, value(form, "runId"), value(form, "reason"));
    back(`?saved=${encodeURIComponent(`Rollback ολοκληρώθηκε: ${result.deleted} εγγραφές διαγράφηκαν, ${result.protectedUpdated} ενημερωμένες προστατεύτηκαν`)}`);
  } catch (error) { back(`?error=${encodeURIComponent(workflowMessage(error))}`); }
}
