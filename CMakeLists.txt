# Browser (Emscripten) build of CorsixTH, the open-source Theme Hospital engine.
#
#   source ~/projects/emsdk/emsdk_env.sh
#   emcmake cmake -B build/web -DCMAKE_BUILD_TYPE=Release
#   cmake --build build/web -j
#
# Dependencies are compiled from source in third_party/ (see
# tools/fetch-deps.sh) or come from Emscripten ports (SDL3, zlib, libpng,
# FreeType). No game data is built in: the player supplies their own copy.
cmake_minimum_required(VERSION 3.20)
project(themehospital_web C CXX)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Configure with emcmake (see the comment at the top).")
endif()

set(TP ${CMAKE_SOURCE_DIR}/third_party)
set(CTH ${TP}/CorsixTH/CorsixTH)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Exceptions and longjmp both use native wasm EH, which JSPI can suspend
# through. Lua (C) raises errors with longjmp, CorsixTH (C++) uses try/catch.
set(EH_FLAGS -fwasm-exceptions -sSUPPORT_LONGJMP=wasm)
set(PORT_FLAGS -sUSE_SDL=3 -sUSE_ZLIB=1 -sUSE_LIBPNG=1 -sUSE_FREETYPE=1)
add_compile_options(${EH_FLAGS})

