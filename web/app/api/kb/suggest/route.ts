// Προτάσεις άρθρων όσο ο πελάτης γράφει το θέμα ενός νέου αιτήματος. Μόνο δημόσια, δημοσιευμένα άρθρα.
import { getUser } from "@/lib/auth";
import { searchArticles } from "@/lib/support/kb-data";

export async function GET(request: Request) {
  const user = await getUser();
  if (!user?.memberships.length) return Response.json([], { status: 401 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 140);
  const found = await searchArticles(q, { internal: false, limit: 3 });
  return Response.json(found.map((a) => ({ id: a.id, title: a.title })), { headers: { "Cache-Control": "private, no-store" } });
}
