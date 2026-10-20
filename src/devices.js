// -----------------------------------------------------------------------------
// The EHEIM Digital devices -> Gladys devices and their states (pure).
//
// `ext:<selector>:eheim:<mac>`: the MAC address of each EHEIM device (12 hex
// digits, the `from` of its packets), the only stable key (the IP address of
// the hub may change, and the devices of a mesh share it). The feature roles
// (the last part of their external ids) are published forever: never rename
// them.
//
// Living animals: no switch, no writable binary for the heater or the
// filter. A "turn everything off" (Google Home, Alexa, HomeKit, MCP,
// `switch.*` scenes) must never stop the heater or the filter of an aquarium.
// The heater and the filter pump are `text/select` lists (on/off), the
// setpoint `thermostat/target-temperature` (18–32 °C slider; the configured
// floor and ceiling refuse outside), every command behind an option off by
// default. Everything else is read only.
//
// A device published again never loses a feature: those of the device
// already created in Gladys are kept as they are (the core would mark it
// `structure_changed`, and "Update" would delete the missing feature and its
// history).
//
// Units are those the core lists (DEVICE_FEATURE_UNITS_BY_CATEGORY): °C on
// `temperature-sensor` and `thermostat`, `ph` on `ph-sensor`, hours, minutes
// and days on `duration`. Percentages, Hz and grams have no category with
// that unit: `unknown/unknown` without unit, the unit in the name.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  DEVICE_TYPES as D,
  FEATURES as F,
  LIMITS,
  SETPOINT_FEATURE,
  TYPE_INFO,
} from './constants.js';
import { classicVarioMode, filterMode, heaterCelsius, versionOf } from './eheim/protocol.js';
import { FEATURE_NAMES, OPTION_NAMES, STATE_TEXTS, word } from './i18n.js';

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});
const binary = sensor({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 });
const text = sensor({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false });
const number = (min, max) => sensor({ category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min, max });
const duration = (unit, max) =>
  sensor({ category: C.DURATION, type: T.DURATION.INTEGER, unit, min: 0, max });
const onOff = (language) => ({
  category: C.TEXT,
  type: T.TEXT.SELECT,
  min: 0,
  max: 0,
  read_only: false,
  has_feedback: true,
  keep_history: true,
  supported_options: ['on', 'off'].map((value, index) => ({
    value,
    label: word(OPTION_NAMES[value], language),
    sort_order: index,
  })),
});

/** The roles of each device type, in display order (light channels: as seen). */
export const TYPE_ROLES = {
  [D.HEATER]: [
    F.WATER_TEMPERATURE,
    F.TARGET_TEMPERATURE,
    F.HEATING,
    F.HEATER_POWER,
    F.HEATER_MODE,
    F.HEATER_ALERT,
  ],
  [D.CLASSIC_VARIO]: [
    F.FILTER_POWER,
    F.FILTER_SPEED,
    F.FILTER_MODE,
    F.FILTER_ERROR,
    F.SERVICE_HOURS,
  ],
  [D.FILTER]: [
    F.FILTER_POWER,
    F.FILTER_FREQUENCY,
    F.FILTER_MODE,
    F.SERVICE_HOURS,
    F.OPERATING_TIME,
  ],
  [D.PH_CONTROL]: [F.PH, F.TARGET_PH, F.CO2_VALVE, F.PH_ALERT, F.CALIBRATION_DAYS],
  [D.LED_CONTROL]: [],
  [D.REEFLEX]: [F.UV_LAMP, F.UV_ACTIVE, F.UV_MODE],
  [D.FEEDER]: [F.FEEDER_WEIGHT, F.FEEDER_DRUM, F.FEEDER_SPINNING],
};

/** `light-channel-2` -> 2, else undefined. */
export function channelOf(role) {
  const match = /^light-channel-([1-4])$/.exec(role);
  return match ? Number(match[1]) : undefined;
}

const ALL_ROLES = new Set(Object.values(TYPE_ROLES).flat());
const VALID_ROLE = (role) => ALL_ROLES.has(role) || channelOf(role) !== undefined;

/** The commands, by device type. */
export const COMMANDS = {
  [F.TARGET_TEMPERATURE]: [D.HEATER],
  [F.HEATER_POWER]: [D.HEATER],
  [F.FILTER_POWER]: [D.FILTER, D.CLASSIC_VARIO],
};

export const isCommand = (role, type) => (COMMANDS[role] ?? []).includes(type);

