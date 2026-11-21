#!/usr/bin/env python3
"""Χτίζει τα seed JSON της γεωγραφίας (prisma/geo/regions.json, cities.json).

Πηγές (κατέβασμα πριν το run, στο ίδιο φάκελο):
  - kallikratis.xlsx: επίσημο κωδικολόγιο Καλλικράτη (ΥΠ.ΕΣ. / ΕΕΤΑΑ) —
    https://github.com/AchillesKal/kallikratis (resources/kallikraths_kwdikologio1_31_5_11.xlsx)
  - GR.txt: GeoNames dump Ελλάδας — https://download.geonames.org/export/dump/GR.zip

Το xlsx δίνει την επίσημη ιεραρχία και τους κωδικούς (Περιφέρεια 1-13, Π.Ε. 3-4 ψηφία,
Δήμος 9xxx, Κοινότητα 8 ψηφία)· το GeoNames δίνει τονωμένα ονόματα και συντεταγμένες.
Οι κωδικοί Δήμων είναι ΚΟΙΝΟΙ και στις δύο πηγές (το GeoNames χρησιμοποιεί τους
επίσημους κωδικούς Καλλικράτη στο admin3), οπότε η ένωση γίνεται με κωδικό·
για Π.Ε./Περιφέρειες γίνεται με κανονικοποιημένο όνομα.
"""
import csv
import json
import re
import unicodedata
from pathlib import Path

import openpyxl

HERE = Path(__file__).parent


