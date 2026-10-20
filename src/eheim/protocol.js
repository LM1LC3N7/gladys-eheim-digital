// -----------------------------------------------------------------------------
// The EHEIM Digital packets (pure), ported from the eheimdigital library (MIT,
// autinerd, 1.7.1; see THIRD_PARTY_NOTICES.md).
//
// The hub answers on its websocket with JSON packets `{ title, from, to, ... }`,
// one per message or several in an array. The protocol is not documented by
// EHEIM: nothing the hub sends is trusted. Every packet is checked field by
// field against a whitelist (type and range), and only those fields are
// kept, in new objects (never the parsed object itself: no prototype
// pollution, no unknown field ever sent back). A packet with a required field
// missing or out of range is dropped whole. The e-mail address and the user
// name of the USRDTA packet are never read.
// -----------------------------------------------------------------------------

import { DEVICE_TYPES as D, LIMITS, TYPE_INFO } from '../constants.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The 12 lowercase hex digits of a MAC address `AA:BB:CC:DD:EE:FF`, else undefined. */
export function macOf(value) {
  if (typeof value !== 'string' || !/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i.test(value)) {
    return undefined;
  }
  return value.replaceAll(':', '').toLowerCase();
}

/** An own integer field within [min, max], else undefined. */
function int(packet, key, min, max) {
  if (!Object.hasOwn(packet, key)) {
    return undefined;
  }
  const value = packet[key];
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

/** An own finite number within [min, max], else undefined. */
function num(packet, key, min, max) {
  if (!Object.hasOwn(packet, key)) {
    return undefined;
  }
  const value = packet[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

/** Printable text of at most `max` characters (control characters removed), else undefined. */
export function cleanText(value, max = LIMITS.nameLength) {
  if (typeof value !== 'string' || value.length > 4 * max) {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return text === '' ? undefined : text.slice(0, max);
}

/** An own string field of at most `max` characters, kept as is ('' allowed), else undefined. */
function str(packet, key, max) {
  if (!Object.hasOwn(packet, key)) {
    return undefined;
  }
  const value = packet[key];
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f]/.test(value)
    ? value
    : undefined;
}

/** All the integer fields of `spec` ([key, min, max]), or undefined if one is missing. */
function ints(packet, spec) {
  const out = {};
  for (const [key, min, max] of spec) {
    const value = int(packet, key, min, max);
    if (value === undefined) {
      return undefined;
    }
    out[key] = value;
  }
  return out;
}

/**
 * The packets of one websocket message (text): an object or an array of at
 * most LIMITS.packetsPerMessage objects; each with a short `title` and a
 * `from`. Packets from another app ("USER" in `from`) are dropped, as the
 * library does. Never throws.
 */
export function parseMessage(text) {
  if (typeof text !== 'string' || text.length > LIMITS.messageBytes) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed.slice(0, LIMITS.packetsPerMessage) : [parsed];
  const packets = [];
  for (const packet of list) {
    if (!isObject(packet) || Object.keys(packet).length > LIMITS.keysPerPacket) {
      continue;
    }
    const title = str(packet, 'title', 40);
    const from = str(packet, 'from', 40);
    if (!title || !/^[A-Z_]+$/.test(title) || from === undefined || from.includes('USER')) {
      continue;
    }
    packets.push(packet);
  }
  return packets;
}

/**
 * A USRDTA packet: the identity of one device. `wire` is the address as the
 * hub spells it (sent back in `to`).
 */
export function parseUsrdta(packet) {
  const mac = macOf(packet.from);
  const type = int(packet, 'version', 0, 255);
  if (!mac || type === undefined) {
    return undefined;
  }
  const revision = Array.isArray(packet.revision) ? packet.revision : [];
  const [r0, r1] = revision;
  return {
    mac,
    wire: packet.from,
    type,
    name: cleanText(packet.name),
    aquarium: cleanText(packet.aqName),
    /** 0 metric, 1 US customary (the flow values of the filters). */
    unit: int(packet, 'unit', 0, 1) ?? 0,
    tankconfig: str(packet, 'tankconfig', 256) ?? '',
    revision:
      Number.isInteger(r0) && Number.isInteger(r1) && r0 >= 0 && r1 >= 0 && r0 < 1e6 && r1 < 1e6
        ? [r0, r1]
        : undefined,
  };
}

/** A MESH_NETWORK packet: the MAC addresses (wire form) of the devices of the mesh. */
export function parseMesh(packet) {
  if (!Array.isArray(packet.clientList)) {
    return [];
  }
  return packet.clientList.slice(0, LIMITS.devices).filter((entry) => macOf(entry) !== undefined);
}

/** The software version as the EHEIM page shows it, from the two revision numbers. */
export function versionOf(revision) {
  if (!revision) {
    return undefined;
  }
  const [rv0, rv1] = revision;
  const part = (rv) =>
    `${Math.floor(rv / 1000)}.${String(Math.floor((rv % 1000) / 10)).padStart(2, '0')}.${rv % 10}`;
  return `${part(rv1)} (page) ${part(rv0)} (server)`;
}

const MAC_OR_EMPTY = (value) => value === '' || macOf(value) !== undefined;

/**
 * HEATER_DATA (thermocontrol+e): every field a SET_EHEATER_PARAM sends back,
 * plus the measures. Temperatures in tenths of the heater unit.
 */
export function parseHeater(packet) {
  const out = ints(packet, [
    ['mUnit', 0, 1],
    ['sollTemp', 0, 1500],
    ['isTemp', -500, 1500],
    ['hystLow', 0, 100],
    ['hystHigh', 0, 100],
    ['offset', -100, 100],
    ['active', 0, 1],
    ['isHeating', 0, 1],
    ['mode', 0, 2],
    ['dayStartT', 0, 1439],
    ['nightStartT', 0, 1439],
    ['nReduce', 0, 100],
  ]);
  const sync = str(packet, 'sync', 17);
  const partnerName = str(packet, 'partnerName', LIMITS.nameLength);
  if (!out || sync === undefined || !MAC_OR_EMPTY(sync) || partnerName === undefined) {
    return undefined;
  }
  return { ...out, sync, partnerName, alertState: int(packet, 'alertState', 0, 255) };
}

/** CLASSIC_VARIO_DATA (classicVARIO+e): every field a SET_CLASSIC_VARIO_PARAM sends back. */
export function parseClassicVario(packet) {
  const out = ints(packet, [
    ['rel_speed', 0, 100],
    ['pumpMode', 0, 255],
    ['filterActive', 0, 1],
    ['rel_manual_motor_speed', 0, 100],
    ['rel_motor_speed_day', 0, 100],
    ['rel_motor_speed_night', 0, 100],
    ['startTime_day', 0, 1439],
    ['startTime_night', 0, 1439],
    ['pulse_motorSpeed_High', 0, 100],
    ['pulse_motorSpeed_Low', 0, 100],
    ['pulse_Time_High', 0, 65535],
    ['pulse_Time_Low', 0, 65535],
  ]);
  if (!out) {
    return undefined;
  }
  return {
    ...out,
    serviceHour: int(packet, 'serviceHour', 0, 1_000_000),
    errorCode: int(packet, 'errorCode', 0, 255),
  };
}

/** FILTER_DATA (professionel 5e): what is shown, and `filterActive`. */
export function parseFilter(packet) {
  const filterActive = int(packet, 'filterActive', 0, 1);
  if (filterActive === undefined) {
    return undefined;
  }
  return {
    filterActive,
    /** Hundredths of Hz. */
    freq: int(packet, 'freq', 0, 20_000),
    pumpMode: int(packet, 'pumpMode', 0, 65535),
    serviceHour: int(packet, 'serviceHour', 0, 1_000_000),
    /** Minutes. */
    runTime: int(packet, 'runTime', 0, 100_000_000),
  };
}

/** PH_DATA (pHcontrol+e): read only in v1. pH in tenths. */
export function parsePh(packet) {
  const isPH = int(packet, 'isPH', 0, 140);
  if (isPH === undefined) {
    return undefined;
  }
  return {
    isPH,
    sollPH: int(packet, 'sollPH', 0, 140),
    valveIsActive: int(packet, 'valveIsActive', 0, 1),
    alertState: int(packet, 'alertState', 0, 255),
    serviceTime: int(packet, 'serviceTime', 0, 100_000),
  };
}

/** CCV (classicLEDcontrol+e): the current level of each channel, in %. */
export function parseCcv(packet) {
  if (!Array.isArray(packet.currentValues)) {
    return undefined;
  }
  const values = packet.currentValues.slice(0, LIMITS.lightChannels);
  if (values.length === 0 || !values.every((v) => Number.isInteger(v) && v >= 0 && v <= 100)) {
    return undefined;
  }
  return { currentValues: [...values] };
}

/** REEFLEX_DATA (reeflexUV+e): read only. */
export function parseReeflex(packet) {
  const isLighting = int(packet, 'isLighting', 0, 1);
  const isActive = int(packet, 'isActive', 0, 1);
  if (isLighting === undefined || isActive === undefined) {
    return undefined;
  }
  return { isLighting, isActive, mode: int(packet, 'mode', 0, 1) };
}

/** FEEDER_DATA (autofeeder+): read only. */
export function parseFeeder(packet) {
  const weight = num(packet, 'weight', -10_000, 100_000);
  const isSpinning = int(packet, 'isSpinning', 0, 1);
  let drum;
  if (Array.isArray(packet.level) && packet.level.length >= 2) {
    const state = packet.level[1];
    drum = [0, 1, 2, 5].includes(state) ? state : undefined;
  }
  if (weight === undefined && isSpinning === undefined && drum === undefined) {
    return undefined;
  }
  return { weight, isSpinning, drum };
}

const PARSERS = {
  [D.FILTER]: parseFilter,
  [D.HEATER]: parseHeater,
  [D.FEEDER]: parseFeeder,
  [D.PH_CONTROL]: parsePh,
  [D.REEFLEX]: parseReeflex,
  [D.LED_CONTROL]: parseCcv,
  [D.CLASSIC_VARIO]: parseClassicVario,
};

export const isSupported = (type) => Object.hasOwn(TYPE_INFO, type);

/** The data packet of a device of `type`, parsed, or undefined (another title, invalid). */
export function parseData(type, packet) {
  if (!isSupported(type) || packet.title !== TYPE_INFO[type].data) {
    return undefined;
  }
  return PARSERS[type](packet);
}

/** The request of the data of one device. */
export const dataRequest = (type, wire) => ({
  title: TYPE_INFO[type].request,
  to: wire,
  from: 'USER',
});

/** The request of every USRDTA packet of the mesh. */
export const usrdtaRequest = () => ({ title: 'GET_USRDTA', to: 'ALL', from: 'USER' });

/**
 * SET_EHEATER_PARAM: the heater data received after the click, with the
 * changes. Only the fields of the library's packet, from our parsed copy.
 */
export function heaterParam(wire, data, changes) {
  const fields = [
    'mUnit',
    'sollTemp',
    'active',
    'hystLow',
    'hystHigh',
    'offset',
    'mode',
    'sync',
    'partnerName',
    'dayStartT',
    'nightStartT',
    'nReduce',
  ];
  const packet = { title: 'SET_EHEATER_PARAM', to: wire };
  for (const key of fields) {
    packet[key] = Object.hasOwn(changes, key) ? changes[key] : data[key];
  }
  packet.from = 'USER';
  return packet;
}

/** SET_CLASSIC_VARIO_PARAM: the classicVARIO data received after the click, with the changes. */
export function classicVarioParam(wire, data, changes) {
  const fields = [
    'filterActive',
    'rel_manual_motor_speed',
    'rel_motor_speed_day',
    'rel_motor_speed_night',
    'startTime_day',
    'startTime_night',
    'pulse_motorSpeed_High',
    'pulse_motorSpeed_Low',
    'pulse_Time_High',
    'pulse_Time_Low',
    'pumpMode',
  ];
  const packet = { title: 'SET_CLASSIC_VARIO_PARAM', to: wire };
  for (const key of fields) {
    packet[key] = Object.hasOwn(changes, key) ? changes[key] : data[key];
  }
  packet.from = 'USER';
  return packet;
}

/** SET_FILTER_PUMP (professionel 5e): on or off. */
export const filterPump = (wire, active) => ({
  title: 'SET_FILTER_PUMP',
  to: wire,
  active,
  from: 'USER',
});

/** °C (one decimal) of a heater value in tenths of its unit. */
export function heaterCelsius(tenths, mUnit) {
  const value = mUnit === 1 ? ((tenths / 10 - 32) * 5) / 9 : tenths / 10;
  return Math.round(value * 10) / 10;
}

/** The mode of a filter, as a word. */
export function classicVarioMode(pumpMode) {
  return { 16: 'manual', 8: 'pulse', 4: 'bio' }[pumpMode];
}

export function filterMode(pumpMode) {
  return pumpMode === undefined
    ? undefined
    : { 16: 'manual', 1: 'constant-flow', 8: 'pulse', 4: 'bio' }[pumpMode & 255];
}
