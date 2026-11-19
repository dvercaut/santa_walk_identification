import { CONFIG } from './config.js';
import { parseCode } from './codes.js';
import { QrScanner } from './scanner.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo');          // '1' = oefenmodus met echte historiek, 'local' = volledig lokaal (tests)
const fmtTime = d => d ? d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : '?';
const fmtDate = d => d ? d.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const isToday = d => d && d.toDateString() === new Date().toDateString();
const fmtWhen = d => !d ? '' : isToday(d) ? fmtTime(d) : `${fmtDate(d)} ${fmtTime(d)}`;

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
  store = new db.MemoryStore(CONFIG, { 'santa_walk_2024_100': '2024', '1501': '2025', 'santa_walk_2023_10': '2023' });
} else {
  store = new db.FirestoreStore(CONFIG, { dryRun: !!DEMO });
}
if (DEMO) { $('demoBanner').hidden = false; $('demoLink').hidden = true; }

$('title').textContent = `Santa Walk ${CONFIG.year}`;
document.querySelectorAll('.yearLabel').forEach(e => { e.textContent = CONFIG.year; });
$('infoCollection').textContent = CONFIG.collection;
$('infoCodes').textContent = `${CONFIG.plainMin}–${CONFIG.plainMax} en santa_walk_${CONFIG.prefixedYears.join('/')}_<nr>`;

let giftStock = CONFIG.giftStock;
let lastStats = { total: 0, docs: [] };

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
function showTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  ['scan', 'lookup', 'count', 'settings'].forEach(t => { $(`tab-${t}`).hidden = t !== name; });
}
document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

// ---------- Instellingen-UI ----------
$('scannerName').value = settings.name;
$('scannerName').addEventListener('change', e => { settings.name = e.target.value.trim(); });
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

let resultTimer;
function showResult(kind, title, detail, undoKey = null) {
  const el = $('result');
  el.className = `result ${kind}`;
  $('resultTitle').textContent = title;
  $('resultDetail').textContent = detail || '';
  $('resultUndo').hidden = !undoKey;
  $('resultUndo').dataset.key = undoKey || '';
  el.hidden = false;
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => { el.hidden = true; }, kind === 'ok' ? 2000 : 3500);
  beep(kind); buzz(kind);
}
$('result').addEventListener('click', e => { if (e.target.id !== 'resultUndo') $('result').hidden = true; });
$('resultUndo').addEventListener('click', () => undo($('resultUndo').dataset.key));

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
  if (!recent.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Nog geen scans'; ul.append(li); return; }
  for (const r of recent.slice(0, 20)) {
    const li = document.createElement('li');
    li.className = r.kind;
    const time = document.createElement('span'); time.className = 'time'; time.textContent = fmtTime(new Date(r.t));
    const txt = document.createElement('span'); txt.className = 'txt'; txt.textContent = r.label;
    li.append(time, txt);
    if (r.kind === 'ok' && r.key && Date.now() - r.t < CONFIG.undoWindowSec * 1000) {
      const b = document.createElement('button'); b.className = 'mini'; b.textContent = '↶';
      b.title = 'Ongedaan maken'; b.addEventListener('click', () => undo(r.key));
      li.append(b);
    }
    ul.append(li);
  }
}
setInterval(renderRecent, 15000); // undo-knoppen laten verdwijnen na het venster

async function undo(key) {
  if (!key || !confirm('Deze scan ongedaan maken? Het bandje wordt terug als niet-uitgeleverd gezet.')) return;
  try {
    await store.undo(key);
    const r = recent.find(x => x.key === key && x.kind === 'ok');
    if (r) { r.kind = 'undone'; r.label += ' – ongedaan gemaakt'; }
    saveRecent();
    $('result').hidden = true;
  } catch (err) {
    alert(err.code === 'permission-denied' ? `Ongedaan maken kan enkel binnen ${CONFIG.undoWindowSec / 60} minuten. Vraag de beheerder.` : `Mislukt: ${err.message}`);
  }
}

// ---------- Verwerken van een scan ----------
let last = { text: null, t: 0 };
let busy = false;

function describeUsed(res) {
  if (res.status === 'history') {
    const d = res.first?.at;
    return `al uitgeleverd op de Santa Walk ${res.first?.edition}${d ? ` (${fmtDate(d)})` : ''}`;
  }
  return `al uitgeleverd ${isToday(res.first?.at) ? 'om' : 'op'} ${fmtWhen(res.first?.at)}${res.first?.by ? ` – ${res.first.by}` : ''}`;
}