def norm(s: str) -> str:
    """Κεφαλαία χωρίς τόνους, ς→σ — για σύγκριση ονομάτων."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.replace("ς", "σ")).strip().upper()


GREEK = re.compile(r"[Α-Ωα-ωΆ-Ώά-ώ]")

# Τονωμένα ονόματα για όσες Π.Ε. δεν έχουν αντίστοιχο GeoNames ADM2 (νέες Π.Ε. του
# Καλλικράτη: τομείς Αττικής, νησιωτικές διαιρέσεις) και για τις 13 Περιφέρειες.
NAMING = {
    "regions": {
        "1": "Ανατολικής Μακεδονίας και Θράκης",
        "2": "Κεντρικής Μακεδονίας",
        "3": "Δυτικής Μακεδονίας",
        "4": "Ηπείρου",
        "5": "Θεσσαλίας",
        "6": "Ιονίων Νήσων",
        "7": "Δυτικής Ελλάδας",
        "8": "Στερεάς Ελλάδας",
        "9": "Αττικής",
        "10": "Πελοποννήσου",
        "11": "Βορείου Αιγαίου",
        "12": "Νοτίου Αιγαίου",
        "13": "Κρήτης",
    },
    "units": {
        "0901": "Π.Ε. Βορείου Τομέα Αθηνών",
        "0902": "Π.Ε. Δυτικού Τομέα Αθηνών",
        "0903": "Π.Ε. Κεντρικού Τομέα Αθηνών",
        "0904": "Π.Ε. Νοτίου Τομέα Αθηνών",
        "0905": "Π.Ε. Πειραιώς",
        "0906": "Π.Ε. Νήσων",
        "0907": "Π.Ε. Ανατολικής Αττικής",
        "0908": "Π.Ε. Δυτικής Αττικής",
        "103": "Π.Ε. Θάσου",
        "504": "Π.Ε. Σποράδων",
        "1101": "Π.Ε. Ικαρίας",
        "1102": "Π.Ε. Λέσβου",
        "1103": "Π.Ε. Λήμνου",
        "1104": "Π.Ε. Σάμου",
        "1105": "Π.Ε. Χίου",
        "1201": "Π.Ε. Άνδρου",
        "1202": "Π.Ε. Θήρας",
        "1203": "Π.Ε. Καλύμνου",
        "1204": "Π.Ε. Καρπάθου-Ηρωικής Νήσου Κάσου",
        "1205": "Π.Ε. Κέας-Κύθνου",
        "1206": "Π.Ε. Κω",
        "1207": "Π.Ε. Μήλου",
        "1208": "Π.Ε. Μυκόνου",
        "1209": "Π.Ε. Νάξου",
        "1210": "Π.Ε. Πάρου",
        "1211": "Π.Ε. Ρόδου",
        "1212": "Π.Ε. Σύρου",
        "1213": "Π.Ε. Τήνου",
    },
}


def greek_alts(row):
    return [a for a in row[3].split(",") if GREEK.search(a)]


def main():
    geo = list(csv.reader(open(HERE / "GR.txt", encoding="utf-8"), delimiter="\t"))
    adm1 = [r for r in geo if r[7] == "ADM1"]
    adm2 = [r for r in geo if r[7] == "ADM2"]
    adm3 = {r[12]: r for r in geo if r[7] == "ADM3"}

    # ---- Ιεραρχία από το επίσημο xlsx ----
    wb = openpyxl.load_workbook(HERE / "kallikratis.xlsx", read_only=True)
    ws = wb["ΚΑΛΛΙΚΡ ΚΟΙΝΟΤΗΤΕΣ "]
    regions, units, munis = {}, {}, {}
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i < 2 or not row[8]:
            continue
        rcode = str(int(row[13]))
        regions.setdefault(rcode, str(row[14]).strip())
        units.setdefault(str(row[11]), (str(row[12]).strip(), rcode))
        munis.setdefault(str(row[8]), (str(row[10]).strip(), str(row[11])))

    out = []

    # level 3 — Περιφέρειες: συντεταγμένες από το GeoNames ADM1 με ίδιο όνομα
    adm1_by_norm = {}
    for r in adm1:
        for a in greek_alts(r):
            adm1_by_norm.setdefault(norm(a), r)
        adm1_by_norm.setdefault(norm(r[1]), r)
    for code, official in sorted(regions.items(), key=lambda kv: int(kv[0])):
        short = NAMING["regions"][code]
        g = adm1_by_norm.get(norm(short)) or adm1_by_norm.get(norm(official))
        out.append({
            "code": code.zfill(2), "level": 3, "parentCode": None,
            "nameEL": f"Περιφέρεια {short}", "nameOfficial": official,
            "latitude": float(g[4]) if g else None, "longitude": float(g[5]) if g else None,
        })

    # level 4 — Π.Ε./Νομοί: όνομα από GeoNames ADM2 alt («Νομός Δράμας»), αλλιώς από τον πίνακα
    adm2_by_norm = {}
    for r in adm2:
        for a in greek_alts(r):
            adm2_by_norm.setdefault(norm(a), r)
        adm2_by_norm.setdefault(norm(r[1]), r)

    def unit_row(ucode, official):
        if ucode in NAMING["units"]:
            return NAMING["units"][ucode], None
        n = norm(official)
        g = adm2_by_norm.get(f"ΝΟΜΟΣ {n}") or adm2_by_norm.get(n)
        if g:
            name = next((a for a in greek_alts(g) if norm(a) == f"ΝΟΜΟΣ {n}"), None) or greek_alts(g)[0]
            return name, g
        return None, None

    for ucode, (official, rcode) in sorted(units.items()):
        name, g = unit_row(ucode, official)
        if name is None:  # δεν βρέθηκε πουθενά: επίσημο όνομα με πεζά (χωρίς τόνους)
            name = f"Π.Ε. {official.title()}"
        out.append({
            "code": ucode, "level": 4, "parentCode": rcode.zfill(2),
            "nameEL": name, "nameOfficial": official,
            "latitude": float(g[4]) if g else None, "longitude": float(g[5]) if g else None,
        })

    # level 5 — Δήμοι: ο κωδικός 9xxx είναι ίδιος στο GeoNames ADM3· από τα ελληνικά ονόματα
    # προτιμάμε αυτό που ξεκινά με «Δήμος» (αλλιώς το πρώτο βγάζει «Δήμος Αθήνα» αντί «Αθηναίων»)
    for mcode, (official, ucode) in sorted(munis.items()):
        g = adm3.get(mcode)
        alts = greek_alts(g) if g else []
        # προτίμηση: μορφή «Δήμος …» → τονωμένο όνομα ίδιο με το επίσημο («Αθηναίων») → πρώτο ελληνικό → επίσημο
        alt = next((a for a in alts if a.startswith("Δήμος")), None) or next((a for a in alts if norm(a) == norm(official)), None) or (alts[0] if alts else official.title())
        name = alt if alt.startswith("Δήμος") else f"Δήμος {alt}"
        out.append({
            "code": mcode, "level": 5, "parentCode": ucode,
            "nameEL": name, "nameOfficial": official,
            "latitude": float(g[4]) if g else None, "longitude": float(g[5]) if g else None,
        })

    # path «01>101>9001» για αναζητήσεις απογόνων
    by_code = {r["code"]: r for r in out}
    for r in out:
        chain, cur = [], r
        while cur:
            chain.append(cur["code"])
            cur = by_code.get(cur["parentCode"]) if cur["parentCode"] else None
        r["path"] = ">".join(reversed(chain))

    # Π.Ε. χωρίς συντεταγμένες: κέντρο των δήμων τους· μετά το ίδιο για περιφέρειες
    for lvl in (4, 3):
        for r in out:
            if r["level"] == lvl and r["latitude"] is None:
                kids = [c for c in out if c["parentCode"] == r["code"] and c["latitude"] is not None]
                if kids:
                    r["latitude"] = round(sum(c["latitude"] for c in kids) / len(kids), 6)
                    r["longitude"] = round(sum(c["longitude"] for c in kids) / len(kids), 6)

    # ---- Πόλεις/οικισμοί: GeoNames P με ελληνικό όνομα και γνωστό δήμο ----
    # Δήμοι με συντεταγμένες: το GeoNames δεν βάζει τον επίσημο κωδικό 9xxx σε μερικές μεγάλες πόλεις
    # (π.χ. Αθήνα ως PPLC, Πειραιάς)· αυτές αντιστοιχίζονται στον πλησιέστερο δήμο, έως 12 km.
    import math

    def km(a_lat, a_lng, b_lat, b_lng):
        rad = math.radians
        h = math.sin(rad(b_lat - a_lat) / 2) ** 2 + math.cos(rad(a_lat)) * math.cos(rad(b_lat)) * math.sin(rad(b_lng - a_lng) / 2) ** 2
        return 6371 * 2 * math.asin(math.sqrt(h))

    muni_points = [(r["code"], r["latitude"], r["longitude"]) for r in out if r["level"] == 5 and r["latitude"] is not None]

    def nearest_muni(lat, lng):
        best, best_d = None, 12.0
        for code, mlat, mlng in muni_points:
            d = km(lat, lng, mlat, mlng)
            if d < best_d:
                best, best_d = code, d
        return best

    cities = {}
    nearest_used = 0
    for r in geo:
        if r[6] != "P":
            continue
        mcode = r[12]
        if mcode not in munis:
            mcode = nearest_muni(float(r[4]), float(r[5])) or ""
            if mcode in munis:
                nearest_used += 1
        if mcode not in munis:
            continue
        alts = greek_alts(r)
        if not alts:
            continue
        name = alts[0]
        pop = int(r[14] or 0)
        key = (mcode, norm(name))
        if key in cities and cities[key]["population"] >= pop:
            continue
        cities[key] = {
            "id": r[0], "name": name, "nameEn": r[2] or None,
            "municipalityCode": mcode,
            "latitude": float(r[4]), "longitude": float(r[5]),
            "population": pop, "featureCode": r[7],
        }

    (HERE / "regions.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    (HERE / "cities.json").write_text(json.dumps(list(cities.values()), ensure_ascii=False), encoding="utf-8")
    lv = {l: sum(1 for r in out if r["level"] == l) for l in (3, 4, 5)}
    no_coords = sum(1 for r in out if r["latitude"] is None)
    print(f"regions.json: {lv} (χωρίς συντεταγμένες: {no_coords}) · cities.json: {len(cities)} πόλεις (από πλησιέστερο δήμο: {nearest_used})")

    # ---- Χώρες: countryInfo.txt του GeoNames (ISO alpha-2/alpha-3, αγγλικό όνομα) ----
    # Τα ελληνικά ονόματα βγαίνουν στο seed από Intl.DisplayNames (πλήρες ICU στον Node).
    EU = set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split())
    countries = []
    for line in open(HERE / "countryInfo.txt", encoding="utf-8"):
        if line.startswith("#") or not line.strip():
            continue
        c = line.rstrip("\n").split("\t")
        countries.append({"code": c[0], "iso3": c[1] or None, "nameEN": c[4], "isEu": c[0] in EU})
    (HERE / "countries.json").write_text(json.dumps(countries, ensure_ascii=False), encoding="utf-8")
    print(f"countries.json: {len(countries)} χώρες")


if __name__ == "__main__":
    main()
