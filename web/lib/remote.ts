// Απομακρυσμένη υποστήριξη με RustDesk. Η εφαρμογή δεν μεταφέρει την οθόνη: κρατά τον αριθμό RustDesk κάθε συσκευής,
// ελέγχει ποιος επιτρέπεται να συνδεθεί, καταγράφει κάθε σύνδεση και ανοίγει το πρόγραμμα RustDesk του τεχνικού.

/** Αριθμός RustDesk: ψηφία (συνήθως 9–10) ή όνομα που όρισε ο διαχειριστής. Τα κενά που δείχνει το πρόγραμμα αφαιρούνται. */
export const cleanRemoteId = (raw: string) => {
  const id = raw.replace(/[\s]/g, "");
  return /^[A-Za-z0-9_-]{6,32}$/.test(id) ? id : null;
};
/** Όπως τον δείχνει το RustDesk: 123 456 789. */
export const showRemoteId = (id: string) => (/^\d+$/.test(id) ? id.replace(/(\d{3})(?=\d)/g, "$1 ") : id);

export const DEFAULT_LINK = "rustdesk://{id}";
/** Ο σύνδεσμος που ανοίγει το RustDesk στον υπολογιστή του τεχνικού. Η μορφή ορίζεται στις Ρυθμίσεις. */
export const remoteLink = (template: string, id: string) => (template.includes("{id}") && !/^\s*(javascript|data|vbscript):/i.test(template) ? template : DEFAULT_LINK).replace("{id}", encodeURIComponent(id));
