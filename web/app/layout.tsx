import type { Metadata, Viewport } from "next";
import { Nunito_Sans } from "next/font/google";
import { RegisterServiceWorker } from "@/components/pwa";
import "./globals.css";

const nunito = Nunito_Sans({ variable: "--font-nunito", subsets: ["latin"] });
// Το Nunito Sans δεν έχει ελληνικά: όπως και στο Gelato System, τα ελληνικά αποδίδονται με τη γραμματοσειρά συστήματος.

export const metadata: Metadata = {
  title: "Gelato System",
  description: "Παραγωγή, ταμείο και τιμολόγηση για εργαστήρια και καταστήματα παγωτού",
  applicationName: "Gelato System",
  appleWebApp: { capable: true, title: "Gelato System", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#131F3B" };

// Η εφαρμογή ανοίγει πάντα φωτεινή. Σκοτεινή γίνεται μόνο αν το διαλέξει ο χρήστης από το κουμπί του μενού.
const THEME_SCRIPT = `try{var t=JSON.parse(localStorage.getItem("gs.theme"));if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="el" className={nunito.variable} data-bottom-nav suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="app-canvas min-h-dvh antialiased">{children}<RegisterServiceWorker /></body>
    </html>
  );
}
