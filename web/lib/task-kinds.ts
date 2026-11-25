// Ποια είδη εργασίας έχουν «Ξανά» που ξανατρέχει ΜΟΝΟ ό,τι απέτυχε. Μπαίνει εδώ μόνο ό,τι είναι ασφαλές να επαναληφθεί:
// όπου μια επανάληψη μπορεί να διπλοστείλει (ΑΑΔΕ, πληρωμές) το είδος μένει εκτός, εκτός αν ο κώδικας το αποκλείει ήδη.
// Η εκτέλεση της επανάληψης είναι στο app/(app)/tasks/actions.ts.
export const RETRYABLE_KINDS: readonly string[] = ["catalog.enrich"];
export const retryable = (kind: string) => RETRYABLE_KINDS.includes(kind);
