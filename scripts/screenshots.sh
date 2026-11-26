#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p site/img
for png in store/screenshot-*.png; do
  name=$(basename "$png" .png)
  for width in 640 1280; do
    cwebp -quiet -q 85 -m 6 -sharp_yuv -resize "$width" 0 "$png" -o "site/img/$name-$width.webp"
  done
done
node --input-type=module -e '
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const names = readdirSync("store").filter((f) => /^screenshot-.*\.png$/.test(f)).sort();
const hashes = names.map((f) => [f, createHash("sha256").update(readFileSync(`store/${f}`)).digest("hex")]);
writeFileSync("tests/screenshots.json", `${JSON.stringify(Object.fromEntries(hashes), null, 2)}\n`);
'
