"use client";
// Χάρτης OpenStreetMap (Leaflet). Δείχνει σημεία· με `pick` ο χρήστης πατά στον χάρτη και γεμίζουν τα πεδία
// συντεταγμένων της φόρμας μέσα στην οποία βρίσκεται. Οι πινέζες είναι κύκλοι, ώστε να μη χρειάζονται αρχεία εικόνων.
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export type MapPoint = { latitude: number; longitude: number; label: string; primary?: boolean };
const GREECE: [number, number] = [38.5, 23.8];
const num = (v: number) => v.toFixed(6).replace(".", ",");

export function PartyMap({ points, pick, className = "h-64" }: { points: MapPoint[]; pick?: { lat: string; lng: string }; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(points);
  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let alive = true;
    void import("leaflet").then((L) => {
      if (!alive || !box.current) return;
      map = L.map(box.current, { scrollWheelZoom: false }).setView(points[0] ? [points[0].latitude, points[0].longitude] : GREECE, points[0] ? 14 : 6);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      const style = (primary?: boolean) => ({ radius: 8, weight: 2, color: "#fff", fillColor: primary ? "#16213f" : "#a88a4d", fillOpacity: 1 });
      for (const p of points) L.circleMarker([p.latitude, p.longitude], style(p.primary)).addTo(map).bindTooltip(p.label);
      if (points.length > 1) map.fitBounds(L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number])).pad(0.3));
      if (pick) {
        const form = box.current.closest("form");
        const field = (name: string) => form?.elements.namedItem(name) as HTMLInputElement | null;
        let marker = points[0] ? undefined : undefined as import("leaflet").CircleMarker | undefined;
        map.on("click", (e) => {
          const lat = field(pick.lat), lng = field(pick.lng);
          if (!lat || !lng) return;
          lat.value = num(e.latlng.lat);
          lng.value = num(e.latlng.lng);
          marker?.remove();
          marker = L.circleMarker(e.latlng, style(true)).addTo(map!);
        });
      }
      // μέσα σε παράθυρο διαλόγου ο χάρτης μετρά το μέγεθός του πριν φανεί
      setTimeout(() => map?.invalidateSize(), 200);
    });
    return () => { alive = false; map?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- τα σημεία συγκρίνονται με το περιεχόμενό τους (key)
  }, [key, pick?.lat, pick?.lng]);
  return <div ref={box} role="img" aria-label={points.length ? `Χάρτης με ${points.length} σημεία: ${points.map((p) => p.label).join(", ")}` : "Χάρτης"} className={`isolate w-full overflow-hidden rounded-lg border border-border ${className}`} />;
}
