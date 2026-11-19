import { CONFIG } from './config.js';
import { parseCode, searchKeys } from './codes.js';
import { QrScanner } from './scanner.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo');          // '1' = oefenmodus met echte historiek, 'local' = volledig lokaal (tests)
const fmtTime = d => d ? d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : '?';
const fmtDate = d => d ? d.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const isToday = d => d && d.toDateString() === new Date().toDateString();
const fmtWhen = d => !d ? '' : isToday(d) ? fmtTime(d) : `${fmtDate(d)} ${fmtTime(d)}`;
const NEW = CONFIG.newBands;
const NEW_TOTAL = NEW.to - NEW.from + 1;

// ---------- Instellingen per toestel ----------
const settings = {
  get name() { return localStorage.getItem('sw.name') || ''; },
  set name(v) { localStorage.setItem('sw.name', v); },
  get sound() { return localStorage.getItem('sw.sound') !== '0'; },
  set sound(v) { localStorage.setItem('sw.sound', v ? '1' : '0'); },
  get vibrate() { return localStorage.getItem('sw.vibrate') !== '0'; },
  set vibrate(v) { localStorage.setItem('sw.vibrate', v ? '1' : '0'); },
};

// ---------- Opslag ----------
const db = await import('./db.js');
let store;
if (DEMO === 'local') {
  // Synthetische historiek voor automatische tests (niet gebruikt in productie).
  const fake = [];
  const mk = (coll, ed, n, day, peak) => { for (let i = 0; i < n; i++) { const d = new Date(day); d.setHours(15, 0, 0, 0); d.setMinutes(Math.round((Math.random() + Math.random() + Math.random()) / 3 * 300 + (peak - 17.5) * 60)); fake.push({ coll, id: `${ed === 2025 ? 1600 + i : `santa_walk_${ed}_${200 + i}`}`, key: ed === 2025 ? String(1600 + i) : `santa_walk_${ed}_${200 + i}`, edition: ed, at: d }); } };
  mk('santa_walk_2025', 2025, 400, '2025-12-20', 17); mk('santa_walk_2024', 2024, 350, '2024-12-21', 17.5);
  store = new db.MemoryStore(CONFIG, { 'santa_walk_2024_100': '2024', '1501': '2025', '1520': '2025', 'santa_walk_2023_10': '2023', 'santa_walk_2023_100': '2023' }, fake);
} else {
  store = new db.FirestoreStore(CONFIG, { dryRun: !!DEMO });
}
if (DEMO) { $('demoBanner').hidden = false; $('demoLink').hidden = true; }

$('title').textContent = `Santa Walk ${CONFIG.year}`;
document.querySelectorAll('.yearLabel').forEach(e => { e.textContent = CONFIG.year; });
$('infoCollection').textContent = CONFIG.collection;
$('infoCodes').textContent = `${CONFIG.plainMin}–${CONFIG.plainMax} en santa_walk_${CONFIG.prefixedYears.join('/')}_<nr>`;
$('newRange').textContent = `(${NEW.from}–${NEW.to})`;

let giftStock = CONFIG.giftStock;
let lastStats = { total: 0, docs: [] };
let pastLoaded = false;
let role = 'scanner';

// ---------- Toegangscode ----------
async function tryLogin(code) {
  $('loginError').textContent = '';
  try {
    await store.login(code);
  } catch (err) {
    const map = {
      'auth/invalid-credential': 'Foute toegangscode.',
      'auth/wrong-password': 'Foute toegangscode.',
      'auth/user-not-found': 'Scanner-account bestaat niet in Firebase.',
      'auth/too-many-requests': 'Te veel pogingen, probeer straks opnieuw.',
      'auth/operation-not-allowed': 'E-mail/wachtwoord-login staat niet aan in Firebase.',
      'auth/network-request-failed': 'Geen netwerk.',
      'auth/missing-password': 'Geef de code in.',
    };
    $('loginError').textContent = map[err.code] || `Aanmelden mislukt (${err.code || err.message}).`;
  }
}
$('loginForm').addEventListener('submit', e => { e.preventDefault(); tryLogin($('loginCode').value.trim()); });
$('logoutBtn').addEventListener('click', () => store.logout());

// Link met code: https://…/#code=XXXX → automatisch aanmelden, daarna code uit de adresbalk halen.
const hashCode = new URLSearchParams(location.hash.slice(1)).get('code');
if (hashCode) history.replaceState(null, '', location.pathname + location.search);

