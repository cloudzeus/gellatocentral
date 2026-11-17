const eur = new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" });
export const euro = (cents: number) => eur.format(cents / 100);
