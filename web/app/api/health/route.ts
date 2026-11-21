// Απλό healthcheck για το Coolify: επιστρέφει 200 όταν ο server είναι ζωντανός.
// Δεν ακουμπά τη βάση — η βάση ελέγχεται έμμεσα από το migrate deploy στο entrypoint.
export function GET() {
  return Response.json({ status: "ok" });
}
