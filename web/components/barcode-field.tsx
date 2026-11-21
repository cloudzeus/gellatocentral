"use client";
// Πεδίο barcode: οι USB/Bluetooth scanners γράφουν σαν πληκτρολόγιο και κλείνουν με Enter (δουλεύει χωρίς κώδικα)·
// το κουμπί ανοίγει την κάμερα όπου υπάρχει BarcodeDetector (Chrome/Edge/Android). Η ανάλυση GS1 γίνεται στον server.

import { useEffect, useRef, useState } from "react";
import { ScanBarcode, X } from "lucide-react";

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
  }
}

export function BarcodeField({ label, hint, name, defaultValue, onValue }: { label: string; hint?: string; name: string; defaultValue?: string; onValue?: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window && typeof navigator !== "undefined" && !!navigator.mediaDevices;

  useEffect(() => {
    if (!scanning) return;
    let stop = false;
    let stream: MediaStream | null = null;
    let timer: number;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const detector = new window.BarcodeDetector!({ formats: ["ean_13", "ean_8", "code_128", "data_matrix", "qr_code"] });
        const tick = async () => {
          if (stop) return;
          try {
            const found = await detector.detect(video);
            const value = found[0]?.rawValue;
            if (value && inputRef.current) {
              inputRef.current.value = value;
              inputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
              onValue?.(value);
              setScanning(false);
              return;
            }
          } catch { /* καρέ χωρίς αναγνώριση — συνεχίζουμε */ }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      } catch {
        setScanning(false); // ο χρήστης αρνήθηκε την κάμερα ή δεν υπάρχει
      }
    })();
    return () => {
      stop = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning, onValue]);

  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex gap-2">
        <input ref={inputRef} name={name} defaultValue={defaultValue} inputMode="numeric" maxLength={14} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Σάρωση ή πληκτρολόγηση" />
        {supported ? (
          <button type="button" onClick={() => setScanning(true)} className="rounded-lg border border-input px-3 text-sm hover:bg-secondary" title="Σάρωση με την κάμερα">
            <ScanBarcode className="size-4" />
          </button>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {scanning ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-label="Σάρωση barcode">
          <div className="w-full max-w-sm rounded-xl bg-card p-3">
            <video ref={videoRef} className="w-full rounded-lg" muted playsInline />
            <button type="button" onClick={() => setScanning(false)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-input px-3 py-2 text-sm">
              <X className="size-4" /> Κλείσιμο
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
