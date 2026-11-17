import {
  BarChart3, Boxes, Building2, CalendarDays, ChefHat, ClipboardCheck, ClipboardList, Contact, CreditCard,
  Factory, FileText, Landmark, LayoutDashboard, MonitorSmartphone, Package, ReceiptText, ScanSearch, Server, Settings, ShieldCheck, LifeBuoy,
  ShoppingCart, Store, TabletSmartphone, ThermometerSnowflake, Truck, Users, Warehouse, type LucideIcon,
} from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon; ready?: boolean };

// Ίδιες ενότητες και σειρά με το Gelato System. `ready` = η οθόνη υπάρχει ήδη στη νέα εφαρμογή.
export const NAV: { title: string; icon: LucideIcon; items: NavItem[] }[] = [
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
      { to: "/materials", label: "Α΄ Ύλες", icon: Boxes },
      { to: "/recipes", label: "Συνταγές", icon: ChefHat },
      { to: "/products", label: "Προϊόντα", icon: Package },
    ],
  },
  {
    title: "Παραγωγή", icon: Factory,
    items: [
      { to: "/production", label: "Παραγωγή", icon: Factory },
      { to: "/haccp", label: "HACCP", icon: ThermometerSnowflake },
      { to: "/traceability", label: "Ιχνηλασιμότητα", icon: ScanSearch },
    ],
  },
  {
    title: "Αποθήκη & αγορές", icon: Warehouse,
    items: [
      { to: "/inventory", label: "Αποθήκη", icon: Warehouse },
      { to: "/counts", label: "Απογραφές", icon: ClipboardCheck },
      { to: "/orders", label: "Παραγγελίες υλών", icon: ClipboardList },
      { to: "/suppliers", label: "Προμηθευτές", icon: Truck },
    ],
  },
  {
    title: "Πελάτες & πωλήσεις", icon: Contact,
    items: [
      { to: "/customers", label: "Πελάτες", icon: Contact, ready: true },
      { to: "/wholesale-orders", label: "Παραγγελίες", icon: ShoppingCart },
      { to: "/invoices", label: "Παραστατικά", icon: FileText },
      { to: "/vitrine", label: "Βιτρίνα", icon: MonitorSmartphone },
    ],
  },
  {
    title: "Ομάδα & δεδομένα", icon: Users,
    items: [
      { to: "/staff", label: "Προσωπικό", icon: CalendarDays },
      { to: "/reports", label: "Αναφορές", icon: BarChart3 },
    ],
  },
  { title: "Οικονομικά", icon: Landmark, items: [{ to: "/finance", label: "Οικονομικά", icon: Landmark }] },
  {
    title: "Πλατφόρμα", icon: Building2,
    items: [
      { to: "/platform", label: "Συνδρομητές", icon: Building2, ready: true },
      { to: "/platform/gdpr", label: "GDPR & συναινέσεις", icon: ShieldCheck, ready: true },
      { to: "/platform/settings", label: "Ρυθμίσεις & email", icon: Settings, ready: true },
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
      { to: "/company", label: "Στοιχεία επιχείρησης", icon: Store },
      { to: "/users", label: "Χρήστες & ρόλοι", icon: Users, ready: true },
      { to: "/gdpr", label: "GDPR & συναινέσεις", icon: ShieldCheck, ready: true },
    ],
  },
];

export const ALL_ITEMS = NAV.flatMap((s) => s.items.map((i) => ({ ...i, section: s.title })));
