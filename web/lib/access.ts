// Κατάσταση λογαριασμού, περιγραφή συσκευής και ετικέτες του ιστορικού πρόσβασης. Καθαρές συναρτήσεις, χωρίς βάση.
export const ACCESS_ACTIONS = {
  "user.invited": "Πρόσκληση χρήστη",
  "user.role": "Αλλαγή ρόλου ή καταστήματος",
  "user.disabled": "Απενεργοποίηση χρήστη",
  "user.enabled": "Ενεργοποίηση χρήστη",
  "user.removed": "Αφαίρεση πρόσβασης",
  "user.reset": "Email για ορισμό κωδικού",
  "user.password": "Αλλαγή κωδικού",
  "role.created": "Νέος ρόλος",
  "role.changed": "Αλλαγή δικαιωμάτων ρόλου",
  "role.deleted": "Διαγραφή ρόλου",
  "group.created": "Νέα ομάδα",
  "group.changed": "Αλλαγή δικαιωμάτων ομάδας",
  "group.deleted": "Διαγραφή ομάδας",
  "user.groups": "Αλλαγή ομάδων χρήστη",
  "staff.access": "Πρόσβαση προσωπικού σε πελάτη",
  "staff.access_removed": "Αφαίρεση πρόσβασης προσωπικού σε πελάτη",
  "store.paused": "Εποχιακή παύση καταστήματος",
  "store.resumed": "Άνοιγμα καταστήματος μετά από παύση",
  "plan.changed": "Αλλαγή πακέτου συνδρομής",
  "org.suspended": "Αναστολή επιχείρησης",
  "org.resumed": "Άρση αναστολής",
  "org.closing": "Έναρξη κλεισίματος επιχείρησης",
  "org.closing_cancelled": "Ακύρωση κλεισίματος",
  "org.deleted": "Οριστική διαγραφή επιχείρησης",
  "org.exported": "Εξαγωγή δεδομένων επιχείρησης",
  "parties.viewed": "Προβολή συναλλασσομένων συνδρομητή",
} as const;
export type AccessAction = keyof typeof ACCESS_ACTIONS;
export const actionLabel = (a: string) => (ACCESS_ACTIONS as Record<string, string>)[a] ?? a;

export type AccountStatus = "disabled" | "pending" | "active";
/** Απενεργοποιημένος υπερισχύει· χωρίς κωδικό σημαίνει ότι δεν έχει ανοίξει ακόμα την πρόσκληση. */
export const accountStatus = (u: { disabledAt: Date | null; passwordHash: string | null }): AccountStatus => (u.disabledAt ? "disabled" : u.passwordHash ? "active" : "pending");

/** «Chrome σε Windows» από το User-Agent, για να αναγνωρίζει ο χρήστης τις συνδέσεις του. */
export function deviceLabel(ua: string | null | undefined) {
  if (!ua) return "Άγνωστη συσκευή";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return browser && os ? `${browser} σε ${os}` : browser || os || "Άγνωστη συσκευή";
}

/** Τι άλλαξε σε έναν ρόλο, σε απλά λόγια, για το ιστορικό. */
export function permissionDiff(before: readonly string[], after: readonly string[], label: (key: string) => string) {
  const added = after.filter((p) => !before.includes(p)).map(label);
  const removed = before.filter((p) => !after.includes(p)).map(label);
  return [added.length ? `Προστέθηκαν: ${added.join(", ")}` : "", removed.length ? `Αφαιρέθηκαν: ${removed.join(", ")}` : ""].filter(Boolean).join(" · ") || "Χωρίς αλλαγή δικαιωμάτων";
}