async function handleCode(raw, { manual = false } = {}) {
  const now = Date.now();
  if (!manual && raw === last.text && now - last.t < CONFIG.sameCodeCooldownMs) return;
  if (busy) return;
  last = { text: raw, t: now };

  const parsed = parseCode(raw, CONFIG);
  if (!parsed.ok) {
    showResult('bad', '✖ Ongeldig', parsed.reason);
    addRecent('bad', `${parsed.reason}: ${parsed.raw.slice(0, 40)}`);
    return;
  }

  busy = true;
  try {
    const res = await store.register(parsed, settings.name);
    if (res.status === 'duplicate' || res.status === 'history') {
      const why = describeUsed(res);
      showResult('dup', `⚠ ${parsed.label}`, why);
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
});

// ---------- Opzoeken ----------
$('lookupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const out = $('lookupResult');
  const parsed = parseCode($('lookupInput').value, CONFIG);
  out.hidden = false;
  out.className = 'card lookup';
  if (!parsed.ok) { out.classList.add('bad'); out.textContent = `✖ ${parsed.reason}`; return; }
  out.textContent = 'Zoeken…';
  try {
    const res = await store.lookup(parsed);
    if (res.status === 'free') { out.classList.add('ok'); out.textContent = `✔ ${parsed.label}: nog niet uitgeleverd`; }
    else { out.classList.add('dup'); out.textContent = `⚠ ${parsed.label}: ${describeUsed(res)}`; }
  } catch (err) {
    out.classList.add('bad'); out.textContent = `Opzoeken mislukt: ${err.message}`;
  }
});

// ---------- Camera ----------
const scanner = new QrScanner($('video'), text => handleCode(text));
window.__santaWalk = { handleCode, scanner, store, parseCode };

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
    const o = document.createElement('option');
    o.value = c.deviceId; o.textContent = c.label || `Camera ${i + 1}`;
    o.selected = c.deviceId === scanner.deviceId;
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
  const rows = [
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
  ];
  $('checkTable').tBodies[0].replaceChildren(...rows.map(([k, v]) => {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = k;
    const b = document.createElement('td'); b.textContent = v; b.className = 'num';
    tr.append(a, b); return tr;
  }));
});

// ---------- Teller ----------
function renderStats({ total, pending, fromCache, docs }) {
  lastStats = { total, docs };
  $('countBadge').textContent = `🎁 ${total}`;
  $('totalCount').textContent = total;
  $('syncInfo').textContent = DEMO ? 'Oefenmodus: enkel echte scans' : pending ? 'Bezig met synchroniseren…' : fromCache ? 'Offline – laatst gekende stand' : 'Live';

  const left = giftStock - total;
  $('stockLeft').textContent = left;
  $('stockInfo').textContent = `van ${giftStock} bij de start`;
  const low = left <= CONFIG.giftStockWarnAt;
  $('stockLeft').classList.toggle('low', low);
  $('stockBadge').hidden = false;
  $('stockBadge').textContent = `📦 ${left}`;
  $('stockBadge').classList.toggle('low', low);

  const per = new Map(), types = new Map(), buckets = new Map();
  for (const d of docs) {
    const by = d.scannedBy || '?';
    per.set(by, (per.get(by) || 0) + 1);
    const n = parseInt(d.ID, 10);
    const type = String(d.code || '').startsWith('santa_walk_') ? `Oud (${d.code.slice(11, 15)})`
      : n >= 2251 ? 'Nieuw 2026 (2251+)' : n >= 1501 ? 'Over van 2025 (1501-2250)' : 'Andere';
    types.set(type, (types.get(type) || 0) + 1);
    const at = db.toDate(d.scannedAt);
    if (at) {
      const k = new Date(at); k.setMinutes(Math.floor(k.getMinutes() / 15) * 15, 0, 0);
      buckets.set(+k, (buckets.get(+k) || 0) + 1);
    }
  }
  fillTable('perScanner', [...per].sort((a, b) => b[1] - a[1]));
  fillTable('perType', [...types].sort((a, b) => b[1] - a[1]));

  const max = Math.max(1, ...buckets.values());
  $('timeline').replaceChildren(...[...buckets].sort((a, b) => a[0] - b[0]).map(([k, c]) => {
    const row = document.createElement('div'); row.className = 'bar-row';
    const l = document.createElement('span'); l.textContent = fmtTime(new Date(k));
    const bar = document.createElement('span'); bar.className = 'bar'; bar.style.width = `${(c / max) * 100}%`;
    const n = document.createElement('span'); n.className = 'num'; n.textContent = c;
    row.append(l, bar, n); return row;
  }));
}
function fillTable(id, rows) {
  $(id).tBodies[0].replaceChildren(...rows.map(([k, v]) => {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = k;
    const b = document.createElement('td'); b.textContent = v; b.className = 'num';
    tr.append(a, b); return tr;
  }));
}
function showStatsError(err) {
  $('syncInfo').textContent = err.code === 'permission-denied' ? 'Geen leesrechten op de teller' : `Fout: ${err.message}`;
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
  const rows = [['code', 'nummer', 'tijdstip', 'scanner']];
  for (const d of lastStats.docs) {
    const at = db.toDate(d.scannedAt);
    rows.push([d.code || '', d.ID || '', at ? at.toISOString() : '', d.scannedBy || '']);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
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
  const s = await store.settings();
  if (Number.isFinite(s.giftStock)) { giftStock = s.giftStock; renderStats({ ...lastStats, pending: false, fromCache: false }); }
  const h = await store.loadHistory();
  $('infoHistory').textContent = `${h.size} bandjes van ${CONFIG.historyCollections.map(c => c.slice(11)).join(', ')}${h.loaded ? '' : ' (onvolledig)'}`;
  $('historyBanner').hidden = h.loaded;
  if (!h.loaded) $('historyBanner').textContent = '⚠ Historiek vorige jaren niet (volledig) geladen – oude bandjes worden mogelijk niet herkend als uitgeleverd. Herlaad met netwerk.';
}

store.onUser(user => {
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
