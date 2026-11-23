// Καθαρός αξιολογητής τεκμηρίωσης: ρητά δεδομένα, επαναλήψιμο αποτέλεσμα, χωρίς «πράσινο» από πρόχειρα/Μ.Ο.
import { HACCP_FORMS, haccpForm } from "./forms.ts";

export type Severity = "HIGH" | "MEDIUM" | "LOW";
export type AssessmentFinding = { id: string; severity: Severity; title: string; detail: string; action: string; link: string; sourceIds: string[] };
export type HaccpRecordInput = { templateId: string; storeId: string | null; occurredAt: Date; status: string; result: string; correctiveAction: string | null; notes: string | null };
export type HaccpDeviceInput = { id: string; name: string; storeId: string; tempMin: number | null; tempMax: number | null; readings: { value: number; at: Date }[] };
export type HaccpAssessmentInput = { now: Date; storeId?: string; records: HaccpRecordInput[]; devices: HaccpDeviceInput[]; postedPurchaseCount: number };
export type HaccpAssessment = { score: number; totalRequirements: number; coveredRequirements: number; critical: number; warnings: number; findings: AssessmentFinding[]; evaluatedAt: Date };

const DAY = 86_400_000;
const finding = (id: string, severity: Severity, title: string, detail: string, action: string, sourceIds: string[]): AssessmentFinding => ({ id, severity, title, detail, action, link: id.startsWith("device-") ? "/devices" : id.startsWith("deviation-") ? "/haccp?view=records" : `/haccp/forms/${id.replace(/^missing-/, "")}`, sourceIds });

/** Βαθμός πληρότητας τεκμηρίωσης, όχι νομική βαθμολογία ή πιστοποίηση HACCP. */
export function evaluateHaccp(input: HaccpAssessmentInput): HaccpAssessment {
  const records = input.records.filter((record) => !input.storeId || record.storeId === input.storeId || record.storeId === null);
  const devices = input.devices.filter((device) => !input.storeId || device.storeId === input.storeId);
  const findings: AssessmentFinding[] = [];
  let earned = 0;
  let totalWeight = 0;

  for (const template of HACCP_FORMS.filter((item) => item.weight > 0)) {
    totalWeight += template.weight;
    const relevant = records.filter((record) => record.templateId === template.id && record.status === "COMPLETED" && record.result === "CONFORMING");
    const latest = relevant.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
    if (!latest) {
      const purchaseDetail = template.id === "receiving-log" && input.postedPurchaseCount > 0 ? ` Υπάρχουν ${input.postedPurchaseCount} οριστικοποιημένες αγορές· θερμοκρασία τεκμηριώνεται μόνο όπου απαιτείται, όχι στα ξηρά είδη.` : "";
      findings.push(finding(`missing-${template.id}`, template.weight >= 8 ? "HIGH" : "MEDIUM", `Λείπει: ${template.title}`, `Δεν υπάρχει ολοκληρωμένη, συμμορφούμενη καταχώριση. Πρόχειρα και «δεν εφαρμόζεται» δεν μετρούν ως πλήρη κάλυψη.${purchaseDetail}`, template.purpose, [...template.sourceIds]));
      continue;
    }
    const ageDays = Math.floor((input.now.getTime() - latest.occurredAt.getTime()) / DAY);
    if (ageDays > template.freshnessDays) {
      findings.push(finding(`stale-${template.id}`, "MEDIUM", `Χρειάζεται επανεξέταση: ${template.title}`, `Η τελευταία κατάλληλη καταχώριση είναι ${ageDays} ημερών παλιά· όριο ανανέωσης ${template.freshnessDays} ημέρες.`, "Επανεξέτασε το περιεχόμενο και καταχώρισε νέα τεκμηριωμένη αξιολόγηση.", [...template.sourceIds]));
      earned += template.weight * 0.35;
    } else {
      earned += template.weight;
    }
  }

  for (const device of devices) {
    const latest = device.readings[0];
    if (!latest) {
      findings.push(finding(`device-no-reading-${device.id}`, "HIGH", `Χωρίς θερμοκρασία: ${device.name}`, "Δεν βρέθηκε μέτρηση για ενεργή ψυκτική συσκευή.", "Έλεγξε τη σύνδεση και καταχώρισε πραγματική μέτρηση· αξιολόγησε τυχόν επηρεαζόμενο προϊόν.", ["eu-852"]));
      continue;
    }
    const stale = input.now.getTime() - latest.at.getTime() > DAY;
    if (stale) findings.push(finding(`device-stale-${device.id}`, "MEDIUM", `Παλιά μέτρηση: ${device.name}`, `Η τελευταία μέτρηση ήταν ${latest.at.toISOString()}.`, "Αποκατάστησε την παρακολούθηση και επιβεβαίωσε τις συνθήκες αποθήκευσης.", ["eu-852"]));
    if ((device.tempMin !== null && latest.value < device.tempMin) || (device.tempMax !== null && latest.value > device.tempMax)) {
      findings.push(finding(`device-limit-${device.id}`, "HIGH", `Εκτός ορίων: ${device.name}`, `${latest.value} °C εκτός ${device.tempMin ?? "—"}…${device.tempMax ?? "—"} °C.`, "Απομόνωσε και αξιολόγησε προϊόν, αποκατάστησε τη θερμοκρασία και καταχώρισε διορθωτική ενέργεια.", ["eu-852"]));
    }
    if (device.tempMin === null && device.tempMax === null) findings.push(finding(`device-no-limits-${device.id}`, "MEDIUM", `Χωρίς όρια: ${device.name}`, "Δεν έχουν οριστεί επιχειρησιακά όρια θερμοκρασίας.", "Τεκμηρίωσε και όρισε όρια κατάλληλα για τα αποθηκευόμενα προϊόντα.", ["eu-852"]));
  }

  const deviations = records.filter((record) => record.status === "COMPLETED" && record.result === "DEVIATION" && !record.correctiveAction?.trim());
  for (const [index, record] of deviations.slice(0, 30).entries()) {
    const template = haccpForm(record.templateId);
    findings.push(finding(`deviation-${index}-${record.templateId}`, "HIGH", `Απόκλιση χωρίς ενέργεια: ${template?.title ?? record.templateId}`, `Καταχώριση ${record.occurredAt.toISOString()} χωρίς διορθωτική ενέργεια.`, "Συμπλήρωσε άμεση ενέργεια, διαχείριση προϊόντος και αιτία/πρόληψη.", ["eu-852"]));
  }
  const severityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.title.localeCompare(b.title, "el"));
  return {
    score: totalWeight ? Math.round((earned / totalWeight) * 100) : 0,
    totalRequirements: totalWeight,
    coveredRequirements: HACCP_FORMS.filter((item) => item.weight > 0 && !findings.some((f) => f.id === `missing-${item.id}` || f.id === `stale-${item.id}`)).length,
    critical: findings.filter((item) => item.severity === "HIGH").length,
    warnings: findings.filter((item) => item.severity !== "HIGH").length,
    findings,
    evaluatedAt: input.now,
  };
}
