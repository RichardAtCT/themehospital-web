#!/bin/sh
# Assembles the static site (what GitHub Pages would serve) in build/site.
# It holds the compiled engine, CorsixTH's own scripts and the soundfont;
# never any Theme Hospital files.
set -e
cd "$(dirname "$0")/.."
. ~/projects/emsdk/emsdk_env.sh >/dev/null 2>&1
cmake --build build/web -j8
rm -rf build/site && mkdir -p build/site
cp build/web/corsixth.html build/site/index.html
cp build/web/corsixth.js build/web/corsixth.wasm build/web/corsixth.data build/web/boot.js \
   build/web/install-worker.js build/web/GeneralUser-GS.sf2 build/web/GeneralUser-GS-LICENSE.txt build/site/
# The .data file must not contain game data: only CorsixTH's own folders.
if find build/web/appdata -iname 'vblk-0*' | grep -q .; then echo "game data in appdata!" >&2; exit 1; fi
touch build/site/.nojekyll
du -sh build/site
