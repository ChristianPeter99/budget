#!/usr/bin/env bash
# Startet WebKitWebDriver unter einem virtuellen Bildschirm und führt die WebKit-Tests aus.
set -euo pipefail
xvfb-run -a WebKitWebDriver --port=4445 >/tmp/webkitdriver.log 2>&1 &
DRV=$!
trap 'kill $DRV 2>/dev/null || true' EXIT
sleep 2
node --test --test-concurrency=1 e2e-webkit/webkit.test.mjs
