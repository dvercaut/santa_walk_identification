import { CONFIG } from './config.js';
import { parseCode } from './codes.js';
import { QrScanner } from './scanner.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');

// ---------- Instellingen (lokaal per toestel) ----------
const settings = {
  get name() { return localStorage.getItem('sw.name') || ''; },
  set name(v) { localStorage.setItem('sw.name', v); },
  get sound() { return localStorage.getItem('sw.sound') !== '0'; },
  set sound(v) { localStorage.setItem('sw.sound', v ? '1' : '0'); },
  get vibrate() { return localStorage.getItem('sw.vibrate') !== '0'; },
  set vibrate(v) { localStorage.setItem('sw.vibrate', v ? '1' : '0'); },
};

// ---------- Opslag ----------
let store;
if (DEMO) {
  const { MemoryStore } = await import('./db.js');
  store = new MemoryStore(CONFIG);
  $('demoBanner').hidden = false;
} else {
  const { FirestoreStore } = await import('./db.js');
  store = new FirestoreStore(CONFIG);
}

$('title').textContent = `Santa Walk ${CONFIG.year}`;
$('yearLabel').textContent = CONFIG.year;
$('infoCollection').textContent = CONFIG.collection;
$('infoPrefix').textContent = `${CONFIG.codePrefix}${CONFIG.idMin} … ${CONFIG.codePrefix}${CONFIG.idMax}`;

// ---------- Login ----------
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    await store.login($('loginEmail').value.trim(), $('loginPw').value);
  } catch (err) {
    const map = {
      'auth/invalid-credential': 'E-mail of wachtwoord fout.',
      'auth/too-many-requests': 'Te veel pogingen, probeer straks opnieuw.',
      'auth/operation-not-allowed': 'E-mail/wachtwoord-login staat niet aan in Firebase.',
      'auth/network-request-failed': 'Geen netwerk.',
    };
    $('loginError').textContent = map[err.code] || `Aanmelden mislukt (${err.code || err.message}).`;
  }
});
$('logoutBtn').addEventListener('click', () => store.logout());

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
  ['scan', 'count', 'settings'].forEach(t => { $(`tab-${t}`).hidden = t !== btn.dataset.tab; });
}));

// ---------- Instellingen-UI ----------
$('scannerName').value = settings.name;
$('scannerName').addEventListener('change', e => { settings.name = e.target.value.trim(); });
$('soundToggle').checked = settings.sound;
$('soundToggle').addEventListener('change', e => { settings.sound = e.target.checked; });
$('vibrateToggle').checked = settings.vibrate;
$('vibrateToggle').addEventListener('change', e => { settings.vibrate = e.target.checked; });

const fmtTime = d => d ? d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : '?';
let lastDocs = [];

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
  if (!settings.vibrate || !navigator.vibrate) return;
  navigator.vibrate({ ok: 80, dup: [150, 80, 150], bad: [400] }[kind]);
}

let resultTimer;
function showResult(kind, title, detail) {
  const el = $('result');
  el.className = `result ${kind}`;
  $('resultTitle').textContent = title;
  $('resultDetail').textContent = detail || '';
  el.hidden = false;
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => { el.hidden = true; }, kind === 'ok' ? 1500 : 3000);
  beep(kind); buzz(kind);
}

const recent = JSON.parse(localStorage.getItem(`sw.recent.${CONFIG.year}`) || '[]');
function addRecent(kind, label) {
  recent.unshift({ kind, label, t: Date.now() });
  recent.length = Math.min(recent.length, 50);
  localStorage.setItem(`sw.recent.${CONFIG.year}`, JSON.stringify(recent));
  renderRecent();
}
function renderRecent() {
  const ul = $('recent');
  ul.replaceChildren();
  if (!recent.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Nog geen scans'; ul.append(li); return; }
  for (const r of recent.slice(0, 15)) {
    const li = document.createElement('li');
    li.className = r.kind;
    const time = document.createElement('span'); time.className = 'time'; time.textContent = fmtTime(new Date(r.t));
    const txt = document.createElement('span'); txt.textContent = r.label;
    li.append(time, txt);
    ul.append(li);
  }
}
renderRecent();


// ---------- Verwerken van een scan ----------
let last = { text: null, t: 0 };
let busy = false;

async function handleCode(raw, { manual = false } = {}) {
  const now = Date.now();
  if (!manual && raw === last.text && now - last.t < CONFIG.sameCodeCooldownMs) return; // camera ziet hetzelfde bandje nog
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
    const res = await store.register(parsed.code, parsed.id, settings.name);
    if (res.status === 'duplicate') {
      const when = `al gescand om ${fmtTime(res.first?.at)} (${res.first?.by})`;
      showResult('dup', `⚠ Nr ${parsed.id}`, when);
      addRecent('dup', `Nr ${parsed.id} – ${when}`);
    } else {
      showResult('ok', `✔ Nr ${parsed.id}`, res.status === 'queued' ? 'Geldig – offline, wordt later gesynchroniseerd' : 'Geldig');
      addRecent('ok', `Nr ${parsed.id}${res.status === 'queued' ? ' (offline)' : ''}`);
    }
  } catch (err) {
    const msg = err.code === 'permission-denied' ? 'Geen schrijfrechten – opnieuw aanmelden?' : (err.message || 'Fout bij opslaan');
    showResult('bad', `Nr ${parsed.id} niet opgeslagen`, msg);
    addRecent('bad', `Nr ${parsed.id} – ${msg}`);
  } finally {
    busy = false;
  }
}