// ---------- Tabs ----------
async function ensurePast() {
  if (pastLoaded) return;
  try { await store.loadAllPast(); pastLoaded = true; } catch (_) { return; }
  renderYearPicks();
  renderHourly();
  if ($('pastStats').open) renderPast();
}
function showTab(name) {
  if (name === 'count' && role !== 'admin') name = 'scan';
  if (name === 'count') ensurePast();
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  ['scan', 'lookup', 'count', 'settings'].forEach(t => { $(`tab-${t}`).hidden = t !== name; });
}
document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

// ---------- Naam van dit toestel ----------
function setName(v) {
  settings.name = v.trim().slice(0, 30);
  $('nameChipText').textContent = settings.name || 'naam instellen';
  if (document.activeElement !== $('scannerName')) $('scannerName').value = settings.name;
}
function openNameDialog() {
  $('nameInput').value = settings.name;
  $('nameDialog').hidden = false;
  setTimeout(() => $('nameInput').focus(), 50);
}
$('nameForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('nameInput').value.trim();
  if (!v) return;
  setName(v);
  $('nameDialog').hidden = true;
});
$('nameChip').addEventListener('click', openNameDialog);
let savedTimer;
$('scannerName').addEventListener('input', e => {
  setName(e.target.value);
  $('nameSaved').hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $('nameSaved').hidden = true; }, 1500);
});
setName(settings.name);

$('soundToggle').checked = settings.sound;
$('soundToggle').addEventListener('change', e => { settings.sound = e.target.checked; });
$('vibrateToggle').checked = settings.vibrate;
$('vibrateToggle').addEventListener('change', e => { settings.vibrate = e.target.checked; });

// ---------- Feedback ----------
let audioCtx = null;
function unlockAudio() {
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (_) {}
}
function beep(kind) {
  if (!settings.sound || !audioCtx) return;
  const tones = { ok: [[880, 0.12]], dup: [[440, 0.15], [440, 0.15]], bad: [[220, 0.4]] }[kind];
  let t = audioCtx.currentTime;
  for (const [f, d] of tones) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = f; o.type = 'square'; g.gain.value = 0.08;
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + d); t += d + 0.08;
  }
}
function buzz(kind) {
  if (settings.vibrate && navigator.vibrate) navigator.vibrate({ ok: 80, dup: [150, 80, 150], bad: [400] }[kind]);
}

// Resultaat blijft staan en het scannen pauzeert tot er bevestigd wordt.
let resultOpen = false;
function showResult(kind, title, detail, undoKey = null) {
  resultOpen = true;
  scanner.paused = true;
  const box = $('result');
  box.className = `result ${kind}`;
  $('resultTitle').textContent = title;
  $('resultDetail').textContent = detail || '';
  $('resultNext').textContent = kind === 'ok' ? '✔ Bevestig – volgende' : 'OK – volgende';
  $('resultUndo').hidden = !undoKey;
  $('resultUndo').dataset.key = undoKey || '';
  box.hidden = false;
  beep(kind); buzz(kind);
}
function closeResult() {
  $('result').hidden = true;
  resultOpen = false;
  last.t = Date.now();          // hetzelfde bandje dat nog voor de camera hangt, even negeren
  scanner.paused = false;
}
$('resultNext').addEventListener('click', closeResult);
$('resultUndo').addEventListener('click', async () => {
  if (await undo($('resultUndo').dataset.key, false)) closeResult();
});

// ---------- Laatste scans ----------
const RECENT_KEY = `sw.recent.${CONFIG.year}${DEMO ? '.demo' : ''}`;
const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
function addRecent(kind, label, key = null) {
  recent.unshift({ kind, label, key, t: Date.now() });
  recent.length = Math.min(recent.length, 50);
  saveRecent();
}
function saveRecent() { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); renderRecent(); }
function renderRecent() {
  const ul = $('recent');
  ul.replaceChildren();
  if (!recent.length) { ul.append(el('li', 'empty', 'Nog geen scans')); return; }
  for (const r of recent.slice(0, 20)) {
    const li = el('li', r.kind);
    li.append(el('span', 'time', fmtTime(new Date(r.t))), el('span', 'txt', r.label));
    if (r.kind === 'ok' && r.key && Date.now() - r.t < CONFIG.undoWindowSec * 1000) {
      const b = el('button', 'mini', '↶'); b.title = 'Ongedaan maken';
      b.addEventListener('click', () => undo(r.key, true));
      li.append(b);
    }
    ul.append(li);
  }
}
setInterval(renderRecent, 15000);

