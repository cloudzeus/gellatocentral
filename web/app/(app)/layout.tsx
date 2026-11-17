import { Menu } from "lucide-react";
import { Suspense } from "react";
import { BottomNav, NavLinks, Sidebar, UserFooter } from "@/components/nav-links";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { needsLegalConsent } from "@/lib/gdpr";
import { redirect } from "next/navigation";
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
  // νέα έκδοση όρων (ή πρώτη είσοδος): πρώτα αποδοχή, μετά η εφαρμογή
  if (await needsLegalConsent(user.id)) redirect("/consent");
  const m = user.memberships[0];
  const permissions: string[] = m ? (m.role.locked ? ALL_PERMISSIONS : m.role.permissions) : [];
  const allowed = ALL_ITEMS.map((i) => i.to).filter((to) =>
    SUPER_ONLY.includes(to) ? platformCan(user.platformRole, "settings.manage") : to === "/platform/gdpr" ? platformCan(user.platformRole, "gdpr.manage") : to === "/platform/support" ? platformCan(user.platformRole, "support.tickets") : to === "/support" ? !!m : to.startsWith("/platform") ? !!user.platformRole : permissions.includes(permissionFor(to)),
  );
  // εκκρεμότητες δίπλα στο στοιχείο του μενού που τις λύνει
  const unsent = m && allowed.includes("/receipts") ? await db.fiscalDocument.count({ where: { sale: { orgId: m.orgId, status: "COMPLETED" }, status: { not: "SIGNED" } } }) : 0;
  // αιτήματα που περιμένουν ενέργεια: του πελάτη όσα απαντήθηκαν, της υποστήριξης όσα είναι νέα
  const seesAll = permissions.includes("tickets.manage");
  const waiting = m ? await db.ticket.count({ where: { orgId: m.orgId, status: "WAITING_CUSTOMER", ...(seesAll ? {} : { openedById: user.id }) } }) : 0;
  const fresh = platformCan(user.platformRole, "support.tickets") ? await db.ticket.count({ where: { status: "NEW" } }) : 0;
  return { allowed, badges: { "/receipts": unsent, "/support": waiting, "/platform/support": fresh }, user: { name: user.name, subtitle: m ? `${m.role.name} · ${m.org.name}` : user.platformRole ? PLATFORM_ROLES[user.platformRole].label : "", logout } };
}

async function Menus() {
  const nav = await navFor();
  if (!nav) return null;
  return (
    <>
      <Sidebar {...nav} />
      {/* Κινητό/tablet: το ίδιο μενού μέσα σε <details> */}
      <details className="group fixed left-3 top-3 z-40 lg:hidden print:hidden">
        <summary aria-label="Μενού" className="grid size-11 cursor-pointer list-none place-items-center rounded-lg border border-border bg-card shadow-xs [&::-webkit-details-marker]:hidden">
          <Menu className="size-4" />
        </summary>
        <div className="sidebar-surface fixed inset-y-0 left-0 z-40 flex w-72 flex-col overflow-y-auto pt-14 shadow-[var(--shadow-pop)]">
          <NavLinks allowed={nav.allowed} badges={nav.badges} />
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
