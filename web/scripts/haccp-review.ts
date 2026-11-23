// Εβδομαδιαίος μηχανικός έλεγχος· η νομική αναθεώρηση των αλλαγών γίνεται από άνθρωπο.
import "dotenv/config";
import { assessAllTenants } from "../lib/haccp/assessment-db.ts";
import { checkOfficialSources } from "../lib/haccp/source-check.ts";

async function main() {
  const checkedAt = new Date();
  const sources = await checkOfficialSources(checkedAt);
  const assessments = await assessAllTenants(checkedAt);
  console.log(JSON.stringify({ checkedAt: checkedAt.toISOString(), sources, assessments }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
