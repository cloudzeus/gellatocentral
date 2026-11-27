// Το ταμείο χτίζει την απόδειξη χωρίς σύνδεση με τον ίδιο κώδικα του server (offline.ts → web/lib/viva/fiscal.ts):
// ο Metro πρέπει να βλέπει και αυτόν τον φάκελο, έξω από το project.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../web/lib/viva")];
module.exports = config;