/** The roles a device shows from its data (the light channels its CCV gives). */
export function rolesOf(type, data) {
  const roles = [...(TYPE_ROLES[type] ?? [])];
  if (type === D.LED_CONTROL && data) {
    const count = Math.min(LIMITS.lightChannels, data.currentValues.length);
    for (let n = 1; n <= count; n += 1) {
      roles.push(`${F.LIGHT_CHANNEL}-${n}`);
    }
  }
  return roles;
}

/** The definition of a feature, by role. */
export function definitionOf(role, language) {
  switch (role) {
    case F.WATER_TEMPERATURE:
      return sensor({
        category: C.TEMPERATURE_SENSOR,
        type: T.TEMPERATURE_SENSOR.PROBE,
        unit: U.CELSIUS,
        min: -10,
        max: 50,
      });
    case F.TARGET_TEMPERATURE:
      return {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.TARGET_TEMPERATURE,
        unit: U.CELSIUS,
        min: SETPOINT_FEATURE.min,
        max: SETPOINT_FEATURE.max,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      };
    case F.HEATER_POWER:
    case F.FILTER_POWER:
      return onOff(language);
    case F.HEATING:
    case F.HEATER_ALERT:
    case F.CO2_VALVE:
    case F.UV_LAMP:
    case F.UV_ACTIVE:
    case F.FEEDER_SPINNING:
      return binary;
    case F.HEATER_MODE:
    case F.FILTER_MODE:
    case F.FILTER_ERROR:
    case F.PH_ALERT:
    case F.UV_MODE:
    case F.FEEDER_DRUM:
      return text;
    case F.FILTER_SPEED:
      return number(0, 100);
    case F.FILTER_FREQUENCY:
      return number(0, 200);
    case F.FEEDER_WEIGHT:
      return number(-1000, 10000);
    case F.SERVICE_HOURS:
      return duration(U.HOURS, 100_000);
    case F.OPERATING_TIME:
      return duration(U.MINUTES, 100_000_000);
    case F.CALIBRATION_DAYS:
      return duration(U.DAYS, 10_000);
    case F.PH:
    case F.TARGET_PH:
      return sensor({
        category: C.PH_SENSOR,
        type: T.PH_SENSOR.DECIMAL,
        unit: U.PH,
        min: 0,
        max: 14,
      });
    default:
      return number(0, 100);
  }
}

function nameOf(role, language) {
  const channel = channelOf(role);
  if (channel !== undefined) {
    return word(FEATURE_NAMES[F.LIGHT_CHANNEL](channel), language);
  }
  return word(FEATURE_NAMES[role], language);
}

/** The fields of a feature Gladys stores (what is kept of a created feature). */
const DECLARED = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
  'supported_options',
];

export const deviceIds = (gladys, mac) => gladys.externalIds('eheim', mac);

/** The MAC and the role of one of our feature external ids, else undefined. */
export function parseFeatureId(externalId) {
  if (typeof externalId !== 'string' || externalId.length > 200) {
    return undefined;
  }
  const match = /:eheim:([0-9a-f]{12}):([a-z0-9-]+)$/.exec(externalId);
  if (!match || !VALID_ROLE(match[2])) {
    return undefined;
  }
  return { mac: match[1], role: match[2] };
}

/** The MAC of one of our device external ids, else undefined. */
export function parseDeviceId(externalId) {
  const match = /:eheim:([0-9a-f]{12})$/.exec(String(externalId ?? '').slice(0, 200));
  return match ? match[1] : undefined;
}

/** The Gladys name of a device: its name in the EHEIM app, else its model. */
export function deviceName(device) {
  const model = TYPE_INFO[device.type]?.model ?? 'EHEIM Digital';
  return device.name ? device.name : `EHEIM ${model}`;
}

/**
 * The Gladys device of one EHEIM device. `roles`: those to show (in order);
 * `created`: the device already created in Gladys, whose features are kept
 * when the new build lacks them.
 */
export function buildDevice(gladys, device, { roles, language, created }) {
  const ids = deviceIds(gladys, device.mac);
  const params = [];
  const version = versionOf(device.revision);
  if (version) {
    params.push({ name: 'software', value: version });
  }
  if (device.aquarium) {
    params.push({ name: 'aquarium', value: device.aquarium });
  }
  const built = {
    name: deviceName(device),
    external_id: ids.device,
    model: `EHEIM ${TYPE_INFO[device.type]?.model ?? 'Digital'}`,
    should_poll: false,
    features: roles.map((role) => ({
      name: nameOf(role, language),
      external_id: ids.feature(role),
      ...definitionOf(role, language),
    })),
    params,
  };
  return keepCreatedFeatures(built, created);
}

