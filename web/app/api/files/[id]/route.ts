// Λήψη (ιδιωτικά αρχεία περνούν από εδώ, με έλεγχο πρόσβασης) και διαγραφή ενός αρχείου.
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccess, deleteFile } from "@/lib/storage";
import { cdnUrl, download } from "@/lib/storage/bunny";
import { isCategory } from "@/lib/storage/rules";

async function find(id: string, write = true) {
  const user = await getUser();
  if (!user) return { error: new Response("Χρειάζεται σύνδεση", { status: 401 }) };
  const file = await db.storedFile.findUnique({ where: { id } });
  // ίδιο μήνυμα είτε δεν υπάρχει είτε δεν επιτρέπεται: δεν αποκαλύπτουμε ποια αρχεία υπάρχουν
  if (!file || !isCategory(file.category) || !canAccess(user, file.orgId, file.category, write)) return { error: new Response("Δεν βρέθηκε", { status: 404 }) };
  if (write && file.category === "purchase_document" && file.refType === "purchase") {
    const doc = await db.purchaseDoc.findFirst({ where: { id: file.refId ?? "", orgId: file.orgId ?? "", status: "DRAFT" }, select: { id: true } });
    if (!doc) return { error: new Response("Το καταχωρημένο παραστατικό δεν αλλάζει", { status: 409 }) };
  }
  return { file };
}

export async function GET(_request: Request, { params }: RouteContext<"/api/files/[id]">) {
  const { file, error } = await find((await params).id, false);
  if (error) return error;
  const cdn = file.public ? await cdnUrl(file.path) : null;
  if (cdn) return Response.redirect(cdn, 302);
  const upstream = await download(file.path).catch(() => null);
  if (!upstream) return new Response("Το αρχείο δεν είναι διαθέσιμο αυτή τη στιγμή", { status: 502 });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      "Content-Disposition": `${file.contentType.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/files/[id]">) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return new Response("Μη αποδεκτή προέλευση", { status: 403 });
  const { file, error } = await find((await params).id);
  if (error) return error;
  try {
    await deleteFile(file);
    return new Response(null, { status: 204 });
  } catch (e) {
    console.error("file delete", e);
    return new Response("Η διαγραφή απέτυχε. Δοκίμασε ξανά", { status: 502 });
  }
}
