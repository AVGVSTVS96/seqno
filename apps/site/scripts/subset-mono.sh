#!/bin/sh
set -e
for weight in 400 500; do
  pyftsubset "${BRAND:-../brand}/fonts/commit-mono-$weight.woff2" \
    --unicodes="U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2026,U+2190-2193,U+2197" \
    --layout-features="kern,liga,calt" \
    --flavor=woff2 \
    --output-file="src/assets/fonts/commit-mono-$weight.woff2"
done