async function undo(key, ask) {
  if (!key) return false;
  if (ask && !confirm('Deze scan ongedaan maken? Het bandje staat dan terug als niet ingescand.')) return false;
  try {
    await store.undo(key);
    const r = recent.find(x => x.key === key && x.kind === 'ok');
    if (r) { r.kind = 'undone'; r.label += ' – ongedaan gemaakt'; }
    saveRecent();
    return true;
  } catch (err) {
    alert(err.code === 'permission-denied' ? `Ongedaan maken kan enkel binnen ${CONFIG.undoWindowSec / 60} minuten. Vraag de beheerder.` : `Mislukt: ${err.message}`);
    return false;
  }
}

// ---------- Verwerken van een scan ----------
const last = { text: null, t: 0 };
let busy = false;

function describeUsed(res) {
  if (res.status === 'history') {
    const d = res.first?.at;
    return `al ingescand op de Santa Walk ${res.first?.edition}${d ? ` (${fmtDate(d)})` : ''}`;
  }
  return `al ingescand ${isToday(res.first?.at) ? 'om' : 'op'} ${fmtWhen(res.first?.at)}${res.first?.by ? ` – ${res.first.by}` : ''}`;
}

async function handleCode(raw, { manual = false } = {}) {
  if (resultOpen || busy) return;
  const now = Date.now();
  if (!manual && raw === last.text && now - last.t < CONFIG.sameCodeCooldownMs) return;
  last.text = raw; last.t = now;

  const parsed = parseCode(raw, CONFIG);
  if (!parsed.ok) {
    showResult('bad', '✖ Ongeldig', parsed.reason);
    addRecent('bad', `${parsed.reason}: ${parsed.raw.slice(0, 40)}`);
    return;
  }

  busy = true;
  scanner.paused = true;
  try {
    const res = await store.register(parsed, settings.name);
    if (res.status === 'duplicate' || res.status === 'history') {
      const why = describeUsed(res);
      showResult('dup', `⚠ ${parsed.label}`, `${why} – geen pakje`);
      addRecent('dup', `${parsed.label} – ${why}`);
    } else {
      const queued = res.status === 'queued';
      showResult('ok', `✔ ${parsed.label}`, queued ? 'Pakje geven – offline, wordt later gesynchroniseerd' : 'Geldig – pakje geven', parsed.key);
      addRecent('ok', `${parsed.label}${queued ? ' (offline)' : ''}`, parsed.key);
    }
  } catch (err) {
    const msg = err.code === 'permission-denied' ? 'Geen schrijfrechten – opnieuw aanmelden?' : (err.message || 'Fout bij opslaan');
    showResult('bad', `${parsed.label} niet opgeslagen`, msg);
    addRecent('bad', `${parsed.label} – ${msg}`);
  } finally {
    busy = false;
  }
}

$('manualForm').addEventListener('submit', e => {
  e.preventDefault();
  unlockAudio();
  const v = $('manualInput').value.trim();
  if (v) handleCode(v, { manual: true });
  $('manualInput').value = '';
  $('manualInput').blur();
});

// Offline gescande code die later door de server geweigerd wordt (bv. intussen elders gescand).
store.onSyncError = (parsed, err) => {
  const r = recent.find(x => x.key === parsed.key && x.kind === 'ok');
  if (r) { r.kind = 'bad'; r.label += ' – NIET opgeslagen (server weigerde)'; saveRecent(); }
  alert(`Let op: ${parsed.label} werd offline als geldig getoond, maar de server weigerde de scan (${err.code || err.message}). Waarschijnlijk was het bandje al elders ingescand.`);
};

// ---------- Opzoeken (breed) ----------
function scansThisYear() {
  const m = new Map();
  for (const d of lastStats.docs) m.set(d.code, { at: db.toDate(d.scannedAt), by: d.scannedBy });
  if (store.dry) for (const [k, v] of store.dry) m.set(k, { ...v, demo: true });
  return m;
}

