import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { encodeFlash, FLASH_COOKIE } from "@/lib/flash";
import type { ToastInput } from "@/lib/feedback-events";

/**
 * Μήνυμα για ενέργεια που ΔΕΝ κάνει redirect (όσες κάνουν, γράφουν ?saved= / ?error= όπως πάντα).
 * Το cookie ζει λίγα δευτερόλεπτα: το layout το διαβάζει στην επόμενη απόδοση, το δείχνει ως toast και το σβήνει.
 */
async function flash(input: ToastInput) {
  try {
    (await cookies()).set(FLASH_COOKIE, encodeFlash({ ...input, id: randomUUID() }), { path: "/", maxAge: 20, sameSite: "lax", httpOnly: false });
  } catch {
    // εκτός server action/route handler δεν γράφεται cookie: το μήνυμα χάνεται, η ενέργεια όχι
  }
}

/** «Το τιμολόγιο αποθηκεύτηκε»: τι έγινε, με το όνομα του πράγματος. */
export const flashOk = (title: string, link?: { href: string; text: string }) => flash({ kind: "success", title, href: link?.href, linkText: link?.text });
/** «Δεν αποθηκεύτηκε: <λόγος σε απλά λόγια>» και τι κάνει ο χρήστης μετά. */
export const flashFail = (title: string, detail = "Διόρθωσέ το και δοκίμασε ξανά.") => flash({ kind: "error", title, detail });
