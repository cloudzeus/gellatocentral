import assert from "node:assert/strict";
import { test } from "node:test";
import { mapAfmInfo } from "./afm-info.ts";

const basic = { afm: "094019245 ", onomasia: " ΔΟΚΙΜΗ ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ ", commer_title: "  ", doy: "1159", doy_descr: "ΦΑΕ ΑΘΗΝΩΝ", legal_status_descr: "ΑΕ", postal_address: "ΚΗΦΙΣΙΑΣ", postal_address_no: "99", postal_zip_code: "15124", postal_area_description: "ΜΑΡΟΥΣΙ", deactivation_flag: "1", deactivation_flag_descr: "ΕΝΕΡΓΟΣ ΑΦΜ", stop_date: "" };

test("αντιστοίχιση πεδίων και καθάρισμα κενών", () => {
  const r = mapAfmInfo({ basic_rec: basic, firm_act_tab: { item: [{ firm_act_descr: "ΔΕΥΤΕΡΕΥΟΥΣΑ", firm_act_kind: "2" }, { firm_act_descr: "ΠΑΡΑΓΩΓΗ ΠΑΓΩΤΩΝ", firm_act_kind: "1" }] } });
  assert.deepEqual(r, { afm: "094019245", name: "ΔΟΚΙΜΗ ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ", tradeName: null, taxOffice: "ΦΑΕ ΑΘΗΝΩΝ", taxOfficeCode: "1159", legalForm: "ΑΕ", address: "ΚΗΦΙΣΙΑΣ 99", postalCode: "15124", city: "ΜΑΡΟΥΣΙ", profession: "ΠΑΡΑΓΩΓΗ ΠΑΓΩΤΩΝ", status: "ΕΝΕΡΓΟΣ ΑΦΜ", active: true });
});
test("δραστηριότητα ως ένα αντικείμενο ή καθόλου", () => {
  assert.equal(mapAfmInfo({ basic_rec: basic, firm_act_tab: { item: { firm_act_descr: "ΜΟΝΗ", firm_act_kind: "2" } } })?.profession, "ΜΟΝΗ");
  assert.equal(mapAfmInfo({ basic_rec: basic })?.profession, null);
});
test("με ημερομηνία διακοπής δεν είναι ενεργή", () => assert.equal(mapAfmInfo({ basic_rec: { ...basic, stop_date: "2024-05-31" } })?.active, false));
test("ΑΦΜ που δεν υπάρχει στο μητρώο → null", () => {
  assert.equal(mapAfmInfo({ basic_rec: { afm: "" } }), null);
  assert.equal(mapAfmInfo(null), null);
});
