# Santa Walk – scanner voor polsbandjes

Webapp om de QR-code op de polsbandjes te scannen bij het uitreiken van de pakjes. De app controleert of het bandje geldig is, weigert bandjes die al uitgeleverd zijn (ook in vorige jaren) en toont live hoeveel pakjes er uitgeleverd zijn en hoeveel er nog in voorraad zijn. De data staat in Firebase Firestore.

## Geldige bandjes

| QR-inhoud | Herkomst | Sleutel in Firestore |
|---|---|---|
| `2251` … `2750` | nieuw 2026 (Orakel, enkel het nummer) | `2251` |
| `1501` … `2250` | 2025 (Orakel drukte enkel het nummer) | `1501` |
| `santa_walk_2024_<nr>` | 2024 | `santa_walk_2024_<nr>` |
| `santa_walk_2023_<nr>` | 2023 | `santa_walk_2023_<nr>` |

Bandjes die in `santa_walk_2023`, `santa_walk_2024` of `santa_walk_2025` staan, geven **"al uitgeleverd op de Santa Walk 20xx"**.

## Eenmalige setup (± 10 min)

1. **Toegangscode**: Firebase Console › Authentication › Sign-in method › *Email/Password* aanzetten.
   Daarna bij Users › *Add user*: e-mail `scanner@santawalk.app`, wachtwoord = de toegangscode (minstens 6 tekens).
2. **Rules**: inhoud van `firestore.rules` plakken in Console › Firestore › Rules › *Publish*
   (of `firebase deploy --only firestore:rules`).
3. **Voorraad** (optioneel, aanpasbaar tijdens het event): Firestore › collectie `santa_walk_settings` › document `2026` › veld `giftStock` (number) = 459.
4. **Publiceren**: map `docs/` naar de hosting (GitHub Pages `/docs` of Firebase Hosting).

## Delen met vrijwilligers

Stuur de link met de code erin: `https://<jouw-site>/#code=<toegangscode>`.
Eén tik → aangemeld; de code verdwijnt meteen uit de adresbalk en het toestel blijft aangemeld.
Na het event: wachtwoord van `scanner@santawalk.app` wijzigen = iedereen afgemeld.

Oefenen met stalen: `https://<jouw-site>/?demo=1` → leest de echte historiek, schrijft niets weg.

## Database zelf aanpassen

De rules gelden **enkel voor de webapp**. In de Firebase Console (en met de Admin SDK / Python-scripts) kan je altijd alles toevoegen, aanpassen en verwijderen. In de app zelf kan een foute scan binnen 2 minuten ongedaan gemaakt worden.

## Volgend jaar

`docs/config.js`: `year`, `plainMax`, `historyCollections` (+ vorig jaar), `prefixedYears`, `giftStock`.
Nieuwe bandjes: `cd generate_qr && pip install qrcode pillow && python generate_qr.py --year 2027 --start 2751 --end 3250`.

## Structuur

| Bestand | Rol |
|---|---|
| `docs/config.js` | jaar, geldige nummers, voorraad, login, Firebase-config |
| `docs/codes.js` | herkenning van alle QR-formaten → unieke sleutel |
| `docs/scanner.js` | camera + QR-detectie (ingebouwde BarcodeDetector, anders ZXing WebAssembly) |
| `docs/db.js` | Firestore: historiek, transactie tegen dubbele scans, offline wachtrij, ongedaan maken |
| `docs/app.js` | scannen, opzoeken, teller/voorraad, groot scherm, toestel-check, CSV-export |
| `docs/vendor/` | vastgepinde bibliotheken (Firebase JS 12.10.0, barcode-detector 3.2.4, zxing-wasm 3.1.7) |
| `firestore.rules` | toegang enkel met code; enkel nieuwe scans in het lopende jaar; wissen enkel binnen 2 min |
