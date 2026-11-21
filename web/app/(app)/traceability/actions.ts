"use server";
// Διόρθωση υπολοίπου παρτίδας (ανοικτές συσκευασίες, απογραφή): ρητό γεγονός με υποχρεωτική
// αιτιολογία και το όνομα του χρήστη στην κίνηση — το ίχνος μένει για έλεγχο (ΕΦΕΤ/εσωτερικό).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { correctionBaseQty } from "@/lib/stock-correction";

export async function correctLotStock(form: FormData) {
  const lotId = String(form.get("lotId") ?? "");
  const path = `/traceability/lot/${lotId}`;
  const fail = (msg: string): never => {
    revalidatePath(path);
    redirect(`${path}?error=${encodeURIComponent(msg)}`);
  };
  const d = z
    .object({
      lotId: z.string().min(1).max(80),
      direction: z.enum(["in", "out"]),
      note: z.string().trim().min(3, "Γράψε αιτιολογία (π.χ. «σπάσιμο συσκευασίας», «μέτρηση απογραφής»)").max(200),
    })
    .safeParse({ lotId, direction: form.get("direction"), note: form.get("note") });
  if (!d.success) return fail(d.error.issues[0].message);
  const amount = Number(String(form.get("amount") ?? "").replace(",", "."));

  const { org, user } = await currentOrg("warehouses.edit");
  const lot = await db.stockLot.findFirst({
    where: { id: d.data.lotId, orgId: org.id },
    include: { genericItem: { include: { baseUnit: true } } },
  });
  if (!lot) return fail("Άγνωστη παρτίδα");

  const sum = await db.stockMovement.aggregate({ where: { orgId: org.id, lotId: lot.id }, _sum: { quantity: true } });
  let quantity: number;
  try {
    quantity = correctionBaseQty({ direction: d.data.direction, amount, dimension: lot.genericItem.baseUnit.dimension, remaining: sum._sum.quantity ?? 0 });
  } catch (e) {
    return fail((e as Error).message);
  }

  await db.stockMovement.create({
    data: {
      orgId: org.id,
      warehouseId: lot.warehouseId,
      lotId: lot.id,
      genericItemId: lot.genericItemId,
      quantity,
      source: "manual",
      note: d.data.note,
      createdByName: user.name,
    },
  });
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}
