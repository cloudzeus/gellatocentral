/** Αναζήτηση και σελίδα από το URL (?q=…&page=…). Η σελίδα δεν ξεπερνά ποτέ τα όρια. */
export function listParams(sp: Record<string, string | string[] | undefined>, pageSize = 25) {
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 80);
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  return { q, page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
