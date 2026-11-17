import { type NextRequest, NextResponse } from "next/server";

// Πρόχειρος έλεγχος: χωρίς cookie συνεδρίας πηγαίνεις στη σύνδεση. Ο πραγματικός έλεγχος (ισχύς συνεδρίας,
// ρόλος, επιχείρηση) γίνεται σε κάθε σελίδα και ενέργεια από το lib/auth.ts.
export function proxy(req: NextRequest) {
  if (!req.cookies.has("gs_session")) return NextResponse.redirect(new URL("/login", req.url));
}

// Το /api/pos το χρησιμοποιούν οι συσκευές με δικό τους κλειδί, όχι με cookie.
export const config = { matcher: ["/((?!login|forgot|reset|offline|api/pos|api/devices|api/cron|api/health|_next|icons/|sw.js|manifest.webmanifest|icon.png|logo.png).*)"] };
