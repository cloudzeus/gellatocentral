"use client";

import { FullPageError } from "@/components/error-screens";
import "./globals.css";

// Αντικαθιστά το root layout όταν πέσει κι εκείνο: φέρνει δικό του έγγραφο, στυλ και το θέμα που είχε διαλέξει ο χρήστης.
const THEME_SCRIPT = `try{var t=JSON.parse(localStorage.getItem("gs.theme"));if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function GlobalError(props: { error: unknown; retry: () => void }) {
  return (
    <html lang="el" suppressHydrationWarning>
      <head><title>Η εφαρμογή δεν άνοιξε · Gelato System</title><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="app-canvas min-h-dvh antialiased"><FullPageError {...props} /></body>
    </html>
  );
}
