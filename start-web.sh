#!/bin/bash

# Script pour lancer l'interface web

set -e

echo "🌐 Lancement de l'interface web..."
echo ""

# Vérifier que Hardhat node est lancé
if ! curl -s http://localhost:8545 > /dev/null 2>&1; then
    echo "⚠️  Hardhat node ne semble pas être lancé sur localhost:8545"
    echo "Lancez d'abord: cd src/hardhat && npx hardhat node"
    exit 1
fi

# Vérifier que la base de données existe
if [ ! -f "src/app/db/sox.sqlite" ]; then
    echo "📦 Initialisation de la base de données..."
    cd src/app/db
    touch sox.sqlite
    cat init.sql | sqlite3 sox.sqlite
    cd ../../..
    echo "✅ Base de données initialisée"
fi

# Aller dans le répertoire src pour lancer Next.js
cd src

echo "🚀 Lancement de Next.js..."
echo "📍 L'interface sera accessible sur: http://localhost:3000"
echo ""

npm run dev





















