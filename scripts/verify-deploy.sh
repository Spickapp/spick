#!/bin/bash
# SPICK Post-Deploy Verification
# Kör efter git push + SQL migration + Edge Function deploy
# Usage: bash scripts/verify-deploy.sh

set -e
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

SITE="https://spick.se"
SUPA="https://urjeijcncsyuletprydy.supabase.co"
PASS=0
FAIL=0
WARN=0

check() {
  local name="$1" url="$2" expect="$3"
  local code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null)
  if [ "$code" = "$expect" ]; then
    echo -e "  ${GREEN}✅${NC} $name (HTTP $code)"
    PASS=$((PASS+1))
  else
    echo -e "  ${RED}❌${NC} $name (HTTP $code, expected $expect)"
    FAIL=$((FAIL+1))
  fi
}

check_content() {
  local name="$1" url="$2" pattern="$3"
  local body=$(curl -s --max-time 10 "$url" 2>/dev/null)
  if echo "$body" | grep -q "$pattern"; then
    echo -e "  ${GREEN}✅${NC} $name"
    PASS=$((PASS+1))
  else
    echo -e "  ${RED}❌${NC} $name (pattern '$pattern' not found)"
    FAIL=$((FAIL+1))
  fi
}

echo "╔══════════════════════════════════════════╗"
echo "║   SPICK POST-DEPLOY VERIFICATION         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

echo "1️⃣  KRITISKA SIDOR"
check "Startsida" "$SITE/" "200"
check "Boka" "$SITE/boka.html" "200"
check "Städare" "$SITE/stadare.html" "200"
check "Priser" "$SITE/priser.html" "200"
check "FAQ" "$SITE/faq.html" "200"
check "404" "$SITE/nonexistent-page-xyz" "200"  # GitHub Pages returns 200 for 404
echo ""

echo "2️⃣  STADSSIDOR (stickprov)"
check "Stockholm" "$SITE/stockholm.html" "200"
check "Göteborg" "$SITE/goteborg.html" "200"
check "Malmö" "$SITE/malmo.html" "200"
echo ""

echo "3️⃣  SUPABASE EDGE FUNCTIONS"
check "Health" "$SUPA/functions/v1/health" "200"
echo ""

echo "4️⃣  SECURITY HEADERS"
HEADERS=$(curl -sI "$SITE/" 2>/dev/null)
for h in "x-content-type-options" "x-frame-options" "strict-transport-security" "content-security-policy"; do
  if echo "$HEADERS" | grep -qi "$h"; then
    echo -e "  ${GREEN}✅${NC} $h present"
    PASS=$((PASS+1))
  else
    echo -e "  ${YELLOW}⚠️${NC} $h missing"
    WARN=$((WARN+1))
  fi
done
echo ""

echo "5️⃣  SEO"
check "Sitemap" "$SITE/sitemap.xml" "200"
check "Robots.txt" "$SITE/robots.txt" "200"
check_content "Sitemap har .html URLs" "$SITE/sitemap.xml" ".html</loc>"
echo ""

echo "6️⃣  SUPABASE DATA"
# Test cleaners endpoint
CLEANERS=$(curl -s "$SUPA/rest/v1/cleaners?is_approved=eq.true&select=id&limit=1" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyamVpamNuY3N5dWxldHByeWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNDQsImV4cCI6MjA4OTg0ODI0NH0.CH5MSMaWTBfkuzZQOBKgxu-B6Vfy8w9DLh49WPU1Vd0" 2>/dev/null)
if echo "$CLEANERS" | grep -q '"id"'; then
  echo -e "  ${GREEN}✅${NC} Cleaners API returns data"
  PASS=$((PASS+1))
else
  echo -e "  ${RED}❌${NC} Cleaners API failed"
  FAIL=$((FAIL+1))
fi

# Test reviews endpoint
REVIEWS=$(curl -s "$SUPA/rest/v1/reviews?select=id&limit=1" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyamVpamNuY3N5dWxldHByeWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNDQsImV4cCI6MjA4OTg0ODI0NH0.CH5MSMaWTBfkuzZQOBKgxu-B6Vfy8w9DLh49WPU1Vd0" 2>/dev/null)
if echo "$REVIEWS" | grep -q '\['; then
  echo -e "  ${GREEN}✅${NC} Reviews API accessible"
  PASS=$((PASS+1))
else
  echo -e "  ${RED}❌${NC} Reviews API failed"
  FAIL=$((FAIL+1))
fi

# Test booking_slots VIEW
SLOTS=$(curl -s "$SUPA/rest/v1/booking_slots?select=cleaner_id&limit=1" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyamVpamNuY3N5dWxldHByeWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNDQsImV4cCI6MjA4OTg0ODI0NH0.CH5MSMaWTBfkuzZQOBKgxu-B6Vfy8w9DLh49WPU1Vd0" 2>/dev/null)
if echo "$SLOTS" | grep -q '\['; then
  echo -e "  ${GREEN}✅${NC} booking_slots VIEW accessible"
  PASS=$((PASS+1))
else
  echo -e "  ${YELLOW}⚠️${NC} booking_slots VIEW not found (kör SQL-migrationen?)"
  WARN=$((WARN+1))
fi
echo ""

echo "══════════════════════════════════════════"
echo -e "  Resultat: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$WARN warnings${NC}"
echo "══════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
