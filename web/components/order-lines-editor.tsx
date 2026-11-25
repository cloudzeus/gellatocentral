"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { btn, Field, Select } from "./ui";

export type OrderItemOption = { id: string; name: string; unitLabel: string; scale: number; defaultPrice?: number; defaultVat?: number };
export type OrderLineValue = { genericItemId: string; quantity: string; unitPrice: string; vatRate: number };

export function OrderLinesEditor({ items, initialLines, priceLabel = "Τιμή προ ΦΠΑ" }: { items: OrderItemOption[]; initialLines?: OrderLineValue[]; priceLabel?: string }) {
  const blank = (): OrderLineValue => ({ genericItemId: items[0]?.id ?? "", quantity: "", unitPrice: "", vatRate: items[0]?.defaultVat ?? 24 });
  const [lines, setLines] = useState<OrderLineValue[]>(initialLines?.length ? initialLines : [blank()]);
  const update = (index: number, patch: Partial<OrderLineValue>) => setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  if (!items.length) return <p className="rounded-lg bg-gold/15 p-3 text-sm text-gold-ink">Δημιούργησε πρώτα ενεργά γενικά είδη.</p>;
  return (
    <div className="grid gap-3">
      {lines.map((line, index) => {
        const item = items.find((x) => x.id === line.genericItemId) ?? items[0];
        return (
          <div key={index} className="grid items-end gap-3 rounded-lg border border-border/70 p-3 md:grid-cols-[minmax(12rem,1fr)_8rem_9rem_6rem_auto]">
            <Select label="Είδος" name="genericItemId" required value={line.genericItemId} onChange={(e) => { const next = items.find((x) => x.id === e.target.value); update(index, { genericItemId: e.target.value, vatRate: next?.defaultVat ?? 24 }); }} options={items.map((x): [string, string] => [x.id, x.name])} />
            <Field label={`Ποσότητα (${item.unitLabel})`} name="quantity" required inputMode="decimal" placeholder="0" value={line.quantity} onChange={(e) => update(index, { quantity: e.target.value })} />
            <Field label={`${priceLabel} / ${item.unitLabel} (€)`} name="unitPrice" required inputMode="decimal" placeholder="0,00" value={line.unitPrice} onChange={(e) => update(index, { unitPrice: e.target.value })} />
            <Field label="ΦΠΑ %" name="vatRate" required type="number" min={0} max={100} step={1} value={line.vatRate} onChange={(e) => update(index, { vatRate: Number(e.target.value) })} />
            <button type="button" className={btn("ghost", "sm")} aria-label="Αφαίρεση γραμμής" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}><Trash2 /></button>
          </div>
        );
      })}
      <button type="button" className={btn("outline", "sm", "justify-self-start")} onClick={() => setLines((current) => [...current, blank()])}><Plus /> Γραμμή</button>
    </div>
  );
}
