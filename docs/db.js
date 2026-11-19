// Opslag van scans. Twee implementaties met dezelfde interface:
//  - FirestoreStore: productie
//  - MemoryStore: oefenmodus (?demo=1) – niets wordt naar Firebase geschreven

import { initializeApp } from './vendor/firebase/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc, collection, runTransaction, getDocFromCache, setDoc, onSnapshot, serverTimestamp,
} from './vendor/firebase/firebase-firestore.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from './vendor/firebase/firebase-auth.js';

const TX_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms)),
  ]);
}

export class FirestoreStore {
  constructor(cfg) {
    this.cfg = cfg;
    this.app = initializeApp(cfg.firebase);
    let cache;
    try {
      cache = persistentLocalCache({ tabManager: persistentMultipleTabManager() });
    } catch (_) {
      cache = memoryLocalCache(); // bv. Safari privénavigatie zonder IndexedDB
    }
    this.db = initializeFirestore(this.app, { localCache: cache });
    this.auth = getAuth(this.app);
    this.col = collection(this.db, cfg.collection);
  }

  onUser(cb) { return onAuthStateChanged(this.auth, cb); }
  login(email, pw) { return signInWithEmailAndPassword(this.auth, email, pw); }
  logout() { return signOut(this.auth); }
  get user() { return this.auth.currentUser; }

  /**
   * Registreert één bandje. Atomisch: twee scanners die hetzelfde bandje tegelijk
   * scannen geven nooit twee keer 'ok'.
   * @returns {Promise<{status:'ok'|'duplicate'|'queued', first?:{at:Date|null, by:string}}>}
   */
  async register(code, id, scannerName) {
    const ref = doc(this.col, code);
    const data = {
      ID: String(id),
      code,
      scannedAt: serverTimestamp(),
      scannedBy: scannerName || 'onbekend',
      uid: this.auth.currentUser?.uid || null,
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
        // anders: netwerkprobleem → offline pad hieronder
      }
    }

    // Offline: controleer lokale cache, zet schrijfactie in wachtrij (sync zodra er netwerk is).
    try {
      const cached = await getDocFromCache(ref);
      if (cached.exists()) return { status: 'duplicate', first: describe(cached.data()) };
    } catch (_) { /* niet in cache */ }
    setDoc(ref, data).catch(err => console.warn('Sync geweigerd (waarschijnlijk al gescand elders):', code, err));
    return { status: 'queued' };
  }

  /** Live teller + lijst (bevat ook nog niet gesynchroniseerde scans van dit toestel). */
  watch(cb, onError) {
    return onSnapshot(this.col, { includeMetadataChanges: true }, snap => {
      cb({
        total: snap.size,
        pending: snap.metadata.hasPendingWrites,
        fromCache: snap.metadata.fromCache,
        docs: snap.docs.map(d => d.data()),
      });
    }, onError);
  }
}

export class MemoryStore {
  constructor(cfg) { this.cfg = cfg; this.map = new Map(); this.listeners = new Set(); this._user = { email: 'demo' }; }
  onUser(cb) { cb(this._user); return () => {}; }
  async login() {}
  async logout() {}
  get user() { return this._user; }
  async register(code, id, scannerName) {
    if (this.map.has(code)) return { status: 'duplicate', first: describe(this.map.get(code)) };
    this.map.set(code, { ID: String(id), code, scannedAt: new Date(), scannedBy: scannerName || 'demo' });
    this._emit();
    return { status: 'ok' };
  }
  watch(cb) { const l = () => cb({ total: this.map.size, pending: false, fromCache: false, docs: [...this.map.values()] }); this.listeners.add(l); l(); return () => this.listeners.delete(l); }
  _emit() { this.listeners.forEach(l => l()); }
}

function describe(d) {
  const ts = d?.scannedAt;
  const at = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
  return { at, by: d?.scannedBy || '?' };
}