$('lookupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('lookupInput').value.trim();
  const out = $('lookupResult');
  out.hidden = false;
  out.replaceChildren(el('div', 'card muted', 'Zoeken…'));
  const keys = searchKeys(input, CONFIG);
  const parsed = parseCode(input, CONFIG);
  if (!keys.length) { out.replaceChildren(el('div', 'card lookup bad', '✖ Geen nummer gevonden in de invoer')); return; }

  try { await store.loadAllPast(); } catch (_) {}
  const now = scansThisYear();
  const hits = [];
  for (const k of keys) if (now.has(k)) { const v = now.get(k); hits.push({ edition: CONFIG.year, coll: v.demo ? 'oefenmodus (enkel dit toestel)' : CONFIG.collection, id: k, at: v.at, by: v.by, current: !v.demo }); }
  for (const [coll, rows] of store.past) {
    for (const r of rows) if (keys.includes(r.key) || keys.includes(r.id)) hits.push({ edition: r.edition, coll, id: r.id, at: r.at });
  }
  hits.sort((a, b) => b.edition - a.edition);

  const head = el('div', 'card lookup');
  if (parsed.ok) {
    const used = hits.find(h => keyMatches(h, parsed.key));
    head.classList.add(used ? 'dup' : 'ok');
    head.append(el('div', 'lk-title', used ? `⚠ ${parsed.label}: al ingescand` : `✔ ${parsed.label}: geldig, nog niet ingescand`));
    head.append(el('div', 'muted small', used
      ? `Santa Walk ${used.edition}${used.at ? ` – ${fmtWhen(used.at)}` : ''}${used.by ? ` – ${used.by}` : ''} → geen pakje`
      : 'Mag een pakje krijgen.'));
  } else {
    head.classList.add('bad');
    head.append(el('div', 'lk-title', `✖ "${input.slice(0, 30)}" is geen geldige bandjescode voor ${CONFIG.year}`));
    head.append(el('div', 'muted small', parsed.reason));
  }
  const list = el('div', 'card');
  list.append(el('h3', null, hits.length ? `Gevonden in de database (${hits.length})` : 'Niets gevonden in de database'));
  const ul = el('ul', 'hits');
  for (const h of hits) {
    const li = el('li');
    li.append(el('strong', null, `${h.edition}`), el('span', null, ` ${h.id}`), el('span', 'muted small', ` · ${h.coll}${h.at ? ` · ${fmtWhen(h.at)}` : ''}${h.by ? ` · ${h.by}` : ''}`));
    if (role === 'admin' && h.current) {
      const del = el('button', 'mini danger', 'Scan wissen');
      del.addEventListener('click', async () => {
        if (!confirm(`Scan van ${h.id} (${fmtWhen(h.at)}, ${h.by || '?'}) wissen? Het bandje kan daarna opnieuw gescand worden.`)) return;
        try { await store.undo(h.id); li.remove(); } catch (err) { alert(`Wissen mislukt: ${err.code || err.message}`); }
      });
      li.append(' ', del);
    }
    ul.append(li);
  }
  if (hits.length) list.append(ul);
  list.append(el('p', 'muted small', `Gezocht op: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ` en ${keys.length - 3} varianten` : ''}`));
  out.replaceChildren(head, list);
});
function keyMatches(h, key) {
  // Alleen sleutels die voor dit jaar als "gebruikt" tellen (zelfde regel als bij scannen).
  return (h.id === key || h.key === key || (/^\d+$/.test(key) && h.id === key)) &&
    (h.edition === CONFIG.year || CONFIG.historyCollections.includes(h.coll));
}

// ---------- Camera ----------
const scanner = new QrScanner($('video'), text => handleCode(text));
window.__santaWalk = { handleCode, scanner, store, parseCode, closeResult };

async function startCamera() {
  unlockAudio();
  $('camError').hidden = true;
  if (!QrScanner.supported()) {
    return camError('Camera niet beschikbaar. Open de link via https in Safari (iPhone) of Chrome (Android).');
  }
  $('startBtn').disabled = true;
  try {
    await scanner.start();
    $('startBtn').hidden = true;
    $('stopBtn').hidden = false;
    await refreshCameraControls();
  } catch (e) {
    const msgs = {
      NotAllowedError: 'Camera-toegang geweigerd. iPhone: Instellingen › Safari › Camera › Sta toe. Android: tik op het slotje naast het adres › Camera. Herlaad daarna.',
      NotFoundError: 'Geen camera gevonden.',
      NotReadableError: 'Camera is in gebruik door een andere app. Sluit die en probeer opnieuw.',
    };
    camError(msgs[e.name] || `Camera starten mislukt: ${e.message || e.name}`);
  } finally {
    $('startBtn').disabled = false;
  }
}
function camError(msg) { $('camError').textContent = msg; $('camError').hidden = false; $('startBtn').hidden = false; }

async function refreshCameraControls() {
  const cams = await scanner.listCameras();
  const sel = $('cameraSelect');
  sel.replaceChildren(...cams.map((c, i) => {
    const o = el('option', null, c.label || `Camera ${i + 1}`);
    o.value = c.deviceId; o.selected = c.deviceId === scanner.deviceId;
    return o;
  }));
  sel.hidden = cams.length < 2;
  const caps = scanner.capabilities();
  $('torchBtn').hidden = !caps.torch;
  $('torchBtn').classList.remove('on');
  if (caps.zoom && caps.zoom.max > caps.zoom.min) {
    const z = $('zoom');
    z.min = caps.zoom.min; z.max = Math.min(caps.zoom.max, 5); z.step = caps.zoom.step || 0.1; z.value = caps.zoom.min;
    $('zoomWrap').hidden = false;
  } else $('zoomWrap').hidden = true;
}

