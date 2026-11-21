#!/bin/sh
set -e

# Πριν σηκωθεί ο server εφαρμόζουμε όσες migrations λείπουν.
# Η βάση ορίζεται με DATABASE_URL (ή DIRECT_URL) από το περιβάλλον του Coolify.
echo "Εφαρμογή migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "Εκκίνηση server..."
exec node server.js
