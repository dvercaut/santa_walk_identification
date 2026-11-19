// Herkenning van de QR-inhoud van een polsbandje. Puur, zonder DOM of Firebase.
//
// Elk bandje krijgt een unieke sleutel (`key`) die ook het document-id in Firestore is:
//   - nummer >= uniqueFrom  → "2251"                (ongeacht hoe de QR het schrijft)
//   - nummer <  uniqueFrom  → "santa_walk_2024_100" (jaar hoort bij het bandje)
// Zo komen de bestaande documenten van 2023-2025 overeen met nieuwe scans.

/**
 * @returns {{ok:true, key:string, number:number, label:string}
 *         | {ok:false, reason:string, raw:string}}
 */
export function parseCode(raw, cfg) {
  const text = String(raw ?? '').trim();

  let m = text.match(/^0*(\d{1,5})$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n < cfg.plainMin || n > cfg.plainMax) {
      return { ok: false, reason: `Nummer ${n} bestaat niet (geldig: ${cfg.plainMin}-${cfg.plainMax})`, raw: text };
    }
    return { ok: true, key: String(n), number: n, label: `Nr ${n}` };
  }

  m = text.match(/^santa_walk_(\d{4})_0*(\d{1,5})$/i);
  if (m) {
    const year = parseInt(m[1], 10);
    const n = parseInt(m[2], 10);
    if (!cfg.prefixedYears.includes(year)) {
      return { ok: false, reason: `Bandje van ${year} is niet meer geldig`, raw: text };
    }
    if (n < 1 || n > cfg.plainMax) return { ok: false, reason: `Nummer ${n} bestaat niet`, raw: text };
    if (n >= cfg.uniqueFrom) return { ok: true, key: String(n), number: n, label: `Nr ${n}` };
    return { ok: true, key: `santa_walk_${year}_${n}`, number: n, label: `Nr ${n} (${year})` };
  }

  return { ok: false, reason: 'Geen Santa Walk-bandje', raw: text };
}

/** Sleutel van een bestaand document-id uit een vorige editie (null als onherkenbaar). */
export function keyFromDocId(id, cfg) {
  const loose = { ...cfg, plainMin: 1, prefixedYears: [...new Set([...cfg.prefixedYears, 2018, 2019, 2020, 2021, 2022])], plainMax: 99999 };
  const p = parseCode(id, loose);
  return p.ok ? p.key : null;
}
