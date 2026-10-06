#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
dst=mac:Developer/seqno-spikes/ios-loro
ssh mac 'mkdir -p ~/Developer/seqno-spikes/ios-loro'
rsync -a --delete src host scripts fixtures "$dst/"
rsync -aL --delete vendor/ "$dst/vendor/"
rsync -a --delete --exclude node_modules --exclude ios --exclude .expo app/ "$dst/app/"
