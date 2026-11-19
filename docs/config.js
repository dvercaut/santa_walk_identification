// ============================================================================
//  Santa Walk scanner – jaarlijkse configuratie
//  Elk jaar ENKEL dit bestand aanpassen (en de Firestore rules deployen).
// ============================================================================

export const CONFIG = {
  // Jaar van de editie. Bepaalt de verwachte QR-inhoud en de Firestore-collectie.
  year: 2026,

  // QR-inhoud op de polsbandjes = `${codePrefix}${nummer}`, bv. "santa_walk_2026_123".
  // Moet exact overeenkomen met wat generate_qr.py dit jaar gedrukt heeft.
  get codePrefix() { return `santa_walk_${this.year}_`; },

  // Firestore-collectie waar de scans van dit jaar in komen.
  get collection() { return `santa_walk_${this.year}`; },

  // Geldige nummerreeks van de gedrukte bandjes (inclusief).
  // Codes buiten deze reeks worden geweigerd (bescherming tegen zelfgemaakte QR's).
  idMin: 1,
  idMax: 1500,

  // Optioneel: overgebleven bandjes van vorige jaren alsnog aanvaarden.
  // Voorbeeld: ['santa_walk_2025_']. Leeg laten = enkel bandjes van dit jaar.
  // Let op: deze codes worden in de collectie van DIT jaar bewaard.
  extraPrefixes: [],

  // Medewerkers moeten inloggen (Firebase Authentication, e-mail + wachtwoord).
  // Zet op false enkel als je de 'open' variant van de Firestore rules gebruikt.
  requireLogin: true,

  // Zelfde bandje binnen deze tijd (ms) opnieuw voor de camera = negeren (geen melding).
  sameCodeCooldownMs: 3000,

  // Firebase webconfig (publiek, geen geheim – beveiliging zit in de Firestore rules).
  firebase: {
    apiKey: "AIzaSyCsN8GMxxwOpvzM-7yTK47yi1zWOq2rVkw",
    authDomain: "santa-walk-identification.firebaseapp.com",
    projectId: "santa-walk-identification",
    storageBucket: "santa-walk-identification.appspot.com",
  },
};
