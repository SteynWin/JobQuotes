#!/bin/sh
# Bump the app version so open browsers reload to the newest copy.
# Usage: ./bump-version.sh   (run before committing a release)
set -e
cd "$(dirname "$0")"
old=$(sed -n 's/.*"v": *"\([0-9]*\)".*/\1/p' version.json)
new=$((old + 1))
printf '{ "v": "%s" }\n' "$new" > version.json
for f in *.html; do
  sed -i.bak "s/var APP_VERSION = \"$old\";/var APP_VERSION = \"$new\";/" "$f" && rm -f "$f.bak"
done
echo "Version $old -> $new"
