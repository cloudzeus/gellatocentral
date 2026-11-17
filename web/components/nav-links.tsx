"use client";
// Το μενού. Client component: το ενεργό στοιχείο εξαρτάται από το URL, και το άνοιγμα/κλείσιμο των ομάδων
// και του ίδιου του μενού θυμάται την επιλογή του χρήστη (localStorage).
import { ChevronDown, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";
import { useStored } from "@/lib/use-stored";
import { cn } from "./ui";

const ALL = NAV.flatMap((s) => s.items.map((i) => i.to));
const matches = (path: string, to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`));
/** Ενεργό είναι το πιο συγκεκριμένο στοιχείο που ταιριάζει (π.χ. /platform/settings και όχι /platform). */
const isActive = (path: string, to: string) => matches(path, to) && !ALL.some((o) => o.length > to.length && matches(path, o));

const row = (active: boolean, extra?: string) =>
  cn(
    "group relative flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm font-medium transition-colors duration-150 pointer-coarse:min-h-11",
    "before:absolute before:left-0 before:top-1/2 before:h-0 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-sidebar-primary before:transition-[height] before:duration-150",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground before:h-4"
      : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
    extra,
  );
const tile = (active: boolean) =>
  cn("grid size-5 shrink-0 place-items-center transition-colors duration-150", active ? "text-sidebar-primary" : "text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground");
const soon = <span className="ml-auto shrink-0 text-xs font-normal text-sidebar-foreground/45">Σύντομα</span>;
const closeDrawer = (e: React.MouseEvent<HTMLElement>) => e.currentTarget.closest("details")?.removeAttribute("open");

/**
 * Ομάδες με εικονίδιο που ανοίγουν και κλείνουν. Ομάδα με ένα μόνο στοιχείο είναι απευθείας σύνδεσμος.
 * `collapsed`: στενή στήλη μόνο με εικονίδια ομάδων· το πάτημα σε ομάδα ανοίγει το μενού σε εκείνη (`onExpand`).
 */
export function NavLinks({ allowed, badges = {}, collapsed = false, onExpand }: { allowed: string[]; badges?: Record<string, number>; collapsed?: boolean; onExpand?: () => void }) {
  const path = usePathname();
  const [open, setOpen] = useStored<Record<string, boolean>>("gs.nav.open", {});
  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => allowed.includes(i.to)) })).filter((s) => s.items.length);

  return (
    <nav aria-label="Κύριο μενού" className={cn("flex-1 space-y-0.5 pb-4", collapsed ? "px-2" : "px-3")}>
      {sections.map((section) => {
        const activeHere = section.items.some((i) => isActive(path, i.to));
        const single = section.items.length === 1 ? section.items[0] : null;
        const Icon = section.icon;

        if (single)
          return (
            <Link key={section.title} href={single.to} onClick={closeDrawer} aria-current={activeHere ? "page" : undefined} title={collapsed ? single.label : undefined} className={row(activeHere, collapsed ? "justify-center px-0" : "")}>
              <span className={tile(activeHere)}><Icon className="size-4" /></span>
              <span className={collapsed ? "sr-only" : "min-w-0 truncate"}>{single.label}</span>
              {!single.ready && !collapsed ? soon : null}
              {badges[single.to] && !collapsed ? <span aria-label={`${badges[single.to]} σε εκκρεμότητα`} className="ml-auto grid h-4.5 min-w-4.5 shrink-0 place-items-center rounded-md bg-sidebar-primary px-1 text-2xs font-semibold text-sidebar-primary-foreground tabular-nums">{badges[single.to]}</span> : null}
            </Link>
          );

        // η ομάδα της τρέχουσας σελίδας είναι ανοιχτή, εκτός αν ο χρήστης την έκλεισε ρητά
        const isOpen = !collapsed && (open[section.title] ?? activeHere);
        return (
          <div key={section.title}>
            <button
              type="button"
              aria-expanded={isOpen}
              title={collapsed ? section.title : undefined}
              onClick={() => {
                if (collapsed) {
                  setOpen({ ...open, [section.title]: true });
                  onExpand?.();
                } else setOpen({ ...open, [section.title]: !isOpen });
              }}
              className={row(activeHere && !isOpen, cn("cursor-pointer", collapsed && "justify-center px-0"))}
            >
              <span className={tile(activeHere)}><Icon className="size-4" /></span>
              <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{section.title}</span>
              {collapsed ? null : <ChevronDown className={cn("size-4 shrink-0 opacity-60 transition-transform duration-200", isOpen && "rotate-180")} />}
            </button>
            {isOpen ? (
              <div className="my-0.5 ml-[1.125rem] space-y-0.5 border-l border-sidebar-border pl-2">
                {section.items.map((item) => {
                  const active = isActive(path, item.to);
                  return (
                    <Link key={item.to} href={item.to} onClick={closeDrawer} aria-current={active ? "page" : undefined} className={row(active, "min-h-8")}>
                      <item.icon className={cn("size-4 shrink-0", active ? "text-sidebar-primary" : "opacity-70")} />
                      <span className="min-w-0 truncate">{item.label}</span>
                      {item.ready ? null : soon}
                      {badges[item.to] ? <span aria-label={`${badges[item.to]} σε εκκρεμότητα`} className="ml-auto grid h-4.5 min-w-4.5 shrink-0 place-items-center rounded-md bg-sidebar-primary px-1 text-2xs font-semibold text-sidebar-primary-foreground tabular-nums">{badges[item.to]}</span> : null}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

const footBtn = "grid size-10 cursor-pointer place-items-center rounded-lg text-sidebar-foreground/70 transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground pointer-coarse:size-11";

/** Φωτεινό (προεπιλογή) / σκοτεινό, μόνο με επιλογή του χρήστη (βλ. THEME_SCRIPT στο app/layout). */
function ThemeToggle() {
  const [theme, setTheme] = useStored<"light" | "dark" | null>("gs.theme", null);
  const toggle = () => {
    const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    setTheme(next);
  };
  const label = theme === "dark" ? "Φωτεινό θέμα" : "Σκοτεινό θέμα";
  return <button type="button" onClick={toggle} aria-label="Αλλαγή θέματος" title={label} className={footBtn}><Sun className="hidden size-4 dark:block" /><Moon className="size-4 dark:hidden" /></button>;
}

type User = { name: string; subtitle: string; logout: () => Promise<void> };

export function UserFooter({ user, collapsed = false }: { user: User; collapsed?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 border-t border-sidebar-border py-3 text-xs text-sidebar-foreground/70", collapsed ? "justify-center px-2" : "px-4")}>
      {collapsed ? null : (
        <Link href="/my-data" onClick={closeDrawer} title="Τα δεδομένα μου" className="min-w-0 flex-1 rounded-lg px-1 py-0.5 hover:bg-sidebar-accent/60">
          <p className="truncate font-semibold text-sidebar-foreground">{user.name}</p>
          <p className="truncate">{user.subtitle}</p>
        </Link>
      )}
      {collapsed ? null : <ThemeToggle />}
      <form action={user.logout}>
        <button aria-label="Έξοδος" title="Έξοδος" className="grid size-10 cursor-pointer place-items-center rounded-lg text-sidebar-foreground/70 transition-colors duration-200 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground pointer-coarse:size-11">
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}

/** Πλαϊνό μενού desktop: πλήρες (17rem) ή στενή στήλη εικονιδίων (4.5rem). */
export function Sidebar({ allowed, badges, user }: { allowed: string[]; badges?: Record<string, number>; user: User }) {
  const [collapsed, setCollapsed] = useStored("gs.nav.collapsed", false);
  const Toggle = collapsed ? PanelLeftOpen : PanelLeftClose;
  const label = collapsed ? "Άνοιγμα μενού" : "Σύμπτυξη μενού";
  return (
    <aside className={cn("sidebar-surface scrollbar-hide sticky top-0 hidden h-dvh shrink-0 flex-col overflow-y-auto border-r border-sidebar-border lg:flex print:!hidden", collapsed ? "w-[4.5rem]" : "w-[17rem]")}>
      <div className={cn("flex items-center gap-2 pt-5 pb-4", collapsed ? "flex-col px-2" : "pr-3 pl-5")}>
        <div className={cn("flex items-center", collapsed ? "size-11 justify-center" : "min-w-0 flex-1")}>
          {collapsed ? <Image src="/icon.png" alt="Gelato System" width={28} height={28} className="size-7 object-contain" /> : <Image src="/logo.png" alt="Gelato System" width={640} height={352} priority className="h-14 w-auto object-contain" />}
        </div>
        <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={label} title={label} aria-expanded={!collapsed} className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-sidebar-foreground/70 transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground">
          <Toggle className="size-4" />
        </button>
      </div>
      <NavLinks allowed={allowed} badges={badges} collapsed={collapsed} onExpand={() => setCollapsed(false)} />
      <UserFooter user={user} collapsed={collapsed} />
    </aside>
  );
}

const BOTTOM = ["/", "/pos", "/receipts", "/devices"];
export function BottomNav({ allowed }: { allowed: string[] }) {
  const path = usePathname();
  const items = NAV.flatMap((s) => s.items).filter((i) => BOTTOM.includes(i.to) && allowed.includes(i.to));
  if (items.length < 2) return null;
  return (
    <nav aria-label="Γρήγορη πλοήγηση" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border/60 bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden print:hidden">
      {items.map(({ to, label, icon: Icon }) => (
        <Link key={to} href={to} className={cn("flex h-15 flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold", isActive(path, to) ? "text-primary" : "text-muted-foreground")}>
          <Icon className="size-5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
