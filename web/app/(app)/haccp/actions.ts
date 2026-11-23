"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { haccpForm } from "@/lib/haccp/forms";

const empty = (value: FormDataEntryValue | null) => value === "" || value === null ? undefined : value;
const schema = z.object({
  templateId: z.string().min(1).max(80),
  storeId: z.preprocess(empty, z.string().max(80).nullable().default(null)),
  occurredAt: z.coerce.date(),
  status: z.enum(["DRAFT", "COMPLETED"]),
  result: z.enum(["CONFORMING", "DEVIATION", "NA"]),
  measuredValue: z.preprocess(empty, z.coerce.number().finite().min(-1_000_000).max(1_000_000).nullable().default(null)),
  unit: z.preprocess(empty, z.string().trim().max(20).nullable().default(null)),
  responsibleName: z.string().trim().min(2).max(120),
  notes: z.preprocess(empty, z.string().trim().max(4000).nullable().default(null)),
  correctiveAction: z.preprocess(empty, z.string().trim().max(4000).nullable().default(null)),
});
const text = (form: FormData) => Object.fromEntries([...form.entries()].filter(([key]) => !key.startsWith("$ACTION_")));
const fail = (path: string, message: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);

async function validated(form: FormData, needs: "haccp.add" | "haccp.edit") {
  const ctx = await currentOrg(needs);
  const parsed = schema.safeParse(text(form));
  if (!parsed.success) return { ctx, error: parsed.error.issues[0]?.message ?? "Έλεγξε τα πεδία" };
  const data = parsed.data;
  if (!haccpForm(data.templateId)) return { ctx, error: "Άγνωστο έντυπο" };
  if (ctx.storeIds.length && !data.storeId) return { ctx, error: "Επίλεξε κατάστημα· δεν επιτρέπεται καταχώριση σε όλη την επιχείρηση" };
  if (data.storeId) {
    const store = await db.store.findFirst({ where: { id: data.storeId, orgId: ctx.org.id, ...(ctx.storeIds.length ? { id: { in: ctx.storeIds } } : {}) }, select: { id: true } });
    if (!store) return { ctx, error: "Το κατάστημα δεν ανήκει στον δικό σου περιορισμό" };
  }
  return { ctx, data };
}

export async function createHaccpRecord(form: FormData) {
  const result = await validated(form, "haccp.add");
  if (!result.data) return fail("/haccp/records/new", result.error ?? "Άκυρα δεδομένα");
  const { ctx, data } = result;
  const record = await db.$transaction(async (tx) => {
    const created = await tx.haccpRecord.create({ data: { ...data, orgId: ctx.org.id, createdById: ctx.user.id, createdByName: ctx.user.name } });
    await writeAudit(tx, { orgId: ctx.org.id, actor: ctx.user, action: "haccp.record_created", entityType: "haccp_record", entityId: created.id, storeId: data.storeId, metadata: { templateId: data.templateId, status: data.status, result: data.result } });
    return created;
  });
  revalidatePath("/haccp");
  redirect(`/haccp/records/${record.id}?saved=1`);
}

export async function updateHaccpRecord(id: string, form: FormData) {
  const result = await validated(form, "haccp.edit");
  const path = `/haccp/records/${id}`;
  if (!result.data) return fail(path, result.error ?? "Άκυρα δεδομένα");
  const { ctx, data } = result;
  const updated = await db.$transaction(async (tx) => {
    const existing = await tx.haccpRecord.findFirst({ where: { id, orgId: ctx.org.id, ...(ctx.storeIds.length ? { storeId: { in: ctx.storeIds } } : {}) }, select: { id: true } });
    if (!existing) return false;
    await tx.haccpRecord.update({ where: { id }, data });
    await writeAudit(tx, { orgId: ctx.org.id, actor: ctx.user, action: "haccp.record_updated", entityType: "haccp_record", entityId: id, storeId: data.storeId, metadata: { templateId: data.templateId, status: data.status, result: data.result } });
    return true;
  });
  if (!updated) return fail("/haccp?view=records", "Η καταχώριση δεν βρέθηκε στον δικό σου περιορισμό");
  revalidatePath("/haccp");
  redirect(`${path}?saved=1`);
}
