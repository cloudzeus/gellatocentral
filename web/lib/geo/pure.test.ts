// Γεωγραφία: κανονικοποίηση ελληνικών, αντιστοίχιση ονομάτων και αποστάσεις.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBreadcrumb, coreName, haversineKm, nameMatchCandidate, nearestNode, normalizeGreek, shortRegionName, shortUnitName, walkGeoChain } from "./pure.ts";

test("normalizeGreek: τόνοι, τελικό σίγμα, κενά", () => {
  assert.equal(normalizeGreek("Δήμος Δράμας"), "ΔΗΜΟΣ ΔΡΑΜΑΣ");
  assert.equal(normalizeGreek("  Αθηναίων  "), "ΑΘΗΝΑΙΩΝ");
  assert.equal(normalizeGreek("Κως"), "ΚΩΣ");
});

test("coreName: βγάζει διοικητικά προθέματα και παρενθέσεις", () => {
  assert.equal(coreName("Δήμος Πεντέλης"), "ΠΕΝΤΕΛΗΣ");
  assert.equal(coreName("Περιφέρεια Αττικής"), "ΑΤΤΙΚΗΣ");
  assert.equal(coreName("Π.Ε. Νήσων"), "ΝΗΣΩΝ");
  assert.equal(coreName("Νομός Κυκλάδων (πρώην)"), "ΚΥΚΛΑΔΩΝ");
});

test("nameMatchCandidate: ακριβές, πτώση και περιεκτικότητα", () => {
  const nodes = [
    { code: "9176", nameEL: "Δήμος Πεντέλης", nameOfficial: "ΠΕΝΤΕΛΗΣ" },
    { code: "9001", nameEL: "Δήμος Δοξάτου", nameOfficial: "ΔΟΞΑΤΟΥ" },
    { code: "9186", nameEL: "Δήμος Αθηναίων", nameOfficial: "ΑΘΗΝΑΙΩΝ" },
  ];
  assert.equal(nameMatchCandidate("Πεντέλη", nodes), "9176"); // περιεκτικότητα
  assert.equal(nameMatchCandidate("ΔΟΞΑΤΟΥ", nodes), "9001"); // επίσημο όνομα ΑΑΔΕ
  assert.equal(nameMatchCandidate("Δοξάτο", nodes), "9001"); // κοινό πρόθεμα (πτώση)
  assert.equal(nameMatchCandidate("Αθήνα", nodes), "9186"); // περιεκτικότητα
  assert.equal(nameMatchCandidate("Δρά", nodes), null); // κάτω από το όριο μήκους
  assert.equal(nameMatchCandidate("Καβάλα", nodes), null);
});

test("haversineKm: Αθήνα–Θεσσαλονίκη περίπου 303 km", () => {
  const km = haversineKm({ lat: 37.9838, lng: 23.7275 }, { lat: 40.6401, lng: 22.9444 });
  assert.ok(km > 290 && km < 315, `ήταν ${km}`);
});

test("nearestNode: ο κοντινότερος δήμος, με όριο απόστασης", () => {
  const nodes = [
    { code: "a", latitude: 38.05, longitude: 23.86 }, // Πεντέλη
    { code: "b", latitude: 35.3, longitude: 25.3 }, // Κρήτη
    { code: "c", latitude: null, longitude: null }, // χωρίς συντεταγμένες: αγνοείται
  ];
  assert.equal(nearestNode({ lat: 38.06, lng: 23.85 }, nodes), "a");
  assert.equal(nearestNode({ lat: 0, lng: 0 }, nodes), null); // πέρα από το όριο
});

test("walkGeoChain + buildBreadcrumb: Περιφέρεια → Νομός → Δήμος", () => {
  const map = new Map([
    ["9205", { code: "9205", nameEL: "Δήμος Πειραιά", level: 5, parentCode: "0905" }],
    ["0905", { code: "0905", nameEL: "Π.Ε. Πειραιώς", level: 4, parentCode: "09" }],
    ["09", { code: "09", nameEL: "Περιφέρεια Αττικής", level: 3, parentCode: null }],
  ]);
  const bc = buildBreadcrumb(walkGeoChain("9205", map));
  assert.equal(bc.region?.code, "09");
  assert.equal(bc.unit?.code, "0905");
  assert.equal(bc.municipality?.code, "9205");
  // κόμβος εκτός χάρτη: δεν πετάει, απλώς σταματά
  assert.deepEqual(walkGeoChain("άγνωστος", map), []);
});

test("σύντομα ονόματα για πεδία-κείμενο", () => {
  assert.equal(shortRegionName("Περιφέρεια Αττικής"), "Αττικής");
  assert.equal(shortUnitName("Νομός Δράμας"), "Δράμας");
  assert.equal(shortUnitName("Δήμος Πεντέλης"), "Πεντέλης");
});
