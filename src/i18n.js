// -----------------------------------------------------------------------------
// Runtime texts (English and French): device, feature and option names, the
// status of the integration, the answers of the button and the command errors.
// -----------------------------------------------------------------------------

import { FEATURES as F } from './constants.js';

const both = (en, fr) => ({ en, fr });

/** One language of a `{ en, fr }` text. */
export const word = (value, language) => (language === 'en' ? value.en : value.fr);

export const join = (parts) =>
  both(parts.map((p) => p.en).join(' '), parts.map((p) => p.fr).join(' '));

/** "45 s", "5 min", in both languages. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  return both(`${minutes} min`, `${minutes} min`);
}

const fr = (n) => String(n).replace('.', ',');

export const FEATURE_NAMES = {
  [F.WATER_TEMPERATURE]: both('Water temperature', "Température de l'eau"),
  [F.TARGET_TEMPERATURE]: both('Heater setpoint', 'Consigne du chauffage'),
  [F.HEATING]: both('Heating', 'Chauffe'),
  [F.HEATER_POWER]: both('Heater', 'Chauffage'),
  [F.HEATER_MODE]: both('Heater mode', 'Mode du chauffage'),
  [F.HEATER_ALERT]: both('Heater alert', 'Alerte du chauffage'),
  [F.FILTER_POWER]: both('Filter pump', 'Pompe du filtre'),
  [F.FILTER_SPEED]: both('Filter speed (%)', 'Vitesse du filtre (%)'),
  [F.FILTER_FREQUENCY]: both('Pump frequency (Hz)', 'Fréquence de la pompe (Hz)'),
  [F.FILTER_MODE]: both('Filter mode', 'Mode du filtre'),
  [F.FILTER_ERROR]: both('Filter state', 'État du filtre'),
  [F.SERVICE_HOURS]: both('Hours until service', "Heures avant l'entretien"),
  [F.OPERATING_TIME]: both('Operating time', 'Temps de fonctionnement'),
  [F.PH]: both('pH', 'pH'),
  [F.TARGET_PH]: both('pH setpoint', 'Consigne de pH'),
  [F.CO2_VALVE]: both('CO2 valve open', 'Vanne CO2 ouverte'),
  [F.PH_ALERT]: both('pH state', 'État du pH'),
  [F.CALIBRATION_DAYS]: both('Days until calibration', "Jours avant l'étalonnage"),
  [F.LIGHT_CHANNEL]: (n) => both(`Light channel ${n} (%)`, `Éclairage canal ${n} (%)`),
  [F.UV_LAMP]: both('UV lamp lit', 'Lampe UV allumée'),
  [F.UV_ACTIVE]: both('UV sterilizer active', 'Stérilisateur UV actif'),
  [F.UV_MODE]: both('UV mode', 'Mode UV'),
  [F.FEEDER_WEIGHT]: both('Food weight (g)', 'Poids de nourriture (g)'),
  [F.FEEDER_DRUM]: both('Feeder drum', 'Tambour du distributeur'),
  [F.FEEDER_SPINNING]: both('Feeder turning', 'Distributeur en rotation'),
};

export const OPTION_NAMES = {
  on: both('On', 'Marche'),
  off: both('Off', 'Arrêt'),
};

export const STATE_TEXTS = {
  heaterMode: {
    0: both('Manual', 'Manuel'),
    1: both('Smart (follows the light)', 'Smart (suit l’éclairage)'),
    2: both('Bio (night reduction)', 'Bio (baisse de nuit)'),
  },
  filterMode: {
    manual: both('Manual', 'Manuel'),
    'constant-flow': both('Constant flow', 'Débit constant'),
    pulse: both('Pulse', 'Pulsé'),
    bio: both('Bio (day/night)', 'Bio (jour/nuit)'),
    unknown: both('Unknown', 'Inconnu'),
  },
  filterError: {
    0: both('OK', 'OK'),
    1: both('Rotor stuck', 'Rotor bloqué'),
    2: both('Air in the filter', 'Air dans le filtre'),
    unknown: both('Unknown error', 'Erreur inconnue'),
  },
  phAlert: {
    0: both('OK', 'OK'),
    1: both('pH too high', 'pH trop haut'),
    2: both('pH too low', 'pH trop bas'),
    3: both('Electrode missing', 'Électrode absente'),
    unknown: both('Unknown alert', 'Alerte inconnue'),
  },
  uvMode: {
    0: both('Constant', 'Constant'),
    1: both('Day cycle', 'Cycle de jour'),
  },
  drum: {
    0: both('Full', 'Plein'),
    1: both('Getting low', 'Bientôt vide'),
    2: both('Empty', 'Vide'),
    5: both('Measuring', 'Mesure en cours'),
  },
};

/** The reasons of a connection failure (the kinds of src/eheim/connection.js). */
export const REASONS = {
  unreachable: both('unreachable', 'injoignable'),
  protocol: both('not an EHEIM Digital hub', 'pas un hub EHEIM Digital'),
  closed: both('connection closed', 'connexion fermée'),
  silent: both('the hub stopped talking', 'le hub ne répond plus'),
  error: both('error', 'erreur'),
};

