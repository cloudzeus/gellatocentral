// Επεξηγήσιμη συσχέτιση κεντρικών ειδών με το υπάρχον δέντρο ζαχαροπλαστικής/παγωτού.
// Δεν καλεί AI και δεν γράφει στη βάση: ο διαχειριστής εγκρίνει κάθε εφαρμογή.

export type CategoryMatchCategory = { id: string; parentId: string | null; name: string; active?: boolean };
export type CategoryMatchItem = { id: string; name: string; brandName?: string | null; ingredientsText?: string | null };
export type CatalogCategoryMatch = { itemId: string; categoryId: string; categoryPath: string; score: number; evidence: string };

// Οι φράσεις αντιστοιχούν στα ονόματα των leaves, όχι σε hardcoded ids· έτσι αντέχουν σε νέα βάση/restore.
const ALIASES: Record<string, string[]> = {
  "Τύπος 00 & χαμηλής πρωτεΐνης": ["αλευρι 00", "αλευρι τυπου 00", "farina 00", "flour 00", "cake flour", "μαλακο αλευρι"],
  "Δυνατά & υψηλής πρωτεΐνης": ["δυνατο αλευρι", "αλευρι υψηλης πρωτεινης", "strong flour", "bread flour", "manitoba flour"],
  "Ολικής αλέσεως": ["ολικης αλεσεως", "αλευρι ολικης", "wholemeal flour", "whole wheat flour", "wholegrain flour"],
  "Ρυζιού & καλαμποκιού": ["αλευρι ρυζιου", "rice flour", "αλευρι καλαμποκιου", "corn flour", "maize flour"],
  "Οσπρίων": ["αλευρι ρεβιθιου", "chickpea flour", "gram flour", "αλευρι φακης", "lentil flour", "αλευρι φασολιου"],
  "Μείγματα χωρίς γλουτένη": ["μειγμα χωρις γλουτενη", "αλευρι χωρις γλουτενη", "gluten free flour", "gluten free baking mix"],
  "Αραβοσίτου": ["αμυλο αραβοσιτου", "corn starch", "cornstarch", "μαζενα"],
  "Πατάτας": ["αμυλο πατατας", "potato starch", "αλευρι πατατας", "potato flour"],
  "Ταπιόκα & arrowroot": ["ταπιοκα", "tapioca", "arrowroot", "αρουρουτ"],
  "Βρώμη & πίτουρα": ["νιφαδες βρωμης", "βρωμη", "oat flakes", "rolled oats", "oat bran", "πιτουρο", "bran"],
  "Σιμιγδάλι & πλιγούρι": ["σιμιγδαλι", "semolina", "πλιγουρι", "bulgur", "couscous"],
  "Τραγανά δημητριακά": ["corn flakes", "cornflakes", "τραγανα δημητριακα", "puffed rice", "rice krispies", "cereal crispies"],

  "Κρυσταλλική & άχνη": ["κρυσταλλικη ζαχαρη", "ζαχαρη αχνη", "αχνη ζαχαρη", "caster sugar", "granulated sugar", "white sugar", "λευκη ζαχαρη", "ζαχαρη"],
  "Καστανή & muscovado": ["καστανη ζαχαρη", "brown sugar", "muscovado", "demerara", "μαυρη ζαχαρη"],
  "Ζάχαρη πούδρα": ["ζαχαρη πουδρα", "πουδρα ζαχαρη", "icing sugar", "powdered sugar", "confectioners sugar"],
  "Γλυκόζη & αποψυγμένη γλυκόζη": ["γλυκοζη", "glucose syrup", "liquid glucose", "dried glucose", "αποψυγμενη γλυκοζη"],
  "Ινβερτέ & τριμελίνη": ["ινβερτε", "invert sugar", "inverted sugar", "τριμελινη", "trimoline"],
  "Μέλι": ["μελι", "honey"],
  "Δεξτρόζη & μαλτοδεξτρίνη": ["δεξτροζη", "dextrose", "μαλτοδεξτρινη", "maltodextrin"],
  "Ισομαλτ": ["ισομαλτ", "isomalt"],
  "Σορβιτόλη & πολυόλες": ["σορβιτολη", "sorbitol", "ξυλιτολη", "xylitol", "ερυθριτολη", "erythritol", "μαλτιτολη", "maltitol", "πολυολες"],
  "Ινουλίνη & φυτικές ίνες": ["ινουλινη", "inulin", "φυτικες ινες", "vegetable fibre", "plant fiber"],
  "Σφένδαμος & αγαύη": ["σιροπι αγαυης", "agave syrup", "maple syrup", "σιροπι σφενδαμου", "αγαυη"],
  "Ζάχαρη καρύδας": ["ζαχαρη καρυδας", "coconut sugar"],
  "Στέβια & μείγματα": ["στεβια", "stevia", "steviol"],

  "Μαύρη": ["μαυρη κουβερτουρα", "κουβερτουρα μαυρη", "dark couverture", "dark chocolate couverture"],
  "Γάλακτος": ["κουβερτουρα γάλακτος", "κουβερτουρα γάλακτος", "milk couverture", "milk chocolate couverture"],
  "Λευκή & blonde": ["λευκη κουβερτουρα", "κουβερτουρα λευκη", "white couverture", "blonde chocolate", "blonde couverture"],
  "Ruby & φρουτένιες": ["ruby chocolate", "ruby couverture", "κουβερτουρα ruby", "φρουτενια κουβερτουρα", "fruit couverture"],
  "Σκόνη κακάο": ["σκονη κακαο", "κακαο σε σκονη", "cocoa powder", "cacao powder", "cacao en poudre"],
  "Μάζα & liquor κακάο": ["μαζα κακαο", "cocoa mass", "cacao mass", "cocoa liquor", "cacao liquor"],
  "Βούτυρο κακάο": ["βουτυρο κακαο", "cocoa butter", "cacao butter"],
  "Nibs & croquant κακάο": ["cocoa nibs", "cacao nibs", "nibs κακαο", "croquant κακαο"],
  "Drops, chunks & sticks": ["chocolate chips", "choc chips", "chocolate drops", "chocolate chunks", "chocolate sticks", "σταγονες σοκολατας", "drops σοκολατας", "chunks σοκολατας", "sticks σοκολατας"],
  "Compound coatings": ["compound chocolate", "compound coating", "επικαλυψη compound", "υποκαταστατο κουβερτουρας"],
  "Έτοιμες γκανάζ": ["γκαναζ", "ganache"],
  "Curls, rolls & σοκολατένια φύλλα": ["chocolate curls", "chocolate rolls", "chocolate shavings", "σοκολατενια φύλλα", "φύλλα σοκολατας", "curls σοκολατας"],
  "Φορμάκια & τρισδιάστατα decor": ["chocolate moulds", "chocolate molds", "φορμακια σοκολατας", "τρισδιαστατα decor"],
  "Transfer sheets": ["transfer sheets", "transfer sheet", "φύλλα μεταφορας σοκολατας"],

  "Φρέσκα & UHT γάλατα": ["φρεσκο γάλα", "γάλα φρεσκο", "uht γάλα", "γάλα uht", "fresh milk", "whole milk", "semi skimmed milk", "skimmed milk", "γάλα πληρες", "γάλα αποβουτυρωμενο", "γάλα"],
  "Κρέμες γάλακτος": ["κρεμα γάλακτος", "κρεμα γάλακτος", "heavy cream", "whipping cream", "double cream", "single cream", "παχια κρεμα γάλακτος"],
  "Εβαπορέ & συμπυκνωμένα": ["εβαπορε", "evaporated milk", "condensed milk", "συμπυκνωμενο γάλα", "γάλα ζαχαρουχο"],
  "Βούτυρο γάλακτος": ["βουτυρο γάλακτος", "αγελαδινο βουτυρο", "fresh butter", "dairy butter", "unsalted butter", "salted butter", "butter"],
  "Αφυδατωμένο & clarified": ["αφυδατωμενο βουτυρο", "clarified butter", "ghee", "βουτυρο ghee"],
  "Βούτυρα ζαχαροπλαστικής & φύλλωσης": ["βουτυρο φύλλωσης", "βουτυρο ζαχαροπλαστικης", "laminating butter", "pastry butter", "butter sheet"],
  "Μασκαρπόνε & κρέμα τυρί": ["μασκαρπονε", "mascarpone", "κρεμα τυρι", "cream cheese", "τυρι κρεμα"],
  "Ricotta & φρέσκα τυριά": ["ricotta", "ρικοτα", "μυζηθρα", "ανθοτυρο", "φρεσκο τυρι"],
  "Γιαούρτια & crème fraîche": ["γιαουρτι", "yogurt", "yoghurt", "creme fraiche", "ξινη κρεμα"],
  "Πλήρες & αποβουτυρωμένο γάλα": ["γάλα σε σκονη", "σκονη γάλακτος", "milk powder", "powdered milk", "whole milk powder", "skimmed milk powder"],
  "Ορός γάλακτος & πρωτεΐνες": ["ορος γάλακτος σε σκονη", "whey powder", "milk protein", "πρωτεινη γάλακτος"],
  "Φρέσκα αυγά": ["φρεσκα αυγά", "αυγά κοτας", "fresh eggs", "shell eggs", "αυγά"],
  "Παστεριωμένα αυγά & κρόκοι": ["παστεριωμενα αυγά", "παστεριωμενος κροκος", "κροκοι αυγου", "pasteurized eggs", "pasteurised eggs", "egg yolk"],
  "Ασπράδια & αλβουμίνη": ["ασπραδια αυγου", "egg whites", "albumin", "αλβουμινη", "meringue powder"],

  "Μαργαρίνες ζαχαροπλαστικής": ["μαργαρινη ζαχαροπλαστικης", "pastry margarine", "μαργαρινη", "margarine"],
  "Shortening": ["shortening", "φυτικο λιπος", "vegetable shortening"],
  "Φυτικά βούτυρα φύλλωσης": ["φυτικο βουτυρο φύλλωσης", "vegan laminating butter", "μαργαρινη φύλλωσης"],
  "Καρύδα & φοινικέλαιο": ["λάδι καρυδας", "ελαιο καρυδας", "coconut oil", "φοινικελαιο", "palm oil"],
  "Ηλιέλαιο & ελαιόλαδο": ["ηλιελαιο", "sunflower oil", "ελαιολαδο", "olive oil", "αραιωμενο ελαιολαδο"],
  "Λειτουργικά έλαια & MCT": ["mct oil", "ελαιο mct", "λειτουργικο ελαιο", "functional oil"],
  "Ροφήματα ξηρών καρπών & οσπρίων": ["ροφημα αμυγδαλου", "almond drink", "almond milk", "ροφημα σογιας", "soy drink", "soya milk", "ροφημα βρωμης", "oat drink", "oat milk", "ροφημα καρυδας", "coconut drink", "coconut milk"],
  "Κρέμες & whippable toppings": ["φυτικη κρεμα", "vegan cream", "whippable topping", "whipping topping", "σαντιγι φυτικη", "vegetable cream"],
  "Φυτικές εναλλακτικές αυγού": ["υποκαταστατο αυγου", "egg replacer", "vegan egg", "φυτικο αυγο"],

  "Ολόκληρα & κομμάτια": ["φρεσκα φρουτα", "φρουτα σε κομματια", "φραουλες", "strawberries", "βατομουρα", "raspberries", "βατόμουρα", "μύρτιλλα", "blueberries", "κερασια", "cherries", "μπανανες", "bananas", "μήλα", "apples", "αχλάδια", "pears", "ροδάκινα", "peaches", "βερίκοκα", "apricots"],
  "Φρούτα IQF": ["iqf", "φρουτα iqf", "iqf strawberries", "iqf berries"],
  "Πολτοί αψηφίσιμοι": ["πολτος φρουτων", "πουρες φρουτων", "fruit puree", "fruit pulp", "πολτος φραουλας", "πολτος μπανανας"],
  "Κατεψυγμένοι πολτοί": ["κατεψυγμενος πολτος", "frozen fruit puree", "frozen puree", "παγωμενος πουρες"],
  "Συμπυκνώματα & χυμοί": ["χυμος φρουτων", "fruit juice", "orange juice", "lemon juice", "χυμος πορτοκαλιου", "χυμος λεμονιου", "fruit concentrate", "συμπυκνωμα φρουτων"],
  "Αποξηραμένα φρούτα": ["αποξηραμενα φρουτα", "dried fruit", "σταφιδες", "raisins", "sultanas", "ξερα βερικοκα", "dried apricots", "αποξηραμενα κερασια", "dried cranberries", "cranberries"],
  "Λυοφιλιοποιημένα ολόκληρα & κομμάτια": ["λυοφιλιοποιημενα φρουτα", "freeze dried fruit", "freeze dried strawberries", "λυοφιλιοποιημενες φραουλες"],
  "Σκόνες φρούτων": ["σκονη φρουτων", "fruit powder", "strawberry powder", "raspberry powder", "σκονη φραουλας", "σκονη βατομουρου"],
  "Κονφί & compotes": ["κονφι", "confiture", "compote", "κομποστα φρουτων"],
  "Μαρμελάδες & ζελέ φρούτων": ["μαρμελαδα", "marmalade", "fruit jam", "ζελε φρουτων", "fruit jelly"],
  "Γεμίσεις ανθεκτικές στο ψήσιμο": ["γεμιση ψησιματος", "bake stable filling", "bakestable", "oven stable filling"],
  "Γλυκά φρούτων & γλυκασμένα φρούτα": ["γλυκο κουταλιου", "γλυκασμενα φρουτα", "candied fruit", "glace fruit", "φρουτα γλασε"],
  "Φλούδες & ζέστες": ["ξεσμα λεμονιου", "φλουδα λεμονιου", "lemon zest", "orange zest", "ξεσμα πορτοκαλιου", "citrus zest"],
  "Κατεψυγμένα & γλυκασμένα ζέστες": ["κατεψυγμενη φλουδα", "frozen zest", "γλυκασμενη φλουδα", "candied peel", "candied zest"],

  "Αμύγδαλα & φουντούκια": ["αμυγδαλα", "almonds", "φουντούκια", "hazelnuts", "φιλέ αμυγδαλου", "almond flakes"],
  "Φιστίκια & κάσιους": ["φιστικια αιγινης", "pistachios", "κασιους", "cashews", "cashew nuts"],
  "Καρύδια, pecan & macadamia": ["καρυδια", "walnuts", "pecan", "πεκαν", "macadamia", "μακαδάμια"],
  "Αράπικα φιστίκια": ["αραπικα φιστικια", "peanuts", "φιστικια αραπικα"],
  "Πάστες 100%": ["παστα αμυγδαλου", "παστα φουντουκιου", "παστα φιστικιου", "almond paste 100", "hazelnut paste", "pistachio paste", "peanut butter", "φιστικοβουτυρο", "almond butter", "cashew butter", "nut paste"],
  "Αλεύρια & νιφάδες καρπών": ["αλευρι αμυγδαλου", "almond flour", "almond meal", "αλευρι φουντουκιου", "hazelnut flour", "νιφαδες αμυγδαλου"],
  "Μαζίπαν & πάστες αμυγδάλου": ["μαζιπαν", "marzipan", "παστα αμυγδαλου ζαχαρη", "almond marzipan"],
  "Πραλίνε φουντουκιού & αμυγδάλου": ["πραλινε φουντουκιου", "πραλινε αμυγδαλου", "hazelnut praline", "almond praline"],
  "Πραλίνε φιστικιού & άλλων καρπών": ["πραλινε φιστικιου", "pistachio praline", "πραλινε καρπων", "nut praline"],
  "Καραμελωμένοι & τραγανοί καρποί": ["καραμελωμενα αμυγδαλα", "καραμελωμενα φουντούκια", "caramelized nuts", "caramelised nuts", "candied nuts", "τραγανοι καρποι"],
  "Σησάμι, ηλιόσποροι & κολοκυθόσποροι": ["σησαμι", "sesame", "ηλιοσποροι", "sunflower seeds", "κολοκυθοσποροι", "pumpkin seeds", "ταχινι", "tahini"],
  "Chia, λινάρι & παπαρούνα": ["chia", "τσια", "λιναρι", "linseed", "flaxseed", "παπαρουνα", "poppy seeds"],
  "Ινδικό καρύδιο & νιφάδες καρύδας": ["ινδικο καρυδιο", "coconut flakes", "desiccated coconut", "coconut chips", "νιφαδες καρυδας", "τριμμενη καρυδα"],

  "Ζελατίνη ζωική & ψαριού": ["ζελατινη", "gelatin", "gelatine", "fish gelatin", "beef gelatin", "pork gelatin"],
  "Agar-agar & καραγενάνες": ["agar agar", "αγκαρ αγκαρ", "carrageenan", "καραγενανη"],
  "Πηκτίνες": ["πηκτινη", "pectin", "nh pectin", "yellow pectin"],
  "Gellan & φυτικά gel": ["gellan", "τζελαν", "φυτικο gel", "vegetable gel"],
  "Ξανθάνη & guar": ["ξανθανη", "xanthan", "guar gum", "γκουαρ", "guar"],
  "Κόμμι χαρουπιού & CMC": ["κομμι χαρουπιου", "locust bean gum", "carob gum", "cmc", "carboxymethylcellulose"],
  "Σταθεροποιητικά παγωτού & κρεμών": ["σταθεροποιητης παγωτου", "σταθεροποιητικο παγωτου", "ice cream stabilizer", "ice cream stabiliser", "gelato stabilizer", "stabiliser for ice cream", "stabilizer for ice cream"],
  "Λεκιθίνες": ["λεκιθινη", "lecithin", "soy lecithin", "sunflower lecithin"],
  "Μονο- & διγλυκερίδια": ["μονογλυκεριδια", "διγλυκεριδια", "mono and diglycerides", "mono diglycerides", "e471"],
  "Φυτικά γαλακτωματοποιητικά": ["φυτικος γαλακτωματοποιητης", "vegetable emulsifier", "plant emulsifier"],
  "Πρωτεΐνες αερασμού": ["πρωτεινη αερασμου", "whipping protein", "aerating protein"],
  "Μεθυλοκυτταρίνη & αφροί": ["μεθυλοκυτταρινη", "methylcellulose", "food foam", "αφρος ζαχαροπλαστικης"],
  "Crispies & wet-proof υφές": ["wet proof", "crispies", "crunchy pearls", "τραγανες περλες"],

  "Baking powder": ["baking powder", "μπεικιν πουδερ", "μπεικιν πάουντερ"],
  "Σόδα & αμμωνία": ["baking soda", "bicarbonate of soda", "sodium bicarbonate", "μαγειρικη σοδα", "σοδα", "αμμωνια", "ammonium bicarbonate"],
  "Κρέμα ταρτάρης & όξινα άλατα": ["κρεμα ταρταρης", "cream of tartar", "tartaric acid", "τρυγικο οξυ"],
  "Νωπή & ξηρή μαγιά": ["νωπη μαγια", "ξηρη μαγια", "fresh yeast", "dry yeast", "instant yeast", "μαγια"],
  "Προζύμια & εκκινητές": ["προζυμι", "sourdough starter", "sourdough culture", "εκκινητης"],
  "Βελτιωτικά ζύμης & κέικ": ["βελτιωτικο ζυμης", "βελτιωτικο κεικ", "dough improver", "bread improver", "cake improver"],
  "Ένζυμα & μαλακτικά": ["ενζυμα αρτοποιιας", "baking enzymes", "dough softener", "μαλακτικο ζυμης"],
  "Κιτρικό, τρυγικό & ασκορβικό οξύ": ["κιτρικο οξυ", "citric acid", "ασκορβικο οξυ", "ascorbic acid", "tartaric acid"],
  "Συντηρητικά τροφίμων": ["συντηρητικο τροφιμων", "food preservative", "potassium sorbate", "σορβικο καλιο"],

  "Λοβοί & σπόροι": ["λοβοι βανιλιας", "vanilla beans", "vanilla pods", "vanilla seeds", "σποροι βανιλιας"],
  "Εκχυλίσματα & πάστες": ["εκχυλισμα βανιλιας", "vanilla extract", "vanilla paste", "παστα βανιλιας"],
  "Σκόνη & φυσικά αρώματα βανίλιας": ["βανιλια σε σκονη", "vanilla powder", "vanillin", "βανιλινη", "αρωμα βανιλιας"],
  "Φυσικά αρώματα φρούτων & καρπών": ["αρωμα φρουτων", "fruit flavouring", "fruit flavoring", "φυσικο αρωμα φρουτων", "αρωμα ξηρων καρπων"],
  "Καφές, κακάο & καραμέλα": ["αρωμα καφε", "coffee flavour", "coffee flavor", "αρωμα κακαο", "cocoa flavour", "αρωμα καραμελας", "caramel flavour", "caramel flavor"],
  "Λουλούδια & βοτανικά εκχυλίσματα": ["ανθο νερο", "orange blossom water", "rose water", "ροδονερο", "lavender extract", "εκχυλισμα λουλουδιων"],
  "Αιθέρια έλαια τροφίμων": ["αιθεριο ελαιο τροφιμων", "food grade essential oil", "essential oil food", "food essential oil"],
  "Κανέλα, γαρίφαλο & μοσχοκάρυδο": ["κανελα", "cinnamon", "γαριφαλο", "cloves", "μοσχοκαρυδο", "nutmeg"],
  "Κάρδαμο, τζίντζερ & πιπέρια": ["καρδαμο", "cardamom", "τζιντζερ", "ginger", "πιπερι", "pepper"],
  "Φρέσκα & αποξηραμένα βότανα": ["αποξηραμενα βοτανα", "dried herbs", "φρεσκα βοτανα", "fresh herbs", "δυοσμος", "mint leaves", "mint"],
  "Αλάτι & αρωματικά άλατα": ["αλατι", "sea salt", "fleur de sel", "αλας", "salt flakes", "αλατι καπνιστο"],
  "Τσάι, matcha & βοτανικά": ["matcha", "ματσα", "τσαι", "tea leaves", "tea powder"],
  "Καφές & στιγμιαία εκχυλίσματα": ["στιγμιαιος καφες", "instant coffee", "espresso powder", "coffee extract", "εκχυλισμα καφε", "καφες"],
  "Υδατοδιαλυτά & λιποδιαλυτά": ["υδατοδιαλυτο χρωμα", "λιποδιαλυτο χρωμα", "water soluble food colour", "oil soluble food colour"],
  "Σκόνες & φυσικά χρώματα": ["χρωμα τροφιμων σε σκονη", "food colour powder", "food coloring powder", "φυσικο χρωμα τροφιμων"],
  "Gel, πάστες & μεταλλικά χρώματα": ["χρωμα τροφιμων gel", "food colour gel", "food coloring gel", "παστα χρωματος", "μεταλλικο χρωμα τροφιμων", "gold food colour"],

  "Έτοιμες κρέμες ζαχαροπλαστικής": ["ετοιμη κρεμα ζαχαροπλαστικης", "pastry cream", "custard cream", "κρεμα ζαχαροπλαστικης", "custard powder"],
  "Κρέμες σοκολάτας & καρπών": ["κρεμα σοκολατας", "chocolate spread", "hazelnut spread", "κρεμα φουντουκιου", "nut spread", "chocolate filling"],
  "Καραμέλες & dulce de leche": ["dulce de leche", "κρεμα καραμελας", "caramel filling", "caramel spread", "καραμελα"],
  "Mirror glazes": ["mirror glaze", "γυαλιστερο γλασο", "γλασο καθρεπτης"],
  "Nappage φρούτων": ["nappage", "γλασο φρουτων", "fruit glaze"],
  "Σοκολατένιες επικαλύψεις": ["επικαλυψη σοκολατας", "chocolate glaze", "chocolate coating", "chocolate couverture glaze"],
  "Fondant & ζαχαρόπαστες": ["fondant", "ζαχαροπαστα", "sugar paste", "sugarpaste"],
  "Ζαχαρόπαστα μοντελισμού & gum paste": ["gum paste", "gumpaste", "modelling paste", "modeling paste", "ζαχαροπαστα μοντελισμου", "flower paste"],
  "Royal icing & παγωτίνια": ["royal icing", "παγωτινια", "βασιλικο γλασο", "egg white icing"],
  "Σιρόπια εμποτισμού": ["σιροπι εμποτισμου", "soaking syrup", "cake syrup", "σιροπι για παντεσπανι"],
  "Σάλτσες σοκολάτας & καραμέλας": ["σαλτσα σοκολατας", "chocolate sauce", "σαλτσα καραμελας", "caramel sauce"],
  "Coulis & φρουτένιες σάλτσες": ["coulis", "σαλτσα φρουτων", "fruit sauce", "berry sauce"],

  "Παντεσπάνι, κέικ & muffins": ["μειγμα για κεικ", "cake mix", "muffin mix", "sponge cake mix", "παντεσπανι", "brownie cake mix"],
  "Cookies, brownies & μπισκότα": ["cookie mix", "brownie mix", "μειγμα μπισκοτων", "μειγμα cookies", "μειγμα brownies"],
  "Βάφλες, κρέπες & pancakes": ["pancake mix", "waffle mix", "crepe mix", "μειγμα βαφλας", "μειγμα κρεπας", "μειγμα pancake"],
  "Κρέμες, μους & bavarois": ["mousse mix", "bavarois mix", "μειγμα μους", "μειγμα bavarois", "κρεμα επιδορπιου"],
  "Μαρέγκες & macarons": ["macaron mix", "μειγμα macaron", "μειγμα μαρεγκας", "meringue mix", "μαρέγκες", "macarons"],
  "Παγωτό, sorbet & παγωτίνια": ["βαση παγωτου", "μειγμα παγωτου", "ice cream mix", "gelato base", "gelato mix", "παγωτο", "ice cream", "sorbet", "σορμπέ", "παγωτινι", "frozen yogurt", "soft serve mix"],
  "Σφολιάτα & brisée": ["σφολιατα", "puff pastry", "pate brisee", "brisee", "φύλλο σφολιατας"],
  "Σάμπλε, τάρτες & tartelettes": ["sable", "σαμπλε", "tart shells", "tartelettes", "βαση τάρτας", "tart base"],
  "Πάστες choux & ημιτελή": ["choux pastry", "pate a choux", "ζυμη choux", "choux mix", "μειγμα choux"],

  "Feuilletine, crumble & croquant": ["feuilletine", "φετιν", "crumble", "croquant", "κρουμπλε", "κροκαν"],
  "Praliné crispies & τραγανά δημητριακά": ["praline crispies", "πραλινε crispies", "chocolate crispies", "cereal pearls", "περλες δημητριακων"],
  "Ψημένα & καραμελωμένα κομμάτια": ["caramelized pieces", "caramelised pieces", "toasted pieces", "ψημενα κομματια", "καραμελωμενα κομματια"],
  "Sprinkles, πέρλες & confetti": ["sprinkles", "confetti", "περλες ζαχαρης", "διακοσμητικα περλες", "τρούφα διακοσμησης"],
  "Ζαχαρένια λουλούδια & φιγούρες": ["sugar flowers", "sugar figures", "ζαχαρενια λουλουδια", "ζαχαρενιες φιγουρες"],
  "Ισομαλτ & κρυστάλλινα decor": ["isomalt decor", "κρυσταλλινα decor", "κρυσταλλινα διακοσμητικα", "sugar crystals decor"],
  "Βρώσιμα & κρυσταλλωμένα λουλούδια": ["βρωσιμα λουλουδια", "edible flowers", "crystallised flowers", "crystallized flowers"],
  "Φύλλα χρυσού & αργύρου": ["φύλλα χρυσου", "φύλλα αργυρου", "gold leaf", "silver leaf", "edible gold", "edible silver"],
  "Εκτυπώσιμα & βρώσιμα φύλλα": ["βρωσιμα φύλλα", "edible sheets", "wafer paper", "icing sheets", "εκτυπωσιμα φύλλα"],
};

