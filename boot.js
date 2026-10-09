// Page logic around the CorsixTH build:
//   /app      engine scripts and bitmaps (packaged with the page)
//   /game     the player's Theme Hospital data, read from OPFS into memory
//   /persist  config, saves and screenshots, kept in IndexedDB
// ?dev fetches the game data from the dev server (tools/serve.mjs) instead.
(function () {
  const params = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const status = (t) => { $('status').textContent = t || ''; };
  const SAVES = '/persist/Saves';
  const SOUNDFONT = '/app/GeneralUser-GS.sf2';
  let FS = null;
  let running = false;

  let runtimeReady;
  const runtime = new Promise((r) => { runtimeReady = r; });
  window.thRuntimeReady = () => runtimeReady();

  function syncfs(populate) {
    return new Promise((resolve) => FS.syncfs(populate, (err) => {
      if (err) console.warn('syncfs', err);
      resolve();
    }));
  }

  function exists(p) {
    try { FS.stat(p); return true; } catch (e) { return false; }
  }

  function mkdirs(dir) {
    let cur = '';
    for (const part of dir.split('/').filter(Boolean)) {
      cur += '/' + part;
      try { FS.mkdir(cur); } catch (e) { /* exists */ }
    }
  }

  // --- game data sources ---------------------------------------------------

  async function devGameFiles(onFile) {
    const list = await (await fetch('game/manifest.json')).json();
    let done = 0;
    const queue = list.slice();
    async function worker() {
      while (queue.length) {
        const f = queue.shift();
        const url = 'game/' + f.path.split('/').map(encodeURIComponent).join('/');
        onFile(f.path, new Uint8Array(await (await fetch(url)).arrayBuffer()));
        status(`Loading game data ${++done}/${list.length}`);
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker));
  }

  async function opfsGameDir() {
    try {
      const root = await navigator.storage.getDirectory();
      return await root.getDirectoryHandle('game');
    } catch (e) {
      return null;
    }
  }

  async function walk(dir, prefix, out) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') await walk(h, prefix + name + '/', out);
      else out.push({ path: prefix + name, h });
    }
    return out;
  }

  async function installedFiles() {
    const dir = await opfsGameDir();
    return dir ? walk(dir, '', []) : [];
  }

  async function opfsGameFiles(onFile) {
    const files = await installedFiles();
    let done = 0;
    for (const f of files) {
      const file = await f.h.getFile();
      onFile(f.path, new Uint8Array(await file.arrayBuffer()));
      if (++done % 25 === 0) status(`Loading game data ${done}/${files.length}`);
    }
  }

  // --- config --------------------------------------------------------------

  function writeConfig(installPath) {
    const dir = '/persist/.config/CorsixTH';
    const file = dir + '/config.txt';
    mkdirs(dir);
    mkdirs(SAVES);
    mkdirs('/persist/Screenshots');
    const forced = {
      theme_hospital_install: `[[${installPath}]]`,
      savegames: `[[${SAVES}]]`,
      screenshots: '[[/persist/Screenshots]]',
      soundfont: `[[${SOUNDFONT}]]`,
      // Open at the size of the browser window, whatever it was last time.
      width: Math.max(640, innerWidth),
      height: Math.max(480, innerHeight),
    };
    // First run: CorsixTH fills in every other setting with its defaults.
    let text = exists(file) ? FS.readFile(file, { encoding: 'utf8' }) : '';
    for (const [k, v] of Object.entries(forced)) {
      const re = new RegExp(`^\\s*${k}\\s*=.*$`, 'm');
      text = re.test(text) ? text.replace(re, `${k} = ${v}`) : `${k} = ${v}\n` + text;
    }
    FS.writeFile(file, text);
  }

  // --- saves menu ----------------------------------------------------------

  // Normal saves (.sav), the quick save (.qs) and CorsixTH's autosaves
  // (Saves/Autosaves/), newest first.
  function listSaves() {
    const out = [];
    const visit = (dir, rel) => {
      if (!exists(dir)) return;
      for (const n of FS.readdir(dir)) {
        if (n === '.' || n === '..') continue;
        const p = dir + '/' + n;
        const st = FS.stat(p);
        if (FS.isDir(st.mode)) visit(p, rel + n + '/');
        else if (/\.(sav|qs)$/i.test(n)) out.push({ n: rel + n, p, t: st.mtime });
      }
    };
    if (FS) visit(SAVES, '');
    return out.sort((a, b) => b.t - a.t);
  }

  function renderMenu() {
    const ul = $('saves');
    ul.textContent = '';
    const saves = listSaves();
    if (!saves.length) {
      const li = document.createElement('li');
      li.textContent = 'No saves yet.';
      ul.appendChild(li);
    }
    for (const s of saves) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = s.n.replace(/\.sav$/i, '').replace(/^(.*)\.qs$/i, 'Quick save');
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = 'Download';
      a.onclick = (e) => {
        e.preventDefault();
        const blob = new Blob([FS.readFile(s.p)]);
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = s.n.split('/').pop();
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 5000);
      };
      li.append(name, a);
      ul.appendChild(li);
    }
  }

  function toggleMenu(show) {
    const m = $('menu');
    if (show === undefined) show = m.hidden;
    if (show) renderMenu();
    m.hidden = !show;
    if (!show) Module.canvas.focus();
  }

  $('menubtn').onclick = () => toggleMenu();
  $('closemenu').onclick = () => toggleMenu(false);
  addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'F8' && running) { e.preventDefault(); toggleMenu(); }
  }, true);
  $('importsave').onclick = () => $('savefile').click();
  $('savefile').onchange = async (e) => {
    mkdirs(SAVES);
    for (const f of e.target.files) {
      // CorsixTH only lists .sav files in its Load menu.
      const name = f.name.replace(/[\\/]/g, '_').replace(/\.qs$/i, '') .replace(/(\.sav)?$/i, '.sav');
      FS.writeFile(SAVES + '/' + name, new Uint8Array(await f.arrayBuffer()));
    }
    e.target.value = '';
    await syncfs(false);
    renderMenu();
  };
  $('change').onclick = () => {
    // The engine can't be unloaded cleanly, so reload into the setup screen.
    if (!confirm('Reload the page to choose different game files? Your saves are kept.')) return;
    sessionStorage.setItem('th-setup', '1');
    location.reload();
  };

  // --- setup screen --------------------------------------------------------

  async function showSetup() {
    const files = params.has('dev') ? [{ path: 'dev' }] : await installedFiles();
    const forced = sessionStorage.getItem('th-setup');
    sessionStorage.removeItem('th-setup');
    const have = files.length > 0;
    $('ready').hidden = !have || !!forced;
    $('install').hidden = have && !forced;
    if (have) {
      const iso = files.some((f) => /\.iso$/i.test(f.path));
      const demo = files.some((f) => /^datam\/demo\.dat$/i.test(f.path));
      $('readyinfo').textContent = params.has('dev') ? 'Dev mode: game data from the dev server.'
        : iso ? 'Using your disc image.' : demo ? 'Using the demo (one level).'
        : `Using your game files (${files.length} files).`;
    }
  }

  function startInstall(list) {
    $('err').hidden = true;
    $('progress').hidden = false;
    $('pickfile').disabled = $('pickdir').disabled = true;
    const w = new Worker('install-worker.js');
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.text) {
        $('progress').querySelector('.bar > div').style.width = (m.progress * 100).toFixed(1) + '%';
        $('ptext').textContent = m.text;
      }
      if (m.done || m.error) {
        w.terminate();
        $('pickfile').disabled = $('pickdir').disabled = false;
        $('progress').hidden = true;
        if (m.error) {
          $('err').textContent = m.error;
          $('err').hidden = false;
        } else {
          showSetup();
        }
      }
    };
    w.postMessage({ files: list });
  }

  $('pickfile').onclick = () => $('file').click();
  $('pickdir').onclick = () => $('dir').click();
  $('file').onchange = (e) => {
    const f = e.target.files[0];
    if (f) startInstall([{ file: f, path: f.name }]);
    e.target.value = '';
  };
  $('dir').onchange = (e) => {
    const list = Array.from(e.target.files, (f) => ({ file: f, path: f.webkitRelativePath || f.name }));
    if (list.length) startInstall(list);
    e.target.value = '';
  };
  $('again').onclick = (e) => {
    e.preventDefault();
    $('ready').hidden = true;
    $('install').hidden = false;
  };
  $('play').onclick = () => start();

  // --- start ---------------------------------------------------------------

  async function start() {
    if (running) return;
    running = true;
    $('play').disabled = true;
    $('play').textContent = 'Opening…';
    await runtime;
    FS = Module.FS;
    mkdirs('/persist');
    FS.mount(FS.filesystems.IDBFS, { autoPersist: true }, '/persist');
    await syncfs(true);

    // The MIDI soundfont (32 MB, cached by the browser after the first visit)
    // downloads while the game data is read. Without it the music is silent.
    const soundfont = fetch('GeneralUser-GS.sf2', { cache: 'force-cache' })
      .then((r) => r.ok ? r.arrayBuffer() : Promise.reject(r.status))
      .then((b) => FS.writeFile(SOUNDFONT, new Uint8Array(b), { canOwn: true }))
      .catch((e) => console.warn('No soundfont, music off:', e));

    mkdirs('/game');
    let iso = null;
    await (params.has('dev') ? devGameFiles : opfsGameFiles)((p, data) => {
      const full = '/game/' + p;
      mkdirs(full.slice(0, full.lastIndexOf('/')));
      FS.writeFile(full, data, { canOwn: true });
      if (/\.iso$/i.test(p)) iso = full;
    });
    status('Loading music…');
    await soundfont;
    writeConfig(iso || '/game');

    addEventListener('pagehide', () => syncfs(false));
    document.addEventListener('visibilitychange', () => { if (document.hidden) syncfs(false); });

    status('');
    $('setup').hidden = true;
    $('menubtn').hidden = false;
    FS.chdir('/app');
    Module.canvas.focus();
    Module.callMain([]);

    let resizeTimer = 0;
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => Module._web_resize(
        Math.max(640, innerWidth), Math.max(480, innerHeight)), 150);
    });
  }

  showSetup();
})();
