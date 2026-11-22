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
    // Doorlopende nummering (>= uniqueFrom) bestaat pas sinds plainSince (2025).
    // Oudere bandjes zoals santa_walk_2019_1600 horen bij hun eigen jaar.
    if (n >= cfg.uniqueFrom && year >= cfg.plainSince) return { ok: true, key: String(n), number: n, label: `Nr ${n}` };
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

/**
 * Editie (jaar) waarin een document uit een collectie werkelijk gescand is.
 * Enige uitzondering op "jaar van de collectie": bandjes met enkel een nummer
 * bestaan pas sinds plainSince; zo'n document in een oudere collectie (bv. 1520 in
 * santa_walk_2024, gescand op 13/12/2025) hoort bij plainSince.
 */
export function editionOf(collectionName, key, cfg) {
  const year = parseInt(collectionName.slice(-4), 10);
  if (/^\d+$/.test(key) && parseInt(key, 10) >= cfg.uniqueFrom) return Math.max(year, cfg.plainSince);
  const m = key.match(/^santa_walk_(\d{4})_/);
  if (m && parseInt(m[1], 10) > year) return parseInt(m[1], 10);
  return year;
}

/**
 * Breed zoeken: alle sleutels die bij een ingegeven nummer of code kunnen horen.
 * "2251" → ["2251", "santa_walk_2018_2251", …];  "100" → ["100", "santa_walk_2018_100", …]
 */
export function searchKeys(input, cfg) {
  const text = String(input ?? '').trim();
  const m = text.match(/(\d{1,5})\s*$/);
  if (!m) return [];
  const n = parseInt(m[1], 10);
  const years = new Set([...cfg.statsCollections.map(c => parseInt(c.slice(-4), 10)), ...cfg.prefixedYears, cfg.year]);
  const keys = new Set([String(n)]);
  for (const y of [...years].sort()) keys.add(n >= cfg.uniqueFrom && y >= cfg.plainSince ? String(n) : `santa_walk_${y}_${n}`);
  return [...keys];
}
