// Copies the player's Theme Hospital files into this site's private storage
// (OPFS, folder "game"). Nothing leaves the browser.
//
// Accepted input:
//   - the game folder itself (a folder pick: every file with its path)
//   - a .zip holding the installed game (e.g. the Internet Archive's
//     MS-DOS copy) or the free demo
//   - a CD image (.iso), which CorsixTH reads directly
//
// The data root is the folder that holds DATA/VBLK-0.TAB; only that folder's
// contents are kept. Messages out: {progress, text}, {done, kind}, {error}.

const ROOT_MARKER = /(^|\/)data\/vblk-0\.tab$/i;

function rootOf(paths) {
  for (const p of paths) {
    const m = p.match(ROOT_MARKER);
    if (m) return p.slice(0, p.length - m[0].length + (m[1] ? 1 : 0));
  }
  return null;
}

async function gameDir(clear) {
  const opfs = await navigator.storage.getDirectory();
  if (clear) {
    try { await opfs.removeEntry('game', { recursive: true }); } catch (e) { /* none yet */ }
  }
  return opfs.getDirectoryHandle('game', { create: true });
}

async function openForWrite(dir, relPath) {
  const parts = relPath.split('/').filter(Boolean);
  let d = dir;
  for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true });
  const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
  const h = await fh.createSyncAccessHandle();
  h.truncate(0);
  return h;
}

async function writeStream(dir, relPath, stream) {
  const h = await openForWrite(dir, relPath);
  let at = 0;
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    h.write(value, { at });
    at += value.byteLength;
  }
  h.flush();
  h.close();
  return at;
}

// --- zip -------------------------------------------------------------------

async function bytes(file, start, end) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

async function zipEntries(file) {
  const tailLen = Math.min(file.size, 65557);
  const tail = await bytes(file, file.size - tailLen, file.size);
  const dv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a zip archive.');
  let count = dv.getUint16(eocd + 10, true);
  let cdSize = dv.getUint32(eocd + 12, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    // zip64: the locator sits just before the EOCD record.
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
      const recOff = Number(dv.getBigUint64(loc + 8, true));
      const rec = new DataView((await bytes(file, recOff, recOff + 56)).buffer);
      count = Number(rec.getBigUint64(32, true));
      cdSize = Number(rec.getBigUint64(40, true));
      cdOffset = Number(rec.getBigUint64(48, true));
    }
  }
  const cd = await bytes(file, cdOffset, cdOffset + cdSize);
  const cv = new DataView(cd.buffer);
  const dec = new TextDecoder('utf-8');
  const out = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (cv.getUint32(p, true) !== 0x02014b50) break;
    const method = cv.getUint16(p + 10, true);
    let csize = cv.getUint32(p + 20, true);
    let usize = cv.getUint32(p + 24, true);
    const nlen = cv.getUint16(p + 28, true);
    const xlen = cv.getUint16(p + 30, true);
    const clen = cv.getUint16(p + 32, true);
    let lho = cv.getUint32(p + 42, true);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');
    // zip64 extra field
    let x = p + 46 + nlen;
    const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = cv.getUint16(x, true), sz = cv.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(cv.getBigUint64(q, true)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(cv.getBigUint64(q, true)); q += 8; }
        if (lho === 0xffffffff) { lho = Number(cv.getBigUint64(q, true)); }
      }
      x += 4 + sz;
    }
    if (!name.endsWith('/')) out.push({ name, method, csize, usize, lho });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

async function zipStream(file, e) {
  const lh = new DataView((await bytes(file, e.lho, e.lho + 30)).buffer);
  if (lh.getUint32(0, true) !== 0x04034b50) throw new Error('Damaged zip: ' + e.name);
  const start = e.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
  const raw = file.slice(start, start + e.csize).stream();
  if (e.method === 0) return raw;
  if (e.method === 8) return raw.pipeThrough(new DecompressionStream('deflate-raw'));
  throw new Error(`Unsupported compression (method ${e.method}) for ${e.name}. Re-zip the folder or pick the folder itself.`);
}

// --- install ---------------------------------------------------------------

function report(done, total, text) {
  postMessage({ progress: total ? done / total : 0, text });
}

async function installFiles(items) {
  // items: [{path, size, stream()}]
  const root = rootOf(items.map((i) => i.path));
  if (root === null) return null;
  const chosen = items.filter((i) => i.path.startsWith(root) && i.path.length > root.length);
  const total = chosen.reduce((s, i) => s + i.size, 0);
  const dir = await gameDir(true);
  let done = 0;
  for (const i of chosen) {
    report(done, total, `Copying ${i.path.slice(root.length)}`);
    await writeStream(dir, i.path.slice(root.length), await i.stream());
    done += i.size;
  }
  report(total, total, 'Done');
  return chosen.length;
}

async function installIso(file) {
  // ISO 9660 volume descriptor: "CD001" at byte 0x8001.
  const sig = new TextDecoder().decode(await bytes(file, 0x8001, 0x8006));
  if (sig !== 'CD001') throw new Error('This file is not a CD image (.iso). Raw .bin/.cue images need converting to .iso first.');
  const dir = await gameDir(true);
  report(0, file.size, 'Copying the disc image');
  const h = await openForWrite(dir, 'hospital.iso');
  const reader = file.stream().getReader();
  let at = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    h.write(value, { at });
    at += value.byteLength;
    if ((at & 0xffffff) < value.byteLength) report(at, file.size, 'Copying the disc image');
  }
  h.flush();
  h.close();
}

onmessage = async (ev) => {
  try {
    const files = ev.data.files; // [{file, path}]
    if (files.length === 1 && /\.iso$/i.test(files[0].path)) {
      await installIso(files[0].file);
      return postMessage({ done: true, kind: 'iso' });
    }
    if (files.length === 1 && /\.zip$/i.test(files[0].path)) {
      const zip = files[0].file;
      const entries = await zipEntries(zip);
      const n = await installFiles(entries.map((e) => ({
        path: e.name, size: e.usize, stream: () => zipStream(zip, e),
      })));
      if (n) return postMessage({ done: true, kind: 'folder' });
      const iso = entries.find((e) => /\.iso$/i.test(e.name));
      if (iso) {
        const dir = await gameDir(true);
        report(0, 1, 'Unpacking the disc image');
        await writeStream(dir, 'hospital.iso', await zipStream(zip, iso));
        return postMessage({ done: true, kind: 'iso' });
      }
      throw new Error('No Theme Hospital data in this zip (looked for DATA/VBLK-0.TAB).');
    }
    const n = await installFiles(files.map((f) => ({
      path: f.path, size: f.file.size, stream: async () => f.file.stream(),
    })));
    if (!n) throw new Error('These files are not Theme Hospital data (looked for DATA/VBLK-0.TAB). Pick the folder that holds DATA, QDATA and LEVELS, the game\'s .zip, or a disc image (.iso).');
    postMessage({ done: true, kind: 'folder' });
  } catch (e) {
    postMessage({ error: String(e && e.message || e) });
  }
};
