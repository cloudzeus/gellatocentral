-- Το recordedAt γράφεται από το ρολόι της βάσης (όχι του app) τη στιγμή της εισαγωγής: ίδιο ρολόι με το
-- snapshot της απογραφής, αλλιώς μικρή απόκλιση ρολογιών δίνει ψευδές STOCK_CHANGED_SINCE_SNAPSHOT.
ALTER TABLE "StockMovement" ALTER COLUMN "recordedAt" SET DEFAULT clock_timestamp();
