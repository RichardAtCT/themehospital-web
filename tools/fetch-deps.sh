#!/bin/sh
# Fetches the pinned third-party sources into third_party/ and applies the
# browser patches to CorsixTH. Safe to re-run: existing folders are kept.
set -e
cd "$(dirname "$0")/.."
mkdir -p third_party && cd third_party

CORSIXTH_REV=e6555700
if [ ! -d CorsixTH ]; then
  git clone -q https://github.com/CorsixTH/CorsixTH.git CorsixTH
  (cd CorsixTH && git checkout -q -b wasm $CORSIXTH_REV && git apply ../../patches/corsixth-web.patch)
fi
[ -d lua-5.4.7 ] || curl -sL https://www.lua.org/ftp/lua-5.4.7.tar.gz | tar xz
[ -d luafilesystem-1_8_0 ] || curl -sL https://github.com/lunarmodules/luafilesystem/archive/refs/tags/v1_8_0.tar.gz | tar xz
[ -d lpeg-1.1.0 ] || curl -sL https://www.inf.puc-rio.br/~roberto/lpeg/lpeg-1.1.0.tar.gz | tar xz
[ -d zstd-1.5.6 ] || curl -sL https://github.com/facebook/zstd/releases/download/v1.5.6/zstd-1.5.6.tar.gz | tar xz
[ -d SDL_mixer ] || git clone -q --depth 1 -b release-3.2.4 https://github.com/libsdl-org/SDL_mixer.git SDL_mixer


# FluidSynth for MIDI music: osal=embedded (no glib/threads), no drivers.
if [ ! -f fluidsynth/build-web/src/libfluidsynth.a ]; then
  [ -d fluidsynth ] || git clone -q --depth 1 -b v2.6.1 https://github.com/FluidSynth/fluidsynth.git fluidsynth
  OFF=""
  for o in threads openmp alsa aufile dbus ipv6 jack ladspa libinstpatch libsndfile midishare network oss \
           dsound wasapi waveout winmidi sdl2 sdl3 pulseaudio pipewire readline; do OFF="$OFF -Denable-$o=OFF"; done
  (cd fluidsynth && emcmake cmake -B build-web -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
     -Dosal=embedded -Denable-floats=ON $OFF \
     -DCMAKE_C_FLAGS="-fwasm-exceptions -sSUPPORT_LONGJMP=wasm" \
     -DCMAKE_CXX_FLAGS="-fwasm-exceptions -sSUPPORT_LONGJMP=wasm" >/dev/null &&
   cmake --build build-web -j8 --target libfluidsynth)
fi
# GeneralUser GS soundfont for the MIDI music (free to redistribute; served
# from our own site as its author asks, not hotlinked).
SF_REV=684543d5e5efaef08d02be50dcda8d552478fa60
if [ ! -f soundfont/GeneralUser-GS.sf2 ]; then
  mkdir -p soundfont
  curl -sL -o soundfont/GeneralUser-GS.sf2 https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/$SF_REV/GeneralUser-GS.sf2
  curl -sL -o soundfont/GeneralUser-GS-LICENSE.txt "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/$SF_REV/documentation/LICENSE.txt"
fi
echo "third_party ready"
