// Browser-only glue for the CorsixTH build, called from web/boot.js.
#include <SDL3/SDL.h>
#include <emscripten.h>

extern "C" {

// Follows the browser window: SDL then sends the resize event the engine
// already handles (it re-lays out the UI for the new size).
EMSCRIPTEN_KEEPALIVE void web_resize(int w, int h) {
  int n = 0;
  SDL_Window** windows = SDL_GetWindows(&n);
  if (windows && n > 0) SDL_SetWindowSize(windows[0], w, h);
  SDL_free(windows);
}

}  // extern "C"