$('manualForm').addEventListener('submit', e => {
  e.preventDefault();
  unlockAudio();
  const v = $('manualInput').value.trim();
  if (!v) return;
  handleCode(/^\d+$/.test(v) ? `${CONFIG.codePrefix}${v}` : v, { manual: true });
  $('manualInput').value = '';
});

// ---------- Camera ----------
const scanner = new QrScanner($('video'), text => handleCode(text));
window.__santaWalk = { handleCode, scanner, store }; // voor debugging/tests

async function startCamera() {
  unlockAudio();
  $('camError').hidden = true;
  if (!QrScanner.supported()) {
    return camError('Camera niet beschikbaar. Open de pagina via https in Safari (iPhone) of Chrome (Android).');
  }
  $('startBtn').disabled = true;
  try {
    await scanner.start();
    $('startBtn').hidden = true;
    $('stopBtn').hidden = false;
    $('infoEngine').textContent = scanner.engine === 'native' ? 'ingebouwd (BarcodeDetector)' : 'ZXing WebAssembly';
    await refreshCameraControls();
  } catch (e) {
    const msgs = {
      NotAllowedError: 'Toegang tot de camera geweigerd. Sta camera toe in de browserinstellingen en herlaad.',
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

// iOS/Android stoppen de camera als de app op de achtergrond gaat → herstarten bij terugkomst.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !scanner.running) return;
  const live = scanner.track && scanner.track.readyState === 'live';
  if (!live) { try { await scanner.start(scanner.deviceId); await refreshCameraControls(); } catch (e) { camError(e.message); } }
  scanner.reacquireWakeLock();
});

// ---------- Teller ----------
function renderStats({ total, pending, fromCache, docs }) {
  $('countBadge').textContent = `🎅 ${total}`;
  $('totalCount').textContent = total;
  $('syncInfo').textContent = pending ? 'Bezig met synchroniseren…' : fromCache ? 'Offline – laatst gekende stand' : 'Live';

  const per = new Map();
  const buckets = new Map();
  for (const d of docs) {
    per.set(d.scannedBy || '?', (per.get(d.scannedBy || '?') || 0) + 1);
    const at = d.scannedAt?.toDate ? d.scannedAt.toDate() : (d.scannedAt instanceof Date ? d.scannedAt : null);
    if (at) {
      const k = new Date(at); k.setMinutes(Math.floor(k.getMinutes() / 15) * 15, 0, 0);
      buckets.set(+k, (buckets.get(+k) || 0) + 1);
    }
  }
  const tbody = $('perScanner').tBodies[0];
  tbody.replaceChildren(...[...per].sort((a, b) => b[1] - a[1]).map(([n, c]) => {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = n;
    const b = document.createElement('td'); b.textContent = c; b.className = 'num';
    tr.append(a, b); return tr;
  }));

  const max = Math.max(1, ...buckets.values());
  $('timeline').replaceChildren(...[...buckets].sort((a, b) => a[0] - b[0]).map(([k, c]) => {
    const row = document.createElement('div'); row.className = 'bar-row';
    const l = document.createElement('span'); l.textContent = fmtTime(new Date(k));
    const bar = document.createElement('span'); bar.className = 'bar'; bar.style.width = `${(c / max) * 100}%`;
    const n = document.createElement('span'); n.className = 'num'; n.textContent = c;
    row.append(l, bar, n); return row;
  }));
  lastDocs = docs;
}
function showStatsError(err) {
  $('syncInfo').textContent = err.code === 'permission-denied' ? 'Geen leesrechten op de teller' : `Fout: ${err.message}`;
}

$('exportBtn').addEventListener('click', () => {
  const rows = [['code', 'ID', 'scannedAt', 'scannedBy']];
  for (const d of lastDocs) {
    const at = d.scannedAt?.toDate ? d.scannedAt.toDate() : d.scannedAt;
    rows.push([d.code || '', d.ID || '', at ? new Date(at).toISOString() : '', d.scannedBy || '']);
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

// ---------- Start: login-status bepaalt wat zichtbaar is ----------
let unwatch = null;
store.onUser(user => {
  const needLogin = CONFIG.requireLogin && !DEMO && !user;
  $('loginView').hidden = !needLogin;
  $('mainView').hidden = needLogin;
  $('infoUser').textContent = user?.email || (CONFIG.requireLogin ? '–' : 'niet vereist');
  if (!needLogin && !unwatch) unwatch = store.watch(renderStats, err => showStatsError(err));
  if (needLogin && unwatch) { unwatch(); unwatch = null; scanner.stop(); }
});

