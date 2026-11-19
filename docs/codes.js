// Validatie van de QR-inhoud van een polsbandje. Puur, zonder DOM of Firebase.

/**
 * @returns {{ok:true, code:string, id:number} | {ok:false, reason:string, raw:string}}
 */
export function parseCode(raw, cfg) {
  const text = String(raw ?? '').trim();
  const prefixes = [cfg.codePrefix, ...(cfg.extraPrefixes || [])];
  const prefix = prefixes.find(p => text.startsWith(p));

  if (!prefix) {
    const m = text.match(/^santa_walk_(\d{4})_/);
    if (m) return { ok: false, reason: `Bandje van ${m[1]}, niet van ${cfg.year}`, raw: text };
    return { ok: false, reason: 'Geen Santa Walk-bandje', raw: text };
  }

  const num = text.slice(prefix.length);
  if (!/^\d{1,5}$/.test(num)) return { ok: false, reason: 'Ongeldig nummer', raw: text };

  const id = parseInt(num, 10);
  if (prefix === cfg.codePrefix && (id < cfg.idMin || id > cfg.idMax)) {
    return { ok: false, reason: `Nummer ${id} valt buiten reeks ${cfg.idMin}-${cfg.idMax}`, raw: text };
  }
  // Normaliseer (bv. voorloopnullen) zodat hetzelfde bandje altijd hetzelfde document is.
  return { ok: true, code: `${prefix}${id}`, id };
}
