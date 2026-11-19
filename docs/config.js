// ============================================================================
//  Santa Walk scanner – jaarlijkse configuratie
//  Elk jaar ENKEL dit bestand aanpassen.
// ============================================================================

export const CONFIG = {
  // Editie. Scans van dit jaar komen in de collectie `santa_walk_<year>`.
  year: 2026,
  get collection() { return `santa_walk_${this.year}`; },

  // Collecties van vorige edities. Bandjes die daarin staan, zijn al
  // uitgeleverd en worden geweigerd als "al uitgeleverd".
  historyCollections: ['santa_walk_2023', 'santa_walk_2024', 'santa_walk_2025'],

  // Welke QR-inhoud is een geldig bandje?
  //  1. Enkel een nummer, bv. "2251" (sinds 2025 zo gedrukt door Orakel).
  //  2. "santa_walk_<jaar>_<nr>", bv. "santa_walk_2024_100" (bandjes 2023-2024).
  // Vanaf `uniqueFrom` is de nummering doorlopend over de jaren heen; daaronder
  // hoort het jaar bij het bandje (santa_walk_2023_10 ≠ santa_walk_2024_10).
  plainMin: 1501,
  plainMax: 2750,          // 2026: nieuwe bandjes 2251-2750
  prefixedYears: [2023, 2024, 2025, 2026],
  uniqueFrom: 1501,

  // Aantal sinterklaaspakjes in voorraad bij de start. Overschrijfbaar zonder
  // nieuwe deploy via Firestore: document santa_walk_settings/<year>, veld giftStock.
  giftStock: 459,
  giftStockWarnAt: 50,

  // Eén gedeelde toegangscode (= wachtwoord van één Firebase-gebruiker).
  // Zet requireLogin op false enkel samen met de 'open' variant van de rules.
  requireLogin: true,
  sharedAccountEmail: 'scanner@santawalk.app',

  // Foute scan ongedaan maken: binnen deze tijd (seconden). Moet gelijk zijn aan firestore.rules.
  undoWindowSec: 120,

  // Zelfde bandje binnen deze tijd (ms) opnieuw voor de camera = negeren.
  sameCodeCooldownMs: 3000,

  // Firebase webconfig (publiek, geen geheim – beveiliging zit in de Firestore rules).
  firebase: {
    apiKey: "AIzaSyCsN8GMxxwOpvzM-7yTK47yi1zWOq2rVkw",
    authDomain: "santa-walk-identification.firebaseapp.com",
    projectId: "santa-walk-identification",
    storageBucket: "santa-walk-identification.appspot.com",
  },
};
