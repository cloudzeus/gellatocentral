import { Menu } from "lucide-react";
import { Suspense } from "react";
import { BottomNav, NavLinks, Sidebar, UserFooter } from "@/components/nav-links";
import { getUser } from "@/lib/auth";
import { ALL_PERMISSIONS, permissionFor, PLATFORM_ROLES, platformCan } from "@/lib/permissions";
import { ALL_ITEMS } from "@/lib/nav";
import { logout } from "../login/actions";

// Κάθε σελίδα εδώ είναι ζωντανά δεδομένα μιας επιχείρησης: δεν ζητάμε «στιγμιαία» πλοήγηση από cache.
export const instant = false;

// Σελίδες της κονσόλας που βλέπει μόνο όποιος διαχειρίζεται την πλατφόρμα (Super Admin)
const SUPER_ONLY = ["/platform/settings", "/platform/infrastructure", "/platform/security", "/platform/continuity"];

/** Τι επιτρέπει ο ρόλος του χρήστη και τα στοιχεία του για το κάτω μέρος του μενού. */
async function navFor() {
  const user = await getUser();
  if (!user) return null;
  const m = user.memberships[0];
  const permissions: string[] = m ? (m.role.locked ? ALL_PERMISSIONS : m.role.permissions) : [];
  const allowed = ALL_ITEMS.map((i) => i.to).filter((to) =>
    SUPER_ONLY.includes(to) ? platformCan(user.platformRole, "settings.manage") : to.startsWith("/platform") ? !!user.platformRole : permissions.includes(permissionFor(to)),
  );
  return { allowed, user: { name: user.name, subtitle: m ? `${m.role.name} · ${m.org.name}` : user.platformRole ? PLATFORM_ROLES[user.platformRole].label : "", logout } };
}

async function Menus() {
  const nav = await navFor();
  if (!nav) return null;
  return (
    <>
      <Sidebar {...nav} />
      {/* Κινητό/tablet: το ίδιο μενού μέσα σε <details> */}
      <details className="group fixed left-3 top-3 z-40 lg:hidden print:hidden">
        <summary aria-label="Μενού" className="grid size-11 cursor-pointer list-none place-items-center rounded-xl border border-border bg-card shadow-xs [&::-webkit-details-marker]:hidden">
          <Menu className="size-4" />
        </summary>
        <div className="sidebar-surface fixed inset-y-0 left-0 z-40 flex w-72 flex-col overflow-y-auto pt-14 shadow-[var(--shadow-pop)]">
          <NavLinks allowed={nav.allowed} />
          <UserFooter user={nav.user} />
        </div>
      </details>
      <BottomNav allowed={nav.allowed} />
    </>
  );
}

// Το μενού και οι σελίδες διαβάζουν τη βάση και έρχονται με ροή (Suspense / loading.tsx).
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh">
      <Suspense fallback={<div className="sidebar-surface hidden w-[17rem] shrink-0 lg:block" />}>
        <Menus />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