$('startBtn').addEventListener('click', startCamera);
$('stopBtn').addEventListener('click', async () => {
  await scanner.stop();
  $('stopBtn').hidden = true; $('startBtn').hidden = false; $('torchBtn').hidden = true; $('zoomWrap').hidden = true;
});
$('cameraSelect').addEventListener('change', async e => {
  try { await scanner.switchTo(e.target.value); await refreshCameraControls(); } catch (err) { camError(err.message); }
});
$('torchBtn').addEventListener('click', async () => {
  const on = !$('torchBtn').classList.contains('on');
  try { await scanner.setTorch(on); $('torchBtn').classList.toggle('on', on); } catch (_) {}
});
$('zoom').addEventListener('input', e => scanner.setZoom(e.target.value).catch(() => {}));

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !scanner.running) return;
  if (!(scanner.track && scanner.track.readyState === 'live')) {
    try { await scanner.start(scanner.deviceId); await refreshCameraControls(); } catch (e) { camError(e.message); }
  }
  scanner.reacquireWakeLock();
});

// ---------- Toestel-check ----------
$('checkBtn').addEventListener('click', async () => {
  const yes = v => (v ? '✔' : '✖');
  const caps = scanner.capabilities();
  let cams = [];
  try { cams = await scanner.listCameras(); } catch (_) {}
  const ua = navigator.userAgent;
  fillTable('checkTable', [
    ['Browser', ua.match(/(CriOS|FxiOS|EdgiOS|Edg|SamsungBrowser|Firefox|Chrome|Version)\/[\d.]+/g)?.join(' ') || ua.slice(0, 60)],
    ['Toestel', /iPhone|iPad/.test(ua) ? 'iOS' : /Android [\d.]+/.exec(ua)?.[0] || navigator.platform],
    ['Beveiligde verbinding (https)', yes(window.isSecureContext)],
    ['Camera-toegang', yes(QrScanner.supported())],
    ['Camera actief', yes(scanner.running)],
    ['Aantal camera\'s', cams.length || '?'],
    ['Scan-engine', scanner.engine === 'native' ? 'ingebouwd (snel)' : scanner.engine === 'wasm' ? 'ZXing WebAssembly' : 'start eerst de camera'],
    ['Resolutie', scanner.track ? `${$('video').videoWidth}×${$('video').videoHeight}` : '–'],
    ['Lamp', yes(caps.torch)],
    ['Zoom', yes(caps.zoom)],
    ['Scherm blijft aan', yes('wakeLock' in navigator)],
    ['Trillen', yes('vibrate' in navigator)],
    ['Online', yes(navigator.onLine)],
  ]);
});

// ---------- Teller ----------
function bandType(d) {
  const code = String(d.code || '');
  if (code.startsWith('santa_walk_')) return `Bandjes ${code.slice(11, 15)}`;
  const n = parseInt(code, 10);
  if (n >= NEW.from && n <= NEW.to) return 'new';
  if (n >= CONFIG.uniqueFrom && n < NEW.from) return `Bandjes 2025 (${CONFIG.uniqueFrom}–${NEW.from - 1})`;
  return 'Andere';
}

function renderStats({ total, pending, fromCache, docs }) {
  lastStats = { total, docs };
  $('countBadge').textContent = `🎁 ${total}`;
  $('totalCount').textContent = total;
  $('syncInfo').textContent = DEMO ? 'Oefenmodus: toont enkel echte scans' : pending ? 'Bezig met synchroniseren…' : fromCache ? 'Offline – laatst gekende stand' : 'Live';

  const types = new Map();
  for (const d of docs) { const t = bandType(d); types.set(t, (types.get(t) || 0) + 1); }
  const newCount = types.get('new') || 0;
  types.delete('new');
  const oldCount = total - newCount;
  $('newCount').textContent = `${newCount} / ${NEW_TOTAL}`;
  $('newMeter').style.width = `${Math.min(100, (newCount / NEW_TOTAL) * 100)}%`;
  $('newInfo').textContent = `${NEW_TOTAL - newCount} nieuwe bandjes nog niet gescand`;
  $('oldCount').textContent = oldCount;
  $('oldInfo').textContent = oldCount ? [...types].sort().map(([k, v]) => `${k}: ${v}`).join(' · ') : 'Bandjes 2023, 2024 en 2025 (1501–2250)';

  const left = giftStock - total;
  $('stockLeft').textContent = left;
  $('stockLeft').classList.toggle('low', left <= CONFIG.giftStockWarnAt);
  $('stockInfo').textContent = `Startvoorraad ${giftStock} – één pakje per ingescand bandje, nieuw én oud`;

  const per = new Map();
  for (const d of docs) { const by = d.scannedBy || '?'; per.set(by, (per.get(by) || 0) + 1); }
  fillTable('perScanner', [...per].sort((a, b) => b[1] - a[1]));
  renderHourly();
  if ($('pastStats').open && pastLoaded) renderPast();
}
function fillTable(id, rows) {
  $(id).tBodies[0].replaceChildren(...rows.map(([k, ...vals]) => {
    const tr = el('tr'); tr.append(el('td', null, k), ...vals.map(v => el('td', 'num', v))); return tr;
  }));
}
function showStatsError(err) {
  $('syncInfo').textContent = err.code === 'permission-denied' ? 'Geen leesrechten op de teller' : `Fout: ${err.message}`;
}

