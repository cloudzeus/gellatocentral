-- Η σύσταση κρέμεται σε ακριβώς έναν γονέα: είδος καταλόγου (κεντρικό) ή γενικό είδος (tenant)
ALTER TABLE "Composition" ADD CONSTRAINT "composition_one_parent"
  CHECK ((("tradeItemId" IS NOT NULL)::int + ("genericItemId" IS NOT NULL)::int) = 1);

-- Στον κεντρικό κατάλογο (TradeItem) το orgId είναι πάντα κενό, σε γενικό είδος πάντα του tenant
ALTER TABLE "Composition" ADD CONSTRAINT "composition_owner_matches"
  CHECK ((("tradeItemId" IS NOT NULL) AND ("orgId" IS NULL)) OR (("genericItemId" IS NOT NULL) AND ("orgId" IS NOT NULL)));
