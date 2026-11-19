// Opslag van scans.
//  - FirestoreStore: productie. Met { dryRun: true } (oefenmodus) wordt de echte
//    historiek en stand gelezen, maar niets weggeschreven.
//  - MemoryStore: volledig lokaal (enkel voor automatische tests, ?demo=local).

import { initializeApp } from './vendor/firebase/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc, collection, runTransaction, getDoc, getDocFromCache, getDocs, setDoc, deleteDoc,
  onSnapshot, serverTimestamp,
} from './vendor/firebase/firebase-firestore.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from './vendor/firebase/firebase-auth.js';
import { keyFromDocId, editionOf } from './codes.js';

const TX_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) =>
    setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms))]);
}

export function toDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  return null;
}

export class FirestoreStore {
  constructor(cfg, { dryRun = false } = {}) {
    this.cfg = cfg;
    this.dryRun = dryRun;
    this.app = initializeApp(cfg.firebase);
    let cache;
    try { cache = persistentLocalCache({ tabManager: persistentMultipleTabManager() }); }
    catch (_) { cache = memoryLocalCache(); } // bv. Safari privénavigatie
    this.db = initializeFirestore(this.app, { localCache: cache });
    this.auth = getAuth(this.app);
    this.col = collection(this.db, cfg.collection);
    this.history = new Map();   // key -> { edition, at }
    this.past = new Map();      // collectie -> [{id, key, edition, at}]
    this.historyLoaded = false;
    // Oefenmodus: scans enkel op dit toestel (localStorage), nooit in Firestore.
    this.dry = new Map(dryRun ? JSON.parse(localStorage.getItem(`sw.dry.${cfg.year}`) || '[]').map(([k, v]) => [k, { ...v, at: new Date(v.at) }]) : []);
    this.onSyncError = null;    // callback als een offline scan later door de server geweigerd wordt
  }

