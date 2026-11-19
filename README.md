# Santa Walk – ticketscanner

Webapp om de QR-codes op de polsbandjes van de Santa Walk te scannen: controleert of het bandje geldig is, weigert dubbele scans en telt live het aantal deelnemers. Data in Firebase Firestore.

## Jaarlijkse checklist

1. **Bandjes**: `cd generate_qr && pip install qrcode pillow && python generate_qr.py --year 2026 --start 1 --end 1500`
   → PNG's + `codes_2026.csv` in `generate_qr/images/santa_walk_2026/`.
2. **Config**: pas in `docs/config.js` `year`, `idMin` en `idMax` aan (zelfde reeks als de gedrukte bandjes).
3. **Rules** (eenmalig, of na wijziging): `firebase deploy --only firestore:rules`
4. **Medewerkers** (eenmalig): Firebase console → Authentication → Sign-in method → *Email/Password* aanzetten; per scanner(groep) een gebruiker aanmaken.
5. **Publiceren**: `docs/` naar hosting (GitHub Pages `/docs` of `firebase deploy --only hosting` met `public: docs`).
6. **Testen**: open `…/?demo=1` (oefenmodus, schrijft niets weg) op een iPhone én een Android-toestel, scan een testbandje, test lamp en camerakeuze.
7. **Op de dag**: elke scanner meldt aan, geeft het toestel een naam (Instellingen) en tikt op *Start camera*.

## Structuur

| Bestand | Rol |
|---|---|
| `docs/config.js` | jaar, nummerreeks, login aan/uit, Firebase-config |
| `docs/codes.js` | validatie van de QR-inhoud |
| `docs/scanner.js` | camera + QR-detectie (native BarcodeDetector, anders ZXing WebAssembly) |
| `docs/db.js` | Firestore (transactie tegen dubbele scans, offline wachtrij) en demo-opslag |
| `docs/app.js` | UI: scannen, teller, instellingen, CSV-export |
| `docs/vendor/` | vastgepinde bibliotheken (Firebase JS 12.10.0, barcode-detector 3.2.4, zxing-wasm 3.1.7) – geen CDN nodig |
| `firestore.rules` | enkel aanmaken toegestaan, geen wijzigen/verwijderen |

## Compatibiliteit

- iPhone: Safari (iOS 15+) of elke browser op iOS. Android: Chrome/Samsung Internet/Firefox. Laptop met webcam werkt ook.
- Vereist **https** (camera). Camera-toegang wordt gevraagd bij *Start camera*.
- Meerdere achtercamera's (ultrawide/tele): kies de hoofdcamera in de keuzelijst; de keuze wordt onthouden.
