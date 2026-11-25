import { type NextRequest, NextResponse } from "next/server";

// Πρόχειρος έλεγχος: χωρίς cookie συνεδρίας πηγαίνεις στη σύνδεση. Ο πραγματικός έλεγχος (ισχύς συνεδρίας,
// ρόλος, επιχείρηση) γίνεται σε κάθε σελίδα και ενέργεια από το lib/auth.ts.
export function proxy(req: NextRequest) {
  if (!req.cookies.has("gs_session")) return NextResponse.redirect(new URL("/login", req.url));
}

// Το /api/pos το χρησιμοποιούν οι συσκευές με δικό τους κλειδί, όχι με cookie.
// Τα b2b, rfq, vitrine, schedule είναι δημόσιοι σύνδεσμοι με token: τον έλεγχο τον κάνει η ίδια η σελίδα.
export const config = { matcher: ["/((?!login|forgot|reset|offline|b2b/|rfq/|vitrine/|schedule/|api/pos|api/devices|api/cron|api/health|_next|icons/|sw.js|manifest.webmanifest|icon.png|logo.png).*)"] };
