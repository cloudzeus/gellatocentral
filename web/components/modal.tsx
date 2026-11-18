"use client";
// Παράθυρο φόρμας πάνω στο εγγενές <dialog>: Esc και εστίαση τα χειρίζεται ο browser.
// Με menuItem το κουμπί γίνεται επιλογή μενού γραμμής πίνακα και το παράθυρο βγαίνει με portal στο body:
// το μενού κρύβεται μόλις πατηθεί η επιλογή και χωρίς portal θα έκρυβε μαζί του και το παράθυρο.
import { X } from "lucide-react";
import { type ReactNode, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { btn, menuItem as menuItemCls } from "./ui";

type Props = { label: ReactNode; title: string; description?: string; variant?: Parameters<typeof btn>[0]; size?: Parameters<typeof btn>[1]; /** επιλογή μενού γραμμής αντί για κουμπί σελίδας */ menuItem?: boolean; children: ReactNode };
const noSubscribe = () => () => {};

export function Modal({ label, title, description, variant = "outline", size = "default", menuItem = false, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  // στον server δεν υπάρχει document· το portal στήνεται μόνο στον browser
  const browser = useSyncExternalStore(noSubscribe, () => true, () => false);
  const close = () => ref.current?.close();
  const dialog = (
    <dialog
      ref={ref}
      aria-label={title}
      // η υποβολή κλείνει το παράθυρο· το αποτέλεσμα (ή το λάθος) φαίνεται στη σελίδα από κάτω.
      // Τα υποχρεωτικά πεδία τα ελέγχει ο browser πριν φτάσει εδώ, οπότε μια ελλιπής φόρμα μένει ανοιχτή.
      onSubmit={close}
      onClick={(e) => e.target === ref.current && close()} // πάτημα έξω από το παράθυρο
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border/70 bg-card p-0 text-card-foreground shadow-[var(--shadow-pop)] backdrop:bg-primary/55 backdrop:backdrop-blur-sm"
    >
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-border/70 bg-card px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <button type="button" onClick={close} aria-label="Κλείσιμο" className={btn("ghost", "sm")}><X /></button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
  return (
    <>
      {menuItem
        ? <button type="button" role="menuitem" className={menuItemCls} onClick={() => ref.current?.showModal()}>{label}</button>
        : <button type="button" className={btn(variant, size)} onClick={() => ref.current?.showModal()}>{label}</button>}
      {menuItem ? (browser ? createPortal(dialog, document.body) : null) : dialog}
    </>
  );
}
