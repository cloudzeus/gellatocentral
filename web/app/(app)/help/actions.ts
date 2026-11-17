"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { publicArticle } from "@/lib/support/kb-data";

/** «Σε βοήθησε;» Μία ψήφος ανά άρθρο και browser (cookie)· το «όχι» οδηγεί στο νέο αίτημα. */
export async function vote(id: string, yes: boolean) {
  await currentOrg();
  const article = await publicArticle(id);
  if (!article) redirect("/help");
  const jar = await cookies(), key = `kbv_${id}`;
  if (!jar.get(key)) {
    await db.kbArticle.update({ where: { id }, data: yes ? { helpfulYes: { increment: 1 } } : { helpfulNo: { increment: 1 } } });
    jar.set(key, yes ? "1" : "0", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 180 * 86400 });
  }
  redirect(yes ? `/help/${id}?voted=yes` : `/support?from=${id}`);
}