// ---------- Aankomsten per uur: alle edities in één grafiek, aan/uit te vinken ----------
// Elke editie valt (bijna) op één dag; testscans op andere dagen tellen niet mee:
// per editie nemen we de dag met de meeste scans ("hoofddag").
const YEAR_COLORS = { 2026: '#b3261e', 2025: '#1e4a37', 2024: '#c9a227', 2023: '#4f6d8a', 2022: '#8a5a44', 2019: '#7b5ea7', 2018: '#7d8580' };
const yearColor = y => YEAR_COLORS[y] || '#999';
const picked = new Set(JSON.parse(localStorage.getItem('sw.chartYears') || 'null') || [CONFIG.year, CONFIG.year - 1, CONFIG.year - 2]);
let chartMode = 'count';

function mainDay(dates) {
  const byDay = new Map();
  for (const d of dates) { const k = d.toDateString(); byDay.set(k, (byDay.get(k) || 0) + 1); }
  let best = null, n = 0;
  for (const [k, c] of byDay) if (c > n) { best = k; n = c; }
  return best ? { day: best, dates: dates.filter(d => d.toDateString() === best), other: dates.length - n } : { day: null, dates: [], other: 0 };
}
function perHour(dates) { const h = new Array(24).fill(0); for (const d of dates) h[d.getHours()]++; return h; }
function datesOf(year) {
  if (year === CONFIG.year) return lastStats.docs.map(d => db.toDate(d.scannedAt)).filter(Boolean);
  const out = [];
  for (const rows of store.past.values()) for (const r of rows) if (r.edition === year && r.at) out.push(r.at);
  return out;
}
function availableYears() {
  const years = new Set([CONFIG.year]);
  for (const rows of store.past.values()) for (const r of rows) if (r.at && r.edition) years.add(r.edition);
  return [...years].sort((a, b) => b - a);
}
function renderYearPicks() {
  const box = $('yearPicks');
  box.replaceChildren(...availableYears().map(y => {
    const lab = el('label', 'pick');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = picked.has(y);
    cb.addEventListener('change', () => {
      cb.checked ? picked.add(y) : picked.delete(y);
      localStorage.setItem('sw.chartYears', JSON.stringify([...picked]));
      renderHourly();
    });
    const sw = el('span', 'swatch'); sw.style.background = yearColor(y);
    lab.append(cb, sw, el('span', null, y));
    return lab;
  }));
}
function setMode(m) {
  chartMode = m;
  $('modeCount').classList.toggle('active', m === 'count');
  $('modePct').classList.toggle('active', m === 'pct');
  renderHourly();
}
$('modeCount').addEventListener('click', () => setMode('count'));
$('modePct').addEventListener('click', () => setMode('pct'));

