#!/bin/bash
# Hourly update script for nissansprings knowledge base
# Called by cron job every hour

DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$DIR/data/update.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$TIMESTAMP] Starting update..." >> "$LOG"

cd "$DIR"

# Scrape the site
node scripts/scrape.js 2>> "$LOG" >> "$LOG"
SCRAPE_EXIT=$?

# Build search index
if [ $SCRAPE_EXIT -eq 0 ]; then
  node scripts/build-index.js 2>> "$LOG" >> "$LOG"
  INDEX_EXIT=$?
  if [ $INDEX_EXIT -eq 0 ]; then
    echo "[$TIMESTAMP] ✅ Update complete: $(node -e "const d=require('./data/knowledge-base.json');console.log(d.length+' pages')")" >> "$LOG"
  else
    echo "[$TIMESTAMP] ⚠ Index build failed" >> "$LOG"
  fi
else
  echo "[$TIMESTAMP] ⚠ Scrape failed (exit $SCRAPE_EXIT)" >> "$LOG"
fi

# Keep only last 100 log lines
tail -100 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

echo "[$TIMESTAMP] Done" >> "$LOG"
