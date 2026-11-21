"use client";
// Κοινό shadcn/Radix modal: focus trap, Esc, restore focus και portal χωρίς δικό μας boilerplate.
// Το πλάτος είναι μέρος του API (wide), ενώ ο χρήστης μπορεί να το αναπτύξει σε σχεδόν πλήρη οθόνη.
import { Maximize2, Minimize2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./shadcn/dialog";
import { btn, cn, menuItem as menuItemCls } from "./ui";

type Props = { label: ReactNode; title: string; description?: string; variant?: Parameters<typeof btn>[0]; size?: Parameters<typeof btn>[1]; /** πλατύ αρχικό παράθυρο για οδηγούς και σύνθετες φόρμες */ wide?: boolean; /** επιλογή μενού γραμμής αντί για κουμπί σελίδας */ menuItem?: boolean; children: ReactNode };

function DialogFrame({ title, description, wide, children, onSubmit }: { title: string; description?: string; wide: boolean; children: ReactNode; onSubmit?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <DialogContent
      showCloseButton={false}
      onSubmit={onSubmit}
      className={cn(
        "block gap-0 p-0 sm:max-h-[calc(100dvh-2rem)]",
        wide ? "sm:max-w-[68rem]" : "sm:max-w-[40rem]",
        expanded && "h-[calc(100dvh-1rem)] sm:h-[calc(100dvh-2rem)] sm:max-w-[calc(100vw-2rem)]",
      )}
    >
      <div className="sticky top-0 z-20 flex items-start gap-3 border-b border-border/70 bg-card/95 px-4 py-4 backdrop-blur sm:px-5">
        <DialogHeader className="min-w-0 flex-1 gap-0.5 text-left">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-pressed={expanded} aria-label={expanded ? "Επαναφορά μεγέθους παραθύρου" : "Ανάπτυξη παραθύρου"} title={expanded ? "Επαναφορά μεγέθους" : "Ανάπτυξη"} className={btn("ghost", "sm")}>{expanded ? <Minimize2 /> : <Maximize2 />}</button>
        <DialogClose asChild><button type="button" aria-label="Κλείσιμο" className={btn("ghost", "sm")}><X /></button></DialogClose>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </DialogContent>
  );
}

export function Modal({ label, title, description, variant = "outline", size = "default", wide = false, menuItem = false, children }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {menuItem
          ? <button type="button" role="menuitem" className={menuItemCls}>{label}</button>
          : <button type="button" className={btn(variant, size)}>{label}</button>}
      </DialogTrigger>
      {/* Μετά την υποβολή κλείνει· server errors και επιτυχία εμφανίζονται στη σελίδα από κάτω. */}
      <DialogFrame title={title} description={description} wide={wide} onSubmit={() => setOpen(false)}>{children}</DialogFrame>
    </Dialog>
  );
}

/** Παράθυρο που το ανοίγει ο server μέσω παραμέτρου του URL (π.χ. ?contacts=<id>). */
export function RoutedModal({ title, description, closeHref, wide = false, children }: { title: string; description?: string; closeHref: string; wide?: boolean; children: ReactNode }) {
  const router = useRouter();
  const close = () => router.replace(closeHref, { scroll: false });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogFrame title={title} description={description} wide={wide}>{children}</DialogFrame>
    </Dialog>
  );
}