function renderHourly() {
  const years = availableYears().filter(y => picked.has(y));
  const series = years.map(y => {
    const md = mainDay(datesOf(y));
    const counts = perHour(md.dates);
    const total = md.dates.length || 1;
    return { y, md, counts, vals: counts.map(c => chartMode === 'pct' ? (c / total) * 100 : c) };
  }).filter(s => s.md.day);
  const used = [...Array(24).keys()].filter(h => series.some(s => s.counts[h]));
  const from = used.length ? Math.min(...used) : 14, to = used.length ? Math.max(...used) : 20;
  const hours = []; for (let h = from; h <= to; h++) hours.push(h);
  const max = Math.max(chartMode === 'pct' ? 10 : 5, ...series.flatMap(s => hours.map(h => s.vals[h])));

  const W = 640, H = 260, padL = 66, padR = 24, padB = 34, padT = 14;
  const step = hours.length > 1 ? (W - padL - padR) / (hours.length - 1) : 0;
  const x = i => hours.length > 1 ? padL + i * step : (W + padL) / 2;
  const y = v => H - padB - (v / max) * (H - padB - padT);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const add = (parent, tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = text; parent.append(n); return n; };
  for (const t of [0, 0.5, 1]) {
    const v = max * t, yy = y(v);
    add(svg, 'line', { x1: padL, x2: W - padR, y1: yy, y2: yy, class: 'grid' });
    add(svg, 'text', { x: padL - 8, y: yy + 7, class: 'axis', 'text-anchor': 'end' }, chartMode === 'pct' ? `${Math.round(v)}%` : Math.round(v));
  }
  hours.forEach((h, i) => add(svg, 'text', { x: x(i), y: H - 6, class: 'axis', 'text-anchor': 'middle' }, `${h}u`));
  for (const s of series) {
    const pts = hours.map((h, i) => `${x(i).toFixed(1)},${y(s.vals[h]).toFixed(1)}`).join(' ');
    add(svg, 'polyline', { points: pts, fill: 'none', stroke: yearColor(s.y), 'stroke-width': s.y === CONFIG.year ? 4 : 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    hours.forEach((h, i) => {
      const c = add(svg, 'circle', { cx: x(i), cy: y(s.vals[h]), r: 4, fill: yearColor(s.y) });
      add(c, 'title', {}, `${s.y} ${h}u: ${s.counts[h]} scans (${Math.round(s.counts[h] / (s.md.dates.length || 1) * 100)}%)`);
    });
  }
  $('hourChart').replaceChildren(svg);

  const info = [];
  for (const s of series) {
    let ph = -1, pv = 0; s.counts.forEach((c, h) => { if (c > pv) { pv = c; ph = h; } });
    info.push(`${s.y}${s.y === CONFIG.year ? ' (tot nu)' : ''}: drukste uur ${ph}u–${ph + 1}u (${pv} van ${s.md.dates.length}, ${fmtDate(new Date(s.md.day))})${s.md.other ? `, ${s.md.other} scans op andere dagen niet meegeteld` : ''}`);
  }
  if (!series.length) info.push(pastLoaded ? 'Vink minstens één editie met tijdstippen aan.' : 'Vorige edities laden…');
  $('hourInfo').replaceChildren(...info.map(t => el('div', null, t)));

  $('hourHead').replaceChildren(el('th', null, 'Uur'), ...series.map(s => el('th', 'num', s.y)));
  fillTable('hourTable', hours.map(h => [`${String(h).padStart(2, '0')}:00`, ...series.map(s => chartMode === 'pct' ? `${s.vals[h].toFixed(0)}%` : s.counts[h])]));
}

// ---------- Vorige edities ----------
$('pastStats').addEventListener('toggle', async () => {
  if (!$('pastStats').open) return;
  if (!pastLoaded) { $('pastBody').textContent = 'Laden…'; await ensurePast(); }
  if (pastLoaded) renderPast();
});

function renderPast() {
  const editions = new Map(); // jaar -> {count, colls: Map, nums: [], plain, prefixed}
  const thisYear = new Set(lastStats.docs.map(d => d.code));
  for (const [coll, rows] of store.past) {
    for (const r of rows) {
      const y = r.edition || parseInt(coll.slice(-4), 10);
      if (!editions.has(y)) editions.set(y, { count: 0, colls: new Map(), nums: [], plain: 0, prefixed: 0, keys: [] });
      const e = editions.get(y);
      e.count++;
      e.colls.set(coll, (e.colls.get(coll) || 0) + 1);
      const n = parseInt(String(r.id).match(/(\d+)$/)?.[1], 10);
      if (Number.isFinite(n)) e.nums.push(n);
      if (/^\d+$/.test(r.id)) e.plain++; else e.prefixed++;
      if (r.key) e.keys.push(r.key);
    }
  }
  const body = $('pastBody');
  body.className = '';
  body.replaceChildren();
  const table = el('table', 'past');
  const tb = el('tbody');
  const cur = el('tr', 'current'); cur.append(el('td', null, `${CONFIG.year} (nu)`), el('td', 'num', lastStats.total)); tb.append(cur);
  for (const [y, e] of [...editions].sort((a, b) => b[0] - a[0])) {
    const tr = el('tr', 'clickable'); tr.append(el('td', null, `${y} ›`), el('td', 'num', e.count));
    const det = el('tr', 'detail'); det.hidden = true;
    const td = el('td'); td.colSpan = 2;
    const min = Math.min(...e.nums), max = Math.max(...e.nums);
    const lines = [
      `Collectie: ${[...e.colls].map(([c, n]) => `${c} (${n})`).join(', ')}`,
      `Nummers: ${e.nums.length ? `${min}–${max}` : '–'}`,
      `QR-formaat: ${e.plain && e.prefixed ? `${e.prefixed}× santa_walk_${y}_<nr>, ${e.plain}× enkel nummer` : e.plain ? 'enkel nummer' : `santa_walk_${y}_<nr>`}`,
    ];
    if (e.nums.length && y >= Math.min(...CONFIG.prefixedYears)) {
      const seen = new Set(e.nums);
      const never = max - min + 1 - seen.size;
      lines.push(`Nummers tussen ${min} en ${max} die toen niet gescand zijn: ${never} (bandjes die nog geldig kunnen opduiken)`);
      const again = e.keys.filter(k => thisYear.has(k)).length;
      if (again) lines.push(`⚠ ${again} hiervan dit jaar opnieuw gescand (zou geweigerd moeten zijn)`);
    }
    for (const l of lines) td.append(el('div', 'small', l));
    det.append(td);
    tr.addEventListener('click', () => { det.hidden = !det.hidden; });
    tb.append(tr, det);
  }
  table.append(tb);
  const totalAll = [...editions.values()].reduce((s, e) => s + e.count, 0) + lastStats.total;
  body.append(table, el('p', 'muted small', `Totaal alle edities: ${totalAll}. Tik op een jaar voor details.`));
}

$('boardBtn').addEventListener('click', () => {
  $('bigBoard').classList.add('full'); $('boardClose').hidden = false;
  document.documentElement.requestFullscreen?.().catch(() => {});
});
$('boardClose').addEventListener('click', () => {
  $('bigBoard').classList.remove('full'); $('boardClose').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen?.();
});

$('exportBtn').addEventListener('click', () => {
  const rows = [['code', 'nummer', 'soort', 'tijdstip', 'scanner']];
  for (const d of lastStats.docs) {
    const at = db.toDate(d.scannedAt);
    const t = bandType(d);
    rows.push([d.code || '', d.ID || '', t === 'new' ? `Nieuw ${CONFIG.year}` : t, at ? at.toISOString() : '', d.scannedBy || '']);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = el('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `${CONFIG.collection}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- Netwerkstatus ----------
function renderNet() { $('netDot').classList.toggle('offline', !navigator.onLine); $('netDot').title = navigator.onLine ? 'Online' : 'Offline'; }
addEventListener('online', renderNet); addEventListener('offline', renderNet); renderNet();
renderRecent();

// ---------- Start: aanmeldstatus bepaalt wat zichtbaar is ----------
let unwatch = null;
async function afterLogin() {
  unwatch = store.watch(renderStats, showStatsError);
  if (!settings.name) openNameDialog();
  const s = await store.settings();
  if (Number.isFinite(s.giftStock)) { giftStock = s.giftStock; renderStats({ ...lastStats, pending: false, fromCache: false }); }
  const h = await store.loadHistory();
  $('infoHistory').textContent = `${h.size} bandjes van ${CONFIG.historyCollections.map(c => c.slice(11)).join(', ')}${h.loaded ? '' : ' (onvolledig)'}`;
  $('historyBanner').hidden = h.loaded;
  if (!h.loaded) $('historyBanner').textContent = '⚠ Historiek vorige jaren niet (volledig) geladen – oude bandjes worden mogelijk niet herkend als al ingescand. Herlaad met netwerk.';
}

function applyRole() {
  document.body.classList.toggle('is-admin', role === 'admin');
  document.querySelectorAll('.admin-only').forEach(e => { e.hidden = role !== 'admin'; });
  if (role !== 'admin' && !$('tab-count').hidden) showTab('scan');
  $('roleInfo').textContent = role === 'admin'
    ? 'Aangemeld als beheerder: stats, export en scans wissen beschikbaar.'
    : 'Aangemeld als scanner. Statistieken zijn enkel zichtbaar voor beheerders.';
}

store.onUser(user => {
  role = user ? store.roleOf(user) : 'scanner';
  applyRole();
  const needLogin = CONFIG.requireLogin && DEMO !== 'local' && !user;
  $('loginView').hidden = !needLogin;
  $('mainView').hidden = needLogin;
  if (!needLogin && !unwatch) afterLogin();
  if (needLogin) {
    if (unwatch) { unwatch(); unwatch = null; }
    scanner.stop();
    if (hashCode) tryLogin(hashCode);
  }
});
