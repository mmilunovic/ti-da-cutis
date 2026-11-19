#!/usr/bin/env bash
# Builds the landing page into site-build/: page, images, and ti-da-cutis.zip (the extension).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf site-build && mkdir -p site-build/tmp/ti-da-cutis
cp site/index.html site-build/
cp extension/dist/icons/icon128.png site-build/icon.png
cp extension/dist/icons/icon32.png site-build/favicon.png
cp -r extension/dist/. site-build/tmp/ti-da-cutis/
rm -f site-build/tmp/ti-da-cutis/*.map
(cd site-build/tmp && zip -qr9 ../ti-da-cutis.zip ti-da-cutis)
rm -rf site-build/tmp
touch site-build/.nojekyll
echo "tidacutis.rs" > site-build/CNAME
echo "built site-build/ ($(du -sh site-build | cut -f1))"
