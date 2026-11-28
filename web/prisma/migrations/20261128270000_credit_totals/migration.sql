-- Τα πιστωτικά 11.4 γράφονταν χωρίς σύνολο: το παίρνουμε από το αίτημα προς τη Viva (λεπτά, αρνητικό)
UPDATE "FiscalDocument" SET "totalCents" = ("request"->>'cbReceiptAmount')::int
WHERE "docType" = '11.4' AND "totalCents" IS NULL AND jsonb_typeof("request"->'cbReceiptAmount') = 'number';
