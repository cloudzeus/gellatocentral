import { Menu, Snowflake } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { BottomNav, NavLinks, Sidebar, UserFooter } from "@/components/nav-links";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { needsLegalConsent } from "@/lib/gdpr";
import { redirect } from "next/navigation";
import { ALL_PERMISSIONS, permissionFor, platformCan, staffRoleLabel } from "@/lib/permissions";
import { ALL_ITEMS } from "@/lib/nav";
import { allowedPermissions, pathOpen } from "@/lib/modules";
import { accessFor } from "@/lib/plan-data";
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
  const access = m ? await accessFor(m.orgId, m.storeId) : null;
  const permissions: string[] = m ? allowedPermissions(m.role.locked ? ALL_PERMISSIONS : m.role.permissions, access!.open) : [];
  const allowed = ALL_ITEMS.map((i) => i.to).filter((to) =>
    SUPER_ONLY.includes(to) ? platformCan(user, "settings.manage") : to === "/platform/gdpr" ? platformCan(user, "gdpr.manage") : to === "/platform/support" ? platformCan(user, "support.tickets") : to === "/support" || to === "/help" ? !!m : to === "/platform/kb" ? platformCan(user, "support.tickets") : to === "/platform/plans" ? platformCan(user, "billing.manage") : to.startsWith("/platform") ? !!user.platformRole : permissions.includes(permissionFor(to)) && pathOpen(to, access?.open ?? []),
  );
  // εκκρεμότητες δίπλα στο στοιχείο του μενού που τις λύνει
  const unsent = m && allowed.includes("/receipts") ? await db.fiscalDocument.count({ where: { sale: { orgId: m.orgId, status: "COMPLETED" }, status: { not: "SIGNED" } } }) : 0;
  // αιτήματα που περιμένουν ενέργεια: του πελάτη όσα απαντήθηκαν, της υποστήριξης όσα είναι νέα
  const seesAll = permissions.includes("tickets.manage");
  const waiting = m ? await db.ticket.count({ where: { orgId: m.orgId, status: "WAITING_CUSTOMER", ...(seesAll ? {} : { openedById: user.id }) } }) : 0;
  const fresh = platformCan(user, "support.tickets") ? await db.ticket.count({ where: { status: "NEW" } }) : 0;
  return { allowed, badges: { "/receipts": unsent, "/support": waiting, "/platform/support": fresh, "/platform/kb": platformCan(user, "support.kb") ? await db.kbArticle.count({ where: { status: "REVIEW" } }) : 0 }, user: { name: user.name, subtitle: m ? `${m.role.name} · ${m.org.name}` : user.platformRole ? staffRoleLabel(user) : "", logout } };
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

/** Κατάστημα σε εποχιακή παύση: το λέμε σε κάθε σελίδα, μαζί με το τι μένει ανοιχτό και ποιος το ανοίγει ξανά. */
async function PauseBanner() {
  const user = await getUser();
  const m = user?.memberships[0];
  if (!m) return null;
  const access = await accessFor(m.orgId, m.storeId);
  if (!access.paused) return null;
  const mine = access.pausedStores.filter((s) => !m.storeId || s.id === m.storeId);
  const canResume = (m.role.locked ? ALL_PERMISSIONS : m.role.permissions).includes("stores.pause");
  return (
    <div role="status" className="flex items-start gap-3 border-b border-gold/40 bg-gold/10 px-6 py-3 text-sm print:hidden max-lg:pl-16">
      <Snowflake className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden />
      <p className="min-w-0 flex-1">
        <b>{mine.length === 1 ? `Το κατάστημα «${mine[0].name}» είναι` : "Τα καταστήματα είναι"} σε εποχιακή παύση από {mine[0].since.toLocaleDateString("el-GR")}.</b>{" "}
        Το ταμείο και οι βασικές ενότητες είναι κλειστά όσο κρατά. {canResume ? <Link href="/billing#stores" className="font-semibold underline">Άνοιγμα ξανά από τη Συνδρομή</Link> : "Για να ανοίξει ξανά, μίλα με τον διαχειριστή της επιχείρησης"}
      </p>
    </div>
  );
}

// Το μενού και οι σελίδες διαβάζουν τη βάση και έρχονται με ροή (Suspense / loading.tsx).
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh">
      <Suspense fallback={<div className="sidebar-surface hidden w-[17rem] shrink-0 lg:block" />}>
        <Menus />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={null}><PauseBanner /></Suspense>
        {children}
      </div>
    </div>
  );
}
