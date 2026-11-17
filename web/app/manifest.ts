import type { MetadataRoute } from "next";

// Η εφαρμογή εγκαθίσταται σε κινητό, tablet και υπολογιστή (PWA) και ανοίγει σε δικό της παράθυρο.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gelato System",
    short_name: "Gelato",
    description: "Παραγωγή, ταμείο και τιμολόγηση για εργαστήρια και καταστήματα παγωτού",
    lang: "el",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#F5F2EC",
    theme_color: "#131F3B",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Ταμείο", url: "/pos" },
      { name: "Αποδείξεις", url: "/receipts" },
    ],
  };
}