// Αθλητικά συμπληρώματα, pet food και έτοιμα μη ζαχαροπλαστικά είδη αποκλείονται πριν από οποιοδήποτε score.
const EXCLUDED_NAME = [
  "whey protein", "pure whey", "iso whey", "whey zero", "whey isolate", "whey concentrate",
  "creatine", "bcaa", "pre workout", "protein bar", "protein supplement", "mass gainer",
  "fish fingers", "pizza", "wasabi", "dog food", "cat food", "pet food",
];
const EXCLUSIONS: Record<string, string[]> = {
  "Φρέσκα & UHT γάλατα": ["σκονη", "powder", "εβαπορε", "evaporated", "condensed", "καρυδας", "coconut", "αμυγδαλου", "almond", "βρωμης", "oat", "σογιας", "soy", "soya", "chocolate", "biscuit"],
  "Κρέμες γάλακτος": ["oreo", "biscuit", "cookie", "ice cream", "μπασκετ", "σαντουιτς"],
  "Βούτυρο γάλακτος": ["φιστικοβουτυρο", "peanut butter", "almond butter", "cashew butter", "βουτυρο κακαο", "cocoa butter", "cacao butter", "biscuit", "cookie", "μπουκιτ"],
  "Κρυσταλλική & άχνη": ["sugar free", "χωρις ζαχαρη", "no added sugar", "without sugar"],
  "Μέλι": ["ice tea", "iced tea", "tea", "bar", "cereal", "biscuit", "cookie", "μπαρα", "μπισκοτ"],
  "Γιαούρτια & crème fraîche": ["bar", "cereal", "biscuit", "cookie", "μπαρα", "μπισκοτ"],
  "Ηλιέλαιο & ελαιόλαδο": ["tuna", "fish", "sardine", "anchovy", "σαρδελ", "τονος", "τονου"],
  "Αλάτι & αρωματικά άλατα": ["corn cakes", "rice cakes", "chips", "crisps", "cracker", "snack", "nuts", "φιστικι"],
  "Κάρδαμο, τζίντζερ & πιπέρια": ["beer", "ale", "soda", "soft drink", "tea", "biscuit", "cookie"],
  "Αμύγδαλα & φουντούκια": ["αλευρι", "flour", "παστα", "paste", "πραλινε", "praline", "butter", "drink", "milk", "bar", "cereal"],
  "Φιστίκια & κάσιους": ["παστα", "paste", "πραλινε", "praline", "butter", "bar", "cereal"],
  "Αράπικα φιστίκια": ["butter", "παστα", "paste", "bar", "cereal"],
  "Σησάμι, ηλιόσποροι & κολοκυθόσποροι": ["snack", "pasteli", "παστελι", "bar", "cereal"],
  "Ολόκληρα & κομμάτια": ["juice", "jam", "drink", "bar", "cereal", "yogurt", "yoghurt"],
  "Καφές & στιγμιαία εκχυλίσματα": ["αρωμα", "flavour", "flavor", "chocolate", "candy"],
};

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ς/g, "σ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function contains(text: string, phrase: string): boolean { return ` ${text} `.includes(` ${phrase} `); }

