#!/bin/sh
# Download the Sherwin-Williams automotive colour files build.py reads:
# the colour compatibility guides and colour manuals for the ten brands the
# shop sells. About 130 PDFs, 200 MB. They go to $PAINT_ASSETS/sherwin-williams
# (default ~/Downloads/claude-autocolor-assets), outside the repository.
set -eu
ASSETS="${PAINT_ASSETS:-$HOME/Downloads/claude-autocolor-assets}"
DEST="$ASSETS/sherwin-williams"
SITE="https://industrial.sherwin-williams.com"
PAGE="$SITE/na/us/en/automotive/color/color-resources-downloads.html"
mkdir -p "$DEST"
curl -sL -A "Mozilla/5.0" "$PAGE" \
  | grep -o 'href="[^"]*\.pdf"' | sed 's/href="//;s/"$//' | sort -u \
  | grep -i -E "toyota|gm_|gm-|_gm|ford|nissan|subaru|bmw|audi|mercedes|fiat|chrysler|jeep|global_color|global-color|colorboo|colorbook" \
  | grep -v -i -E "underhood|police|interior|underho" \
  | while read -r path; do
      file=$(basename "$path" | sed 's/%20/_/g;s/%28/(/g;s/%29/)/g')
      [ -s "$DEST/$file" ] || curl -sL -A "Mozilla/5.0" "$SITE$path" -o "$DEST/$file"
    done
ls "$DEST" | wc -l | xargs echo "PDFs in $DEST:"