# --- Lua 5.4 -------------------------------------------------------------
file(GLOB LUA_SRC ${TP}/lua-5.4.7/src/*.c)
list(REMOVE_ITEM LUA_SRC ${TP}/lua-5.4.7/src/lua.c ${TP}/lua-5.4.7/src/luac.c)
add_library(lua STATIC ${LUA_SRC})
target_compile_definitions(lua PUBLIC LUA_COMPAT_5_3)
target_include_directories(lua PUBLIC ${TP}/lua-5.4.7/src)

# --- Lua modules: lfs, lpeg ----------------------------------------------
add_library(luamods STATIC
  ${TP}/luafilesystem-1_8_0/src/lfs.c
  ${TP}/lpeg-1.1.0/lpcap.c ${TP}/lpeg-1.1.0/lpcode.c ${TP}/lpeg-1.1.0/lpcset.c
  ${TP}/lpeg-1.1.0/lpprint.c ${TP}/lpeg-1.1.0/lptree.c ${TP}/lpeg-1.1.0/lpvm.c)
target_link_libraries(luamods PUBLIC lua)

# --- zstd (savegame compression) -----------------------------------------
file(GLOB ZSTD_SRC ${TP}/zstd-1.5.6/lib/common/*.c
  ${TP}/zstd-1.5.6/lib/compress/*.c ${TP}/zstd-1.5.6/lib/decompress/*.c)
add_library(zstd STATIC ${ZSTD_SRC})
target_compile_definitions(zstd PRIVATE ZSTD_DISABLE_ASM ZSTD_MULTITHREAD=0)
target_include_directories(zstd PUBLIC ${TP}/zstd-1.5.6/lib)

# --- SDL3_mixer (WAV for sound effects, MP3/Ogg for replacement music) ---
add_library(sdlmixer STATIC
  ${TP}/SDL_mixer/src/SDL_mixer.c
  ${TP}/SDL_mixer/src/SDL_mixer_metadata_tags.c
  ${TP}/SDL_mixer/src/SDL_mixer_spatialization.c
  ${TP}/SDL_mixer/src/decoder_raw.c
  ${TP}/SDL_mixer/src/decoder_sinewave.c
  ${TP}/SDL_mixer/src/decoder_wav.c
  ${TP}/SDL_mixer/src/decoder_voc.c
  ${TP}/SDL_mixer/src/decoder_drmp3.c
  ${TP}/SDL_mixer/src/decoder_stb_vorbis.c)
target_compile_definitions(sdlmixer PRIVATE DECODER_WAV DECODER_VOC
  DECODER_MP3_DRMP3 DECODER_OGGVORBIS_STB)
target_compile_options(sdlmixer PRIVATE -sUSE_SDL=3)
target_include_directories(sdlmixer PUBLIC ${TP}/SDL_mixer/include
  PRIVATE ${TP}/SDL_mixer/src)

# --- FluidSynth (MIDI music), prebuilt by tools/fetch-deps.sh -------------
# osal=embedded: no glib, no threads; the player is clocked by the samples
# the game pulls from it.
add_library(fluidsynth STATIC IMPORTED)
set_target_properties(fluidsynth PROPERTIES
  IMPORTED_LOCATION ${TP}/fluidsynth/build-web/src/libfluidsynth.a
  INTERFACE_INCLUDE_DIRECTORIES "${TP}/fluidsynth/include;${TP}/fluidsynth/build-web/include")

# --- CorsixTH ------------------------------------------------------------
set(CORSIX_TH_INTERPRETER_NAME CorsixTH.lua)
set(CORSIX_TH_INTERPRETER_PATH /app/CorsixTH.lua)
set(CORSIX_TH_LINK_LUA_MODULES ON)
set(CORSIX_TH_OS "web")
set(CORSIX_TH_ARCH "wasm32")
configure_file(${CTH}/Src/config.h.in ${CMAKE_BINARY_DIR}/gen/config.h)

file(GLOB CTH_SRC ${CTH}/Src/*.cpp ${CTH}/Src/*.c)
list(REMOVE_ITEM CTH_SRC ${CTH}/Src/main.cpp)
add_executable(corsixth ${CTH_SRC} ${CTH}/Src/main.cpp
  ${CTH}/SrcUnshared/main.cpp ${TP}/CorsixTH/libs/rnc/rnc.cpp
  src/web/web.cpp)
target_include_directories(corsixth PRIVATE ${CMAKE_BINARY_DIR}/gen ${CTH}/Src
  ${TP}/CorsixTH/libs/rnc)
target_compile_options(corsixth PRIVATE ${PORT_FLAGS})
target_link_libraries(corsixth PRIVATE luamods lua zstd sdlmixer fluidsynth)

set(DATA_DIR ${CMAKE_BINARY_DIR}/appdata)
target_link_options(corsixth PRIVATE ${EH_FLAGS} ${PORT_FLAGS}
  -sJSPI -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=4MB -sINITIAL_MEMORY=256MB
  -sEXIT_RUNTIME=0 -sASSERTIONS=1 -lidbfs.js -sFORCE_FILESYSTEM=1
  -sEXPORTED_RUNTIME_METHODS=FS,callMain,ENV
  -sEXPORTED_FUNCTIONS=_main,_malloc,_free,_web_resize
  -sINVOKE_RUN=0
  --profiling-funcs
  --preload-file ${DATA_DIR}@/app
  --shell-file ${CMAKE_SOURCE_DIR}/web/shell.html)
set_target_properties(corsixth PROPERTIES SUFFIX .html OUTPUT_NAME corsixth)

# The engine's Lua scripts, bitmaps, levels and campaigns (all part of
# CorsixTH itself, MIT licensed) are packaged into /app.
add_custom_target(appdata
  COMMAND ${CMAKE_COMMAND} -E rm -rf ${DATA_DIR}
  COMMAND ${CMAKE_COMMAND} -E make_directory ${DATA_DIR}
  COMMAND ${CMAKE_COMMAND} -E copy ${CTH}/CorsixTH.lua ${DATA_DIR}/
  COMMAND ${CMAKE_COMMAND} -E copy_directory ${CTH}/Lua ${DATA_DIR}/Lua
  COMMAND ${CMAKE_COMMAND} -E copy_directory ${CTH}/Bitmap ${DATA_DIR}/Bitmap
  COMMAND ${CMAKE_COMMAND} -E copy_directory ${CTH}/Levels ${DATA_DIR}/Levels
  COMMAND ${CMAKE_COMMAND} -E copy_directory ${CTH}/Campaigns ${DATA_DIR}/Campaigns
  COMMAND ${CMAKE_COMMAND} -E copy ${TP}/lpeg-1.1.0/re.lua ${DATA_DIR}/
  VERBATIM)
add_dependencies(corsixth appdata)

add_custom_command(TARGET corsixth POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy ${CMAKE_SOURCE_DIR}/web/boot.js ${CMAKE_SOURCE_DIR}/web/install-worker.js
    ${TP}/soundfont/GeneralUser-GS.sf2 ${TP}/soundfont/GeneralUser-GS-LICENSE.txt $<TARGET_FILE_DIR:corsixth>/
  VERBATIM)
set_property(TARGET corsixth APPEND PROPERTY LINK_DEPENDS ${CMAKE_SOURCE_DIR}/web/shell.html)