/** The features of the created device that the new build lacks, kept as they are. */
export function keepCreatedFeatures(built, created) {
  if (!created) {
    return built;
  }
  const have = new Set(built.features.map((f) => f.external_id));
  const kept = (created.features ?? [])
    .filter((f) => typeof f?.external_id === 'string' && !have.has(f.external_id))
    .map((f) =>
      Object.fromEntries(
        DECLARED.filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]),
      ),
    );
  return { ...built, features: [...built.features, ...kept] };
}

const textOf = (table, key, language) => word(table[key] ?? table.unknown, language);

/** The current value of one role, `{ state }` or `{ text }`, else undefined. */
export function valueOf(role, type, data, language) {
  if (!data) {
    return undefined;
  }
  const channel = channelOf(role);
  if (channel !== undefined) {
    const value = data.currentValues?.[channel - 1];
    return value === undefined ? undefined : { state: value };
  }
  switch (role) {
    case F.WATER_TEMPERATURE:
      return { state: heaterCelsius(data.isTemp, data.mUnit) };
    case F.TARGET_TEMPERATURE:
      return { state: heaterCelsius(data.sollTemp, data.mUnit) };
    case F.HEATING:
      return { state: data.isHeating };
    case F.HEATER_POWER:
      return { text: data.active ? 'on' : 'off' };
    case F.HEATER_MODE:
      return { text: word(STATE_TEXTS.heaterMode[data.mode], language) };
    case F.HEATER_ALERT:
      return data.alertState === undefined ? undefined : { state: data.alertState ? 1 : 0 };
    case F.FILTER_POWER:
      return { text: data.filterActive ? 'on' : 'off' };
    case F.FILTER_SPEED:
      return { state: data.rel_speed };
    case F.FILTER_FREQUENCY:
      return data.freq === undefined ? undefined : { state: data.freq / 100 };
    case F.FILTER_MODE: {
      if (data.pumpMode === undefined) {
        return undefined;
      }
      const mode =
        type === D.CLASSIC_VARIO ? classicVarioMode(data.pumpMode) : filterMode(data.pumpMode);
      return { text: textOf(STATE_TEXTS.filterMode, mode ?? 'unknown', language) };
    }
    case F.FILTER_ERROR:
      return data.errorCode === undefined
        ? undefined
        : { text: textOf(STATE_TEXTS.filterError, data.errorCode, language) };
    case F.SERVICE_HOURS:
      return data.serviceHour === undefined ? undefined : { state: data.serviceHour };
    case F.OPERATING_TIME:
      return data.runTime === undefined ? undefined : { state: data.runTime };
    case F.PH:
      return { state: data.isPH / 10 };
    case F.TARGET_PH:
      return data.sollPH === undefined ? undefined : { state: data.sollPH / 10 };
    case F.CO2_VALVE:
      return data.valveIsActive === undefined ? undefined : { state: data.valveIsActive };
    case F.PH_ALERT:
      return data.alertState === undefined
        ? undefined
        : { text: textOf(STATE_TEXTS.phAlert, data.alertState, language) };
    case F.CALIBRATION_DAYS:
      return data.serviceTime === undefined ? undefined : { state: data.serviceTime };
    case F.UV_LAMP:
      return { state: data.isLighting };
    case F.UV_ACTIVE:
      return { state: data.isActive };
    case F.UV_MODE:
      return data.mode === undefined
        ? undefined
        : { text: word(STATE_TEXTS.uvMode[data.mode], language) };
    case F.FEEDER_WEIGHT:
      return data.weight === undefined ? undefined : { state: Math.round(data.weight * 10) / 10 };
    case F.FEEDER_DRUM:
      return data.drum === undefined
        ? undefined
        : { text: word(STATE_TEXTS.drum[data.drum], language) };
    case F.FEEDER_SPINNING:
      return data.isSpinning === undefined ? undefined : { state: data.isSpinning };
    default:
      return undefined;
  }
}

/** The current values of a device, `[{ role, state | text }]`: finite numbers only. */
export function deviceStates(roles, type, data, language) {
  const states = [];
  for (const role of roles) {
    const value = valueOf(role, type, data, language);
    if (value === undefined) {
      continue;
    }
    if ('state' in value && (typeof value.state !== 'number' || !Number.isFinite(value.state))) {
      continue;
    }
    if ('text' in value && typeof value.text !== 'string') {
      continue;
    }
    states.push({ role, ...value });
  }
  return states;
}