type PreparedRule = { phrase: string; originalPhrase: string; specificity: number };
type PreparedCategory = { id: string; path: string; raw: boolean; excluded: string[]; rules: PreparedRule[] };
const EXCLUDED_NORMALIZED = EXCLUDED_NAME.map(normalize);
const READY_FOOD_CONTEXT = [
  "biscuit", "biscuits", "cookie", "cookies", "cracker", "crackers", "chips", "crisps", "snack", "bar", "bars",
  "noodle", "mustard", "breadsticks", "power bowl", "balls", "bites", "candy", "candies", "wafers", "croissant",
  "soft drink", "beer", "halls", "lays", "lay s", "ruffles", "raffles", "nature valley", "barkleys", "dirhams",
  "πατατακια", "πατατακι", "κρακερς", "μπισκοτα", "μπισκοτο", "βαλσαμικο", "balsamic vinegar",
].map(normalize);
const RAW_ROOTS = ["Αλεύρια", "Ζάχαρη", "Κακάο", "Γαλακτοκομικά", "Φυτικά λίπη", "Φρούτα", "Ξηροί καρποί", "Πηκτικά", "Διογκωτικά", "Αρώματα"];

/** Οι φράσεις και τα μονοπάτια υπολογίζονται μία φορά για ολόκληρο τον κατάλογο, όχι ανά είδος. */
function prepareCategories(categories: CategoryMatchCategory[]): PreparedCategory[] {
  const active = categories.filter((category) => category.active !== false);
  const byId = new Map(active.map((category) => [category.id, category]));
  const hasChild = new Set(active.flatMap((category) => category.parentId ? [category.parentId] : []));
  return active.filter((category) => !hasChild.has(category.id)).map((category) => {
    const path: string[] = [];
    const visited = new Set<string>();
    let current: CategoryMatchCategory | undefined = category;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      path.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    const rules = (ALIASES[category.name] ?? [category.name]).flatMap((originalPhrase) => {
      const phrase = normalize(originalPhrase);
      if (!phrase) return [];
      const specificity = phrase.split(" ").length * 4 + Math.min(12, Math.floor(phrase.length / 4));
      return [{ phrase, originalPhrase, specificity }];
    });
    return { id: category.id, path: path.join(" → "), raw: RAW_ROOTS.some((root) => path[0]?.startsWith(root)), excluded: (EXCLUSIONS[category.name] ?? []).map(normalize), rules };
  });
}

