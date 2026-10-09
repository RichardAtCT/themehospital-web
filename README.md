# Theme Hospital in the browser

Play Bullfrog's *Theme Hospital* (1997) in a web browser, using
[CorsixTH](https://github.com/CorsixTH/CorsixTH), the open-source
reimplementation of its engine, compiled to WebAssembly.

**Play:** https://richardatct.github.io/themehospital-web/ (Chrome or Edge 137+).

You bring the game files: the page hosts none of them, and nothing you pick is
uploaded. It accepts the installed game folder (for example from
[GOG](https://www.gog.com/en/game/theme_hospital)), a `.zip` of it (such as the
[Internet Archive's MS-DOS copy](https://archive.org/details/msdos_Theme_Hospital_1997)
or the free [demo](https://th.corsix.org/Demo.zip)), or a CD image (`.iso`).
The files are kept in the browser's private storage (OPFS); saves and settings
live in IndexedDB. The ☰ button (or Ctrl+F8) downloads and imports saves.

## What's here

- `CMakeLists.txt` builds CorsixTH and every dependency from source with
  Emscripten: Lua 5.4, LuaFileSystem, LPeg, zstd, SDL3 (Emscripten port),
  SDL3_mixer, FluidSynth (MIDI music, `osal=embedded`, no threads).
- `patches/corsixth-web.patch`: the engine changes. CorsixTH's event loop
  blocks, so in the browser it sleeps through
  [JSPI](https://v8.dev/blog/jspi) and the page keeps running; music loads
  without a thread.
- `web/`: the page (setup screen, saves menu), the boot script and the worker
  that copies the player's files into OPFS (with its own zip reader).
- `src/web/web.cpp`: small C hooks the page calls (window resizing).
- `tools/`: dependency fetch, dev server, headless Chrome checks, site build.

## Building

Needs [emsdk](https://emscripten.org/docs/getting_started/downloads.html)
(tested with 6.0.11) and CMake.

```sh
tools/fetch-deps.sh                     # third_party/: sources, patch, FluidSynth, soundfont
source /path/to/emsdk/emsdk_env.sh
emcmake cmake -B build/web -DCMAKE_BUILD_TYPE=Release
cmake --build build/web -j
node tools/serve.mjs build/web 8082 /path/to/HOSP   # then open
# http://localhost:8082/corsixth.html?dev   (game data from the dev server)
# http://localhost:8082/corsixth.html       (the normal setup screen)
tools/build-site.sh                     # static site in build/site
```

## Not done yet

- The intro and level videos (Smacker files) don't play; CorsixTH needs a
  threaded FFmpeg for them.
- No Unicode font is bundled, so languages that need one (Chinese, Russian, …)
  aren't readable yet.

## Licences

This repo's code is MIT (see `LICENSE`), like CorsixTH. Music uses the
[GeneralUser GS](https://www.schristiancollins.com/generaluser.php) soundfont
by S. Christian Collins, which is served with the site under its own licence.
Theme Hospital is © Electronic Arts; this is an unofficial fan project, not
affiliated with EA or Bullfrog.
