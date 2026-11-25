// Ποια είδη εργασίας έχουν «Ξανά» που ξανατρέχει ΜΟΝΟ ό,τι απέτυχε. Μπαίνει εδώ μόνο ό,τι είναι ασφαλές να επαναληφθεί:
// όπου μια επανάληψη μπορεί να διπλοστείλει (ΑΑΔΕ, πληρωμές) το είδος μένει εκτός, εκτός αν ο κώδικας το αποκλείει ήδη.
// Η εκτέλεση της επανάληψης είναι στο app/(app)/tasks/actions.ts.
//  - catalog.enrich: ξαναρωτά το AI μόνο για όσους κατασκευαστές απέτυχαν· δεν στέλνει τίποτα προς τα έξω.
//  - aade.invoice: η transmitSalesDocument αποκλείει τη διπλή αποστολή (ήδη διαβιβασμένο → επιστρέφει, conditional claim, idempotencyKey).
// ΕΚΤΟΣ: payroll.execute (νέα εκτέλεση θέλει ξανά ρητή επιβεβαίωση ποσού), migration.run και finance.statement (θέλουν ξανά το αρχείο),
// purchases.scan / purchases.mydata (θα έφτιαχναν δεύτερο πρόχειρο), haccp.* (ο έλεγχος ξανατρέχει ολόκληρος από το κουμπί του).
export const RETRYABLE_KINDS: readonly string[] = ["catalog.enrich", "aade.invoice"];
export const retryable = (kind: string) => RETRYABLE_KINDS.includes(kind);