  onUser(cb) { return onAuthStateChanged(this.auth, cb); }
  /** Eén codeveld: eerst als scanner, anders als beheerder. */
  async login(code) {
    try {
      return await signInWithEmailAndPassword(this.auth, this.cfg.sharedAccountEmail, code);
    } catch (e) {
      if (!['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(e.code)) throw e;
      return await signInWithEmailAndPassword(this.auth, this.cfg.adminAccountEmail, code);
    }
  }
  roleOf(user) { return user?.email === this.cfg.adminAccountEmail ? 'admin' : 'scanner'; }
  logout() { return signOut(this.auth); }

  /**
   * Leest één collectie van een vorige editie (één keer per sessie).
   * Via de REST-API: die geeft ook createTime terug, het enige tijdstip dat de
   * oude scans (2018-2025) hebben. Valt terug op de SDK (zonder tijdstip) als dat faalt.
   */
  async loadCollection(name) {
    if (this.past.has(name)) return this.past.get(name);
    let raw;
    try {
      raw = await this._restList(name);
    } catch (e) {
      console.warn('REST-lijst mislukt, terugval op SDK:', name, e);
      const snap = await getDocs(collection(this.db, name));
      raw = snap.docs.map(d => ({ id: d.id, at: toDate(d.data().scannedAt) }));
    }
    const rows = raw.map(r => {
      const key = keyFromDocId(r.id, this.cfg);
      return { id: r.id, key, edition: key ? editionOf(name, key, this.cfg) : null, at: r.at };
    });
    this.past.set(name, rows);
    return rows;
  }

  async _restList(name) {
    const token = await this.auth.currentUser?.getIdToken();
    if (!token) throw new Error('niet aangemeld');
    const rows = [];
    let pageToken = '';
    do {
      const u = new URL(`https://firestore.googleapis.com/v1/projects/${this.cfg.firebase.projectId}/databases/(default)/documents/${name}`);
      u.searchParams.set('pageSize', '500');
      u.searchParams.set('mask.fieldPaths', 'scannedAt');
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      for (const d of j.documents || []) {
        const ts = d.fields?.scannedAt?.timestampValue || d.createTime;
        rows.push({ id: decodeURIComponent(d.name.split('/').pop()), at: ts ? new Date(ts) : null });
      }
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return rows;
  }

  /** Laadt de scans van vorige edities die nog geldige bandjes kunnen bevatten (controle "al uitgeleverd"). */
  async loadHistory() {
    const results = await Promise.allSettled(this.cfg.historyCollections.map(async name => {
      for (const r of await this.loadCollection(name)) {
        if (r.key && !this.history.has(r.key)) this.history.set(r.key, { edition: String(r.edition), at: r.at });
      }
    }));
    this.historyLoaded = results.every(r => r.status === 'fulfilled');
    return { loaded: this.historyLoaded, size: this.history.size,
      failed: results.filter(r => r.status === 'rejected').map(r => r.reason?.code || r.reason?.message) };
  }

  /** Alle vorige edities (statistieken, breed zoeken). */
  async loadAllPast() {
    await Promise.allSettled(this.cfg.statsCollections.map(n => this.loadCollection(n)));
    return this.past;
  }

  async settings() {
    try {
      const s = await getDoc(doc(this.db, 'santa_walk_settings', String(this.cfg.year)));
      return s.exists() ? s.data() : {};
    } catch (_) { return {}; }
  }

  /**
   * @returns {Promise<{status:'ok'|'queued'|'duplicate'|'history', first?:{at:Date|null, by:string, edition?:string}}>}
   */
  async register(parsed, scannerName) {
    const hist = this.history.get(parsed.key);
    if (hist) return { status: 'history', first: { at: hist.at, by: '', edition: hist.edition } };

    if (this.dryRun) {
      const d = this.dry.get(parsed.key);
      if (d) return { status: 'duplicate', first: d };
      this.dry.set(parsed.key, { at: new Date(), by: scannerName || '?' });
      this._saveDry();
      return { status: 'ok' };
    }

    const ref = doc(this.col, parsed.key);
    const data = {
      ID: String(parsed.number),
      code: parsed.key,
      scannedAt: serverTimestamp(),
      scannedBy: scannerName || 'onbekend',
    };

    if (navigator.onLine) {
      try {
        return await withTimeout(runTransaction(this.db, async tx => {
          const snap = await tx.get(ref);
          if (snap.exists()) return { status: 'duplicate', first: describe(snap.data()) };
          tx.set(ref, data);
          return { status: 'ok' };
        }), TX_TIMEOUT_MS);
      } catch (e) {
        if (e.code === 'permission-denied') throw e;
      }
    }
    try {
      const cached = await getDocFromCache(ref);
      if (cached.exists()) return { status: 'duplicate', first: describe(cached.data()) };
    } catch (_) { /* niet in cache */ }
    setDoc(ref, data).catch(err => { console.warn('Sync geweigerd:', parsed.key, err); this.onSyncError?.(parsed, err); });
    return { status: 'queued' };
  }

  _saveDry() { localStorage.setItem(`sw.dry.${this.cfg.year}`, JSON.stringify([...this.dry])); }

  async undo(key) {
    if (this.dryRun) { this.dry.delete(key); this._saveDry(); return; }
    await deleteDoc(doc(this.col, key));
  }

  /** Status van één bandje voor het opzoekscherm. */
  async lookup(parsed) {
    const hist = this.history.get(parsed.key);
    if (hist) return { status: 'history', first: { at: hist.at, edition: hist.edition } };
    if (this.dryRun && this.dry.has(parsed.key)) return { status: 'duplicate', first: this.dry.get(parsed.key) };
    const snap = await getDoc(doc(this.col, parsed.key));
    return snap.exists() ? { status: 'duplicate', first: describe(snap.data()) } : { status: 'free' };
  }

  watch(cb, onError) {
    return onSnapshot(this.col, { includeMetadataChanges: true }, snap => cb({
      total: snap.size,
      pending: snap.metadata.hasPendingWrites,
      fromCache: snap.metadata.fromCache,
      docs: snap.docs.map(d => d.data()),
    }), onError);
  }
}

export class MemoryStore {
  constructor(cfg, history = {}, extraPast = []) {
    this.cfg = cfg;
    this.map = new Map();
    this.history = new Map(Object.entries(history).map(([k, e]) => [k, { edition: e, at: null }]));
    this.historyLoaded = true;
    this.listeners = new Set();
    this.past = new Map();
    for (const [k, e] of Object.entries(history)) {
      const name = `santa_walk_${e === '2025' && /^\d+$/.test(k) ? '2024' : e}`;
      if (!this.past.has(name)) this.past.set(name, []);
      this.past.get(name).push({ id: k, key: k, edition: parseInt(e, 10), at: null });
    }
    for (const r of extraPast) {
      if (!this.past.has(r.coll)) this.past.set(r.coll, []);
      this.past.get(r.coll).push(r);
    }
  }
  async loadAllPast() { return this.past; }
  onUser(cb) { cb({ email: new URLSearchParams(location.search).get('role') === 'scanner' ? 'scanner' : this.cfg.adminAccountEmail }); return () => {}; }
  roleOf(user) { return user?.email === this.cfg.adminAccountEmail ? 'admin' : 'scanner'; }
  async login() {}
  async logout() {}
  async loadHistory() { return { loaded: true, size: this.history.size, failed: [] }; }
  async settings() { return {}; }
  async register(parsed, scannerName) {
    const hist = this.history.get(parsed.key);
    if (hist) return { status: 'history', first: { at: null, by: '', edition: hist.edition } };
    if (this.map.has(parsed.key)) return { status: 'duplicate', first: describe(this.map.get(parsed.key)) };
    this.map.set(parsed.key, { ID: String(parsed.number), code: parsed.key, scannedAt: new Date(), scannedBy: scannerName || 'test' });
    this._emit();
    return { status: 'ok' };
  }
  async undo(key) { this.map.delete(key); this._emit(); }
  async lookup(parsed) {
    const hist = this.history.get(parsed.key);
    if (hist) return { status: 'history', first: { at: null, edition: hist.edition } };
    return this.map.has(parsed.key) ? { status: 'duplicate', first: describe(this.map.get(parsed.key)) } : { status: 'free' };
  }
  watch(cb) {
    const l = () => cb({ total: this.map.size, pending: false, fromCache: false, docs: [...this.map.values()] });
    this.listeners.add(l); l(); return () => this.listeners.delete(l);
  }
  _emit() { this.listeners.forEach(l => l()); }
}

function describe(d) { return { at: toDate(d?.scannedAt), by: d?.scannedBy || '?' }; }