export const reasonOf = (kind) => REASONS[kind] ?? REASONS.error;

/** The integration status, the button and the logs a user may read. */
export const T = {
  noAddress: both(
    'Enter the address of your EHEIM Digital hub (its IP address, or eheimdigital.local), then save.',
    "Saisissez l'adresse de votre hub EHEIM Digital (son adresse IP, ou eheimdigital.local), puis enregistrez.",
  ),
  invalid: (typed) =>
    both(
      `Invalid address: ${typed} (an IPv4 address or a host name, with an optional port).`,
      `Adresse invalide : ${typed} (une adresse IPv4 ou un nom d'hôte, avec un port en option).`,
    ),
  badRange: (floor, ceiling) =>
    both(
      `The setpoint floor (${floor} °C) is not below the ceiling (${ceiling} °C): every setpoint will be refused.`,
      `Le plancher de la consigne (${fr(floor)} °C) n'est pas sous le plafond (${fr(ceiling)} °C) : toute consigne sera refusée.`,
    ),
  connecting: both('Connecting to the EHEIM Digital hub…', 'Connexion au hub EHEIM Digital…'),
  waiting: both(
    'Connected to the hub, waiting for its devices…',
    'Connecté au hub, en attente de ses appareils…',
  ),
  connected: (count) =>
    both(
      `Connected: ${count} EHEIM Digital device${count > 1 ? 's' : ''}.`,
      `Connecté : ${count} appareil${count > 1 ? 's' : ''} EHEIM Digital.`,
    ),
  unreachable: (address, reason, wait) => {
    const r = reasonOf(reason);
    return both(
      `No connection to the EHEIM Digital hub at ${address} (${r.en}; next try in ${wait.en}). Check the address and that the hub is on the same network.`,
      `Pas de connexion au hub EHEIM Digital ${address} (${r.fr} ; nouvel essai dans ${wait.fr}). Vérifiez l'adresse et que le hub est sur le même réseau.`,
    );
  },
  test: {
    cooldown: both('Tested less than 10 s ago.', 'Testé il y a moins de 10 s.'),
  },
};

