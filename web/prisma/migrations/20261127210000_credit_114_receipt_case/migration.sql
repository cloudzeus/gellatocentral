-- 11.4 συσχετιζόμενο: σημαία επιστροφής 0x0100 χωρίς 0x0400 (στοιχεία μεταφοράς). Με 0x0400 η Viva το στέλνει ως
-- «11.4 δελτίο αποστολής» και η ΑΑΔΕ το απορρίπτει (MovePurpose / OtherDeliveryNoteHeader). 4752_2000_0100_0001.
UPDATE "DocumentType" SET "receiptCase" = '5139205309172023297' WHERE code = '11.4' AND "receiptCase" = '5139205309239132161';
