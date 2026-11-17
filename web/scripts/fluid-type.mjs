// Τυπώνει τα --fs-* tokens (360px κινητό → 1280px desktop). Πρόσθεσε μέγεθος στη λίστα και ξανατρέξε:
//   node scripts/fluid-type.mjs   → επικόλληση στο :root του app/globals.css
const sizes = [10.5, 11.5, 12.5, 13.5, 15, 17, 20, 26, 34];
const r = (px) => +(px / 16).toFixed(4);
const name = (d) => String(d).replace(".", "-"); // 11.5 → --fs-11-5
for (const d of sizes) {
  const m = d <= 15 ? d + 1 : d >= 22 ? d * 0.78 : d;
  if (m === d) { console.log(`  --fs-${name(d)}: ${r(d)}rem;`); continue; }
  const slope = (d - m) / 920, intercept = m - slope * 360;
  const vw = `${Math.abs(slope * 100).toFixed(4)}vw`;
  console.log(`  --fs-${name(d)}: clamp(${r(Math.min(m, d))}rem, ${r(intercept)}rem ${slope < 0 ? "-" : "+"} ${vw}, ${r(Math.max(m, d))}rem);`);
}
