"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { rollbackLegacyMigration, runLegacyMigration, type MigrationMode } from "@/lib/legacy-migration-db";
import { requireStockContext } from "@/lib/stock-context";
import { workflowMessage } from "@/lib/workflow-db";

const back = (query: string): never => { revalidatePath("/migration"); redirect(`/migration${query}`); };

export async function migrateLegacy(form: FormData) {
  const ctx = await requireStockContext("migration.add");
  try {
    const raw: unknown = JSON.parse(String(form.get("payload") ?? ""));
    const mode: MigrationMode = form.get("mode") === "import" ? "import" : "dry-run";
    const result = await runLegacyMigration(ctx, raw, mode);
    back(`?run=${encodeURIComponent(result.run.id)}&saved=${encodeURIComponent(mode === "dry-run" ? "Το dry-run ολοκληρώθηκε χωρίς επιχειρησιακές εγγραφές" : "Η εισαγωγή και το reconciliation ολοκληρώθηκαν")}`);
  } catch (error) { back(`?error=${encodeURIComponent(error instanceof SyntaxError ? "Το αρχείο δεν είναι έγκυρο JSON" : workflowMessage(error))}`); }
}

export async function rollbackMigration(form: FormData) {
  const ctx = await requireStockContext("migration.add");
  try {
    const result = await rollbackLegacyMigration(ctx, String(form.get("runId") ?? ""), String(form.get("reason") ?? ""));
    back(`?saved=${encodeURIComponent(`Rollback ολοκληρώθηκε: ${result.deleted} εγγραφές διαγράφηκαν, ${result.protectedUpdated} ενημερωμένες προστατεύτηκαν`)}`);
  } catch (error) { back(`?error=${encodeURIComponent(workflowMessage(error))}`); }
}
