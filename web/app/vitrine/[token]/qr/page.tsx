import type { Metadata } from "next";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { PrintButton } from "@/components/print-button";
import { Card } from "@/components/ui";
import { publicVitrine } from "@/lib/vitrine-db";

// Το QR εξαρτάται πάντα από το προσωπικό token και από τα headers του αιτήματος.
export const instant = false;

export const metadata: Metadata = { title: "QR βιτρίνας", robots: { index: false, follow: false } };

export default async function VitrineQrPage({ params }: PageProps<"/vitrine/[token]/qr">) {
  const { token } = await params;
  let vitrine;
  try { vitrine = await publicVitrine(token); } catch { return <main className="mx-auto max-w-xl p-6"><Card className="p-6"><h1 className="text-xl font-semibold">Το QR δεν είναι διαθέσιμο</h1></Card></main>; }
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:7100";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = `${protocol}://${host}/vitrine/${encodeURIComponent(token)}`;
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 640, color: { dark: "#131F3B", light: "#FFFFFF" } });
  return <main className="mx-auto max-w-2xl p-6 text-center"><div className="mb-5 print:hidden"><PrintButton /></div><Card className="p-8"><p className="text-sm text-muted-foreground">{vitrine.orgName}</p><h1 className="mt-1 text-2xl font-semibold">{vitrine.storeName}</h1><p className="mt-2 text-muted-foreground">Σκάναρε για τις διαθέσιμες γεύσεις</p><div className="mx-auto mt-6 max-w-md [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} /><p className="mt-5 break-all text-xs text-muted-foreground print:hidden">{url}</p></Card></main>;
}
