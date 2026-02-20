#!/bin/bash

# Script to launch all services needed to test the web interface

set -e

echo "🚀 Starting all services for web interface"
echo ""

# Colors for messages
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check if a port is free
check_port() {
    local port=$1
    if lsof -ti:$port > /dev/null 2>&1; then
        return 1  # Port occupied
    else
        return 0  # Port free
    fi
}

# Function to kill a process on a port
kill_port() {
    local port=$1
    local pid=$(lsof -ti:$port 2>/dev/null)
    if [ ! -z "$pid" ]; then
        echo -e "${YELLOW}⚠️  Port $port occupied, stopping process $pid${NC}"
        kill $pid 2>/dev/null || true
        sleep 1
    fi
}

# 1. Check and launch Hardhat node (or Anvil)
echo -e "${GREEN}1. Checking blockchain node...${NC}"
if check_port 8545; then
    echo -e "${YELLOW}   Hardhat node not running${NC}"
    echo -e "${YELLOW}   Run in a separate terminal:${NC}"
    echo -e "   ${GREEN}cd src/hardhat && npx hardhat node${NC}"
    echo ""
    echo -e "   ${YELLOW}OR use Anvil (recommended):${NC}"
    echo -e "   ${GREEN}./run-anvil.sh${NC}"
    echo ""
    read -p "Press Enter once node is running... "
else
    echo -e "${GREEN}   ✅ Blockchain node already running${NC}"
fi

# 2. Check and launch bundler
echo -e "${GREEN}2. Checking bundler...${NC}"
if check_port 3002; then
    echo -e "${YELLOW}   Bundler not running${NC}"
    echo -e "${YELLOW}   Run in a separate terminal:${NC}"
    echo -e "   ${GREEN}./run-alto.sh${NC}"
    echo ""
    read -p "Press Enter once bundler is running... "
else
    echo -e "${GREEN}   ✅ Bundler already running${NC}"
fi

# 3. Initialize database if needed
echo -e "${GREEN}3. Checking database...${NC}"
if [ ! -f "src/app/db/sox.sqlite" ]; then
    echo -e "${YELLOW}   Initializing database...${NC}"
    cd src/app/db
    touch sox.sqlite
    cat init.sql | sqlite3 sox.sqlite
    cd ../../..
    echo -e "${GREEN}   ✅ Database initialized${NC}"
else
    echo -e "${GREEN}   ✅ Database exists${NC}"
fi

# 4. Check dependencies
echo -e "${GREEN}4. Checking dependencies...${NC}"
if [ ! -d "node_modules/next" ]; then
    echo -e "${YELLOW}   Installing dependencies...${NC}"
    npm install
    echo -e "${GREEN}   ✅ Dependencies installed${NC}"
else
    echo -e "${GREEN}   ✅ Dependencies installed${NC}"
fi

# 5. Launch web interface
echo -e "${GREEN}5. Starting web interface...${NC}"
if check_port 3000; then
    echo -e "${GREEN}   🚀 Starting Next.js...${NC}"
    echo ""
    echo -e "${GREEN}   📍 Interface will be accessible at: http://localhost:3000${NC}"
    echo ""
    npm run dev
else
    echo -e "${RED}   ❌ Port 3000 already occupied${NC}"
    echo -e "${YELLOW}   Stopping existing process...${NC}"
    kill_port 3000
    sleep 2
    echo -e "${GREEN}   🚀 Restarting Next.js...${NC}"
    npm run dev
fi