/** The errors a command answers to Gladys. */
export const ERRORS = {
  readOnly: both('This feature is read only.', 'Cette fonctionnalité est en lecture seule.'),
  heaterDisabled: both(
    'Heater commands are disabled: turn on "Allow the heater commands" in the configuration of the integration. Not sent.',
    "Les commandes du chauffage sont désactivées : activez « Autoriser les commandes du chauffage » dans la configuration de l'intégration. Non envoyée.",
  ),
  filterDisabled: both(
    'Filter commands are disabled: turn on "Allow the filter commands" in the configuration of the integration. Not sent.',
    "Les commandes du filtre sont désactivées : activez « Autoriser les commandes du filtre » dans la configuration de l'intégration. Non envoyée.",
  ),
  badValue: both('Unexpected value: not sent.', 'Valeur inattendue : non envoyée.'),
  badNumber: both(
    'The setpoint must be a number: not sent.',
    'La consigne doit être un nombre : non envoyée.',
  ),
  badStep: both(
    'The setpoint must be a multiple of 0.5 °C: not sent.',
    'La consigne doit être un multiple de 0,5 °C : non envoyée.',
  ),
  outOfBounds: (floor, ceiling) =>
    both(
      `The heater setpoint must stay between ${floor} and ${ceiling} °C (see the floor and the ceiling in the configuration): not sent.`,
      `La consigne du chauffage doit rester entre ${fr(floor)} et ${fr(ceiling)} °C (voir le plancher et le plafond dans la configuration) : non envoyée.`,
    ),
  badRange: both(
    'The setpoint floor is not below the ceiling in the configuration: not sent.',
    "Le plancher de la consigne n'est pas sous le plafond dans la configuration : non envoyée.",
  ),
  setpointOutside: (value, floor, ceiling) =>
    both(
      `The setpoint set on the heater (${value} °C) is outside ${floor}–${ceiling} °C: "On" not sent.`,
      `La consigne réglée sur le chauffage (${fr(value)} °C) est hors de ${fr(floor)}–${fr(ceiling)} °C : « Marche » non envoyée.`,
    ),
  fahrenheit: both(
    'The heater is set to °F: commands are only sent to a heater set to °C. Not sent.',
    'Le chauffage est réglé en °F : les commandes ne sont envoyées qu’à un chauffage réglé en °C. Non envoyée.',
  ),
  notConnected: both(
    'The EHEIM Digital hub is not connected: not sent.',
    "Le hub EHEIM Digital n'est pas connecté : non envoyée.",
  ),
  unknownDevice: both(
    'This device is not known to the hub connected now: not sent.',
    "Cet appareil n'est pas connu du hub connecté actuellement : non envoyée.",
  ),
  noFreshState: both(
    'The device did not send its state just now: not sent.',
    "L'appareil n'a pas envoyé son état à l'instant : non envoyée.",
  ),
  stateChanged: both(
    'The device state changed just before sending: not sent.',
    "L'état de l'appareil a changé juste avant l'envoi : non envoyée.",
  ),
  stillRunning: both(
    'Another command is still running: not sent.',
    'Une autre commande est encore en cours : non envoyée.',
  ),
  tooSlow: both(
    'No time left to send the command: not sent.',
    'Plus le temps d’envoyer la commande : non envoyée.',
  ),
  notSent: (reason) =>
    both(
      `The hub could not be reached (${reasonOf(reason).en}): not sent.`,
      `Le hub n'a pas pu être joint (${reasonOf(reason).fr}) : non envoyée.`,
    ),
  unconfirmed: both(
    'The previous command to this device is not confirmed yet: not sent. Try again once the device shows it (30 s at most).',
    "Une commande précédente vers cet appareil n'est pas encore confirmée : non envoyée. Réessayez quand l'appareil l'affiche (30 s au plus).",
  ),
  heaterOdd: both(
    'The heater reports settings outside the expected ranges (setpoint outside 18–32 °C, hysteresis, calibration offset or night reduction): not sent.',
    'Le chauffage indique des réglages hors des plages attendues (consigne hors 18–32 °C, hystérésis, décalage d’étalonnage ou baisse de nuit) : non envoyée.',
  ),
  nightBelowFloor: (night, floor) =>
    both(
      `In Bio mode the night setpoint would be ${night} °C, below the floor (${floor} °C): not sent.`,
      `En mode Bio la consigne de nuit serait de ${fr(night)} °C, sous le plancher (${fr(floor)} °C) : non envoyée.`,
    ),
  sentUnconfirmed: both(
    'Command sent, without confirmation: check the device in a few seconds.',
    "Commande envoyée, sans confirmation : vérifiez l'appareil dans quelques secondes.",
  ),
};
