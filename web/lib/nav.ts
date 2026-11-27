import {
  BarChart3, BellRing, BookOpen, Boxes, Building2, CalendarDays, ChefHat, ClipboardCheck, ClipboardList, Contact, CreditCard,
  ArrowRightLeft, Coins, Database, Factory, FileText, Gauge, Inbox, Landmark, LayoutDashboard, ListOrdered, Plug, MonitorSmartphone, Package, Percent, ReceiptText, ScanSearch, Server, Settings, ShieldCheck, LifeBuoy,
  Send, ShoppingCart, Store, TabletSmartphone, ThermometerSnowflake, Truck, Users, Warehouse, type LucideIcon,
} from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon; ready?: boolean };

// Ίδιες ενότητες και σειρά με το Gelato System. `ready` = η οθόνη υπάρχει ήδη στη νέα εφαρμογή.
// `group` = η ενότητα μένει αναδιπλούμενη ομάδα ακόμα και με ένα στοιχείο (θα μαζευτούν κι άλλα).
export const NAV: { title: string; icon: LucideIcon; group?: boolean; items: NavItem[] }[] = [
  { title: "Επισκόπηση", icon: LayoutDashboard, items: [{ to: "/", label: "Πίνακας ελέγχου", icon: LayoutDashboard, ready: true }] },
  {
    title: "Ταμείο & τιμολόγηση", icon: Store,
    items: [
      { to: "/pos", label: "Ταμείο", icon: Store, ready: true },
      { to: "/receipts", label: "Αποδείξεις", icon: ReceiptText, ready: true },
      { to: "/devices", label: "Συσκευές", icon: TabletSmartphone, ready: true },
    ],
  },
  {
    title: "Συνταγολόγιο", icon: ChefHat,
    items: [
      { to: "/materials", label: "Α΄ Ύλες", icon: Boxes, ready: true },
      { to: "/recipes", label: "Συνταγές", icon: ChefHat, ready: true },
      { to: "/products", label: "Προϊόντα", icon: Package, ready: true },
      { to: "/items", label: "Γενικά είδη", icon: Boxes, ready: true },
    ],
  },
  {
    title: "Παραγωγή", icon: Factory,
    items: [
      { to: "/production", label: "Παραγωγή", icon: Factory, ready: true },
      { to: "/haccp", label: "HACCP", icon: ThermometerSnowflake, ready: true },
      { to: "/traceability", label: "Ιχνηλασιμότητα", icon: ScanSearch, ready: true },
    ],
  },
  {
    title: "Αποθήκη & αγορές", icon: Warehouse,
    items: [
      { to: "/inventory", label: "Αποθήκες", icon: Warehouse, ready: true },
      { to: "/inventory/stock", label: "Απόθεμα", icon: Boxes, ready: true },
      { to: "/inventory/alerts", label: "Ειδοποιήσεις", icon: BellRing, ready: true },
      { to: "/inventory/transfers", label: "Μεταφορές", icon: ArrowRightLeft, ready: true },
      { to: "/purchases", label: "Τιμολόγια αγοράς", icon: Truck, ready: true },
      { to: "/counts", label: "Απογραφές", icon: ClipboardCheck, ready: true },
      { to: "/orders", label: "Παραγγελίες υλών", icon: ClipboardList, ready: true },
    ],
  },
  {
    title: "Πελάτες & πωλήσεις", icon: Contact,
    items: [
      { to: "/parties", label: "Συναλλασσόμενοι", icon: Contact, ready: true },
      { to: "/wholesale-orders", label: "Παραγγελίες", icon: ShoppingCart, ready: true },
      { to: "/invoices", label: "Παραστατικά", icon: FileText, ready: true },
      { to: "/transmissions", label: "Διαβιβάσεις myDATA", icon: Send, ready: true },
      { to: "/vitrine", label: "Βιτρίνα", icon: MonitorSmartphone, ready: true },
    ],
  },
  {
    title: "Ομάδα & δεδομένα", icon: Users,
    items: [
      { to: "/staff", label: "Προσωπικό", icon: CalendarDays, ready: true },
      { to: "/reports", label: "Αναφορές", icon: BarChart3, ready: true },
    ],
  },
  {
    title: "Υποστήριξη", icon: LifeBuoy,
    items: [
      { to: "/help", label: "Βοήθεια", icon: BookOpen, ready: true },
      { to: "/support", label: "Τα αιτήματά μου", icon: LifeBuoy, ready: true },
    ],
  },
  { title: "Οικονομικά", icon: Landmark, items: [{ to: "/finance", label: "Οικονομικά", icon: Landmark, ready: true }] },
  {
    title: "Πλατφόρμα", icon: Building2,
    items: [
      { to: "/platform", label: "Συνδρομητές", icon: Building2, ready: true },
      { to: "/platform/plans", label: "Πακέτα & τιμές", icon: Package, ready: true },
      { to: "/platform/usage", label: "Υπηρεσίες pay-as-you-go", icon: Gauge, ready: true },
      { to: "/platform/parties", label: "Συναλλασσόμενοι", icon: Contact, ready: true },
      { to: "/platform/staff", label: "Χρήστες & δικαιώματα", icon: Users, ready: true },
      { to: "/platform/gdpr", label: "GDPR & συναινέσεις", icon: ShieldCheck, ready: true },
      { to: "/platform/haccp", label: "HACCP αναφορές", icon: ShieldCheck, ready: true },
    ],
  },
  { title: "Ρυθμίσεις πλατφόρμας", icon: Settings, items: [{ to: "/platform/settings", label: "Ρυθμίσεις & email", icon: Settings, ready: true }, { to: "/platform/refs", label: "Λίστες αναφοράς", icon: ClipboardList, ready: true }] },
  {
    title: "Common Tables", icon: Database, group: true,
    items: [
      { to: "/platform/vat-rates", label: "Συντελεστές ΦΠΑ", icon: Percent, ready: true },
      { to: "/platform/currencies", label: "Νομίσματα", icon: Coins, ready: true },
      { to: "/platform/payment-methods", label: "Τρόποι πληρωμής", icon: CreditCard, ready: true },
      { to: "/platform/document-types", label: "Τύποι παραστατικών", icon: FileText, ready: true },
      { to: "/platform/catalog", label: "Κατάλογος ειδών", icon: Boxes, ready: true },
    ],
  },
  {
    title: "Υποστήριξη πελατών", icon: Inbox,
    items: [
      { to: "/platform/support", label: "Αιτήματα", icon: Inbox, ready: true },
      { to: "/platform/kb", label: "Βάση γνώσεων", icon: BookOpen, ready: true },
    ],
  },
  {
    title: "Υποδομή & ασφάλεια", icon: ShieldCheck,
    items: [
      { to: "/platform/infrastructure", label: "Υποδομή", icon: Server, ready: true },
      { to: "/platform/security", label: "Ασφάλεια", icon: ShieldCheck, ready: true },
      { to: "/platform/continuity", label: "Συνέχεια λειτουργίας", icon: LifeBuoy, ready: true },
    ],
  },
  {
    title: "Ρυθμίσεις", icon: Settings,
    items: [
      { to: "/billing", label: "Συνδρομή", icon: CreditCard, ready: true },
      { to: "/company", label: "Στοιχεία επιχείρησης", icon: Store, ready: true },
      { to: "/company/issuers", label: "Εκδότες (ΑΦΜ)", icon: Building2, ready: true },
      { to: "/company/series", label: "Σειρές παραστατικών", icon: ListOrdered, ready: true },
      { to: "/company/connections", label: "Συνδέσεις", icon: Plug, ready: true },
      { to: "/migration", label: "Μεταφορά δεδομένων", icon: Database, ready: true },
      { to: "/users", label: "Χρήστες & ρόλοι", icon: Users, ready: true },
      { to: "/gdpr", label: "GDPR & συναινέσεις", icon: ShieldCheck, ready: true },
    ],
  },
];

export const ALL_ITEMS = NAV.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title })));