function matchPrepared(item: CategoryMatchItem, categories: PreparedCategory[]): CatalogCategoryMatch | null {
  const name = normalize(item.name);
  if (!name || EXCLUDED_NORMALIZED.some((phrase) => contains(name, phrase))) return null;
  const context = normalize(`${item.name} ${item.brandName ?? ""}`);
  const readyFood = READY_FOOD_CONTEXT.some((phrase) => contains(context, phrase));
  const candidates: { category: PreparedCategory; score: number; evidence: string }[] = [];
  for (const category of categories) {
    if ((category.raw && readyFood) || category.excluded.some((value) => contains(context, value))) continue;
    for (const rule of category.rules) {
      if (contains(name, rule.phrase)) candidates.push({ category, score: Math.min(99, 74 + rule.specificity), evidence: `«${rule.originalPhrase}» στο όνομα` });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.category.id.localeCompare(b.category.id));
  const best = candidates[0];
  if (!best || best.score < 78) return null;
  const runnerUp = candidates.find((candidate) => candidate.category.id !== best.category.id);
  if (runnerUp && best.score - runnerUp.score < 4) return null;
  return { itemId: item.id, categoryId: best.category.id, categoryPath: best.category.path, score: best.score, evidence: best.evidence };
}

export function matchCatalogCategory(item: CategoryMatchItem, categories: CategoryMatchCategory[]): CatalogCategoryMatch | null {
  return matchPrepared(item, prepareCategories(categories));
}

export function matchCatalogCategories(items: CategoryMatchItem[], categories: CategoryMatchCategory[]): CatalogCategoryMatch[] {
  const prepared = prepareCategories(categories);
  return items.flatMap((item) => {
    const match = matchPrepared(item, prepared);
    return match ? [match] : [];
  });
}
