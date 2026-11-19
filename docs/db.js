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
import { keyFromDocId } from './codes.js';

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

function editionOf(collectionName) { return collectionName.replace('santa_walk_', ''); }

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
    this.historyLoaded = false;
    this.dry = new Map();       // oefenmodus: scans enkel in geheugen
  }

  onUser(cb) { return onAuthStateChanged(this.auth, cb); }
  login(code) { return signInWithEmailAndPassword(this.auth, this.cfg.sharedAccountEmail, code); }
  logout() { return signOut(this.auth); }

  /** Laadt alle scans van vorige edities in het geheugen (snelle, offline controle). */
  async loadHistory() {
    const results = await Promise.allSettled(this.cfg.historyCollections.map(async name => {
      const snap = await getDocs(collection(this.db, name));
      snap.forEach(d => {
        const key = keyFromDocId(d.id, this.cfg);
        if (key && !this.history.has(key)) {
          this.history.set(key, { edition: editionOf(name), at: toDate(d.data().scannedAt) });
        }
      });
      return snap.size;
    }));
    this.historyLoaded = results.every(r => r.status === 'fulfilled');
    return { loaded: this.historyLoaded, size: this.history.size,
      failed: results.filter(r => r.status === 'rejected').map(r => r.reason?.code || r.reason?.message) };
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
    setDoc(ref, data).catch(err => console.warn('Sync geweigerd (waarschijnlijk elders al gescand):', parsed.key, err));
    return { status: 'queued' };
  }

  async undo(key) {
    if (this.dryRun) { this.dry.delete(key); return; }
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
  constructor(cfg, history = {}) {
    this.cfg = cfg;
    this.map = new Map();
    this.history = new Map(Object.entries(history).map(([k, e]) => [k, { edition: e, at: null }]));
    this.historyLoaded = true;
    this.listeners = new Set();
  }
  onUser(cb) { cb({ email: 'lokaal' }); return () => {}; }
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
