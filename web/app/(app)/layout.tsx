import { CircleAlert, Menu, Snowflake } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { BottomNav, NavLinks, Sidebar, UserFooter } from "@/components/nav-links";
import { OfflineCountSessionGuard } from "@/components/offline-counts";
import { getUser, memberPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { needsLegalConsent } from "@/lib/gdpr";
import { redirect } from "next/navigation";
import { permissionFor, platformCan, staffRoleLabel } from "@/lib/permissions";
import { ALL_ITEMS } from "@/lib/nav";
import { pathOpen } from "@/lib/modules";
import { accessFor } from "@/lib/plan-data";
import { logout } from "../login/actions";

// Κάθε σελίδα εδώ είναι ζωντανά δεδομένα μιας επιχείρησης: δεν ζητάμε «στιγμιαία» πλοήγηση από cache.
export const instant = false;

// Σελίδες της κονσόλας που βλέπει μόνο όποιος διαχειρίζεται την πλατφόρμα (Super Admin)
const SUPER_ONLY = ["/platform/settings", "/platform/refs", "/platform/vat-rates", "/platform/payment-methods", "/platform/document-types", "/platform/infrastructure", "/platform/security", "/platform/continuity"];

/** Τι επιτρέπει ο ρόλος του χρήστη και τα στοιχεία του για το κάτω μέρος του μενού. */
async function navFor() {
  const user = await getUser();
  if (!user) return null;
  // νέα έκδοση όρων (ή πρώτη είσοδος): πρώτα αποδοχή, μετά η εφαρμογή
  if (await needsLegalConsent(user.id)) redirect("/consent");
  const m = user.memberships[0];
  const access = m ? await accessFor(m.orgId, m.stores.map((s) => s.storeId)) : null;
  const permissions: string[] = m ? memberPermissions(m, access!.open) : [];
  const allowed = ALL_ITEMS.map((i) => i.to).filter((to) =>
    SUPER_ONLY.includes(to) ? platformCan(user, "settings.read") : to === "/platform/gdpr" ? platformCan(user, "gdpr.read") : to === "/platform/support" ? platformCan(user, "support.tickets") : to === "/support" || to === "/help" ? !!m : to === "/platform/kb" ? platformCan(user, "support.tickets") : to === "/platform/plans" || to === "/platform/usage" ? platformCan(user, "billing.read") : to === "/platform/staff" ? platformCan(user, "staff.read") : to.startsWith("/platform") ? !!user.platformRole : permissions.includes(permissionFor(to)) && pathOpen(to, access?.open ?? []),
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

async function OfflineSessionGuard() {
  const user = await getUser();
  const membership = user?.memberships[0];
  if (!user || !membership) return null;
  return <OfflineCountSessionGuard identity={{ orgId: membership.orgId, userId: user.id }} />;
}

const bar = "flex items-start gap-3 border-b px-6 py-3 text-sm print:hidden max-lg:pl-16";
/**
 * Ό,τι περιορίζει την επιχείρηση το λέμε σε κάθε σελίδα, μαζί με το τι κάνει ο χρήστης μετά: κλείσιμο, αναστολή,
 * απλήρωτη συνδρομή (ή περίοδος χάριτος) και εποχιακή παύση καταστήματος.
 */
async function StateBanner() {
  const user = await getUser();
  const m = user?.memberships[0];
  if (!m) return null;
  const storeIds = m.stores.map((s) => s.storeId);
  const access = await accessFor(m.orgId, storeIds);
  const perms = memberPermissions(m, access.open);
  const pay = perms.includes("billing.read") ? <Link href="/billing" className="font-semibold underline">Πληρωμή από τη Συνδρομή</Link> : "Ενημέρωσε τον διαχειριστή της επιχείρησης";
  const { kind, daysLeft } = access.state;
  if (kind === "closing")
    return (
      <div role="alert" className={`${bar} border-destructive/30 bg-destructive/10`}>
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <p className="min-w-0 flex-1"><b>Η επιχείρηση κλείνει.</b> Το ταμείο είναι κλειστό και τα δεδομένα θα διαγραφούν οριστικά {daysLeft ? `σε ${daysLeft} ημέρες` : "σύντομα"}. {m.role.locked ? <><a href="/api/org-export" download className="font-semibold underline">Κατέβασε αντίγραφο όλων των δεδομένων</a> και το <a href="/api/org-export?format=receipts" download className="font-semibold underline">αρχείο αποδείξεων για τον λογιστή σου</a></> : "Ο Επιχειρηματίας μπορεί να κατεβάσει αντίγραφο των δεδομένων"}. Αν έγινε κατά λάθος, γράψε στην υποστήριξη</p>
      </div>
    );
  if (kind === "suspended")
    return (
      <div role="alert" className={`${bar} border-destructive/30 bg-destructive/10`}>
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <p className="min-w-0 flex-1"><b>Η επιχείρηση είναι σε αναστολή.</b> {access.reason ? `Λόγος: ${access.reason}. ` : ""}Το ταμείο και οι ενότητες είναι κλειστά· βλέπεις τις αποδείξεις που έχουν εκδοθεί. <Link href="/support" className="font-semibold underline">Γράψε στην υποστήριξη</Link></p>
      </div>
    );
  if (kind === "unpaid")
    return (
      <div role="alert" className={`${bar} border-destructive/30 bg-destructive/10`}>
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <p className="min-w-0 flex-1"><b>Η συνδρομή έχει λήξει και το ταμείο είναι κλειστό.</b> Με την πληρωμή ανοίγουν όλα αμέσως, χωρίς να έχει χαθεί τίποτα. {pay}</p>
      </div>
    );
  if (kind === "grace")
    return (
      <div role="status" className={`${bar} border-gold/40 bg-gold/10`}>
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden />
        <p className="min-w-0 flex-1"><b>Η συνδρομή έληξε.</b> Όλα δουλεύουν κανονικά για {daysLeft} {daysLeft === 1 ? "ημέρα" : "ημέρες"} ακόμα· μετά κλείνει το ταμείο. {pay}</p>
      </div>
    );
  if (!access.paused) return null;
  const mine = access.pausedStores.filter((s) => !storeIds.length || storeIds.includes(s.id));
  return (
    <div role="status" className={`${bar} border-gold/40 bg-gold/10`}>
      <Snowflake className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden />
      <p className="min-w-0 flex-1">
        <b>{mine.length === 1 ? `Το κατάστημα «${mine[0].name}» είναι` : "Τα καταστήματα είναι"} σε εποχιακή παύση από {mine[0].since.toLocaleDateString("el-GR")}.</b>{" "}
        Το ταμείο και οι βασικές ενότητες είναι κλειστά όσο κρατά. {perms.includes("stores.pause") ? <Link href="/billing#stores" className="font-semibold underline">Άνοιγμα ξανά από τη Συνδρομή</Link> : "Για να ανοίξει ξανά, μίλα με τον διαχειριστή της επιχείρησης"}
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
      <Suspense fallback={null}><OfflineSessionGuard /></Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={null}><StateBanner /></Suspense>
        {children}
      </div>
    </div>
  );
}
