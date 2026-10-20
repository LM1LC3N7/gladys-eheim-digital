// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { DEFAULT_PORT, HEATER_LIMITS, POLL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  address: '',
  allow_heater: false,
  min_temperature: HEATER_LIMITS.floor.default,
  max_temperature: HEATER_LIMITS.ceiling.default,
  allow_filter: false,
  poll_interval: POLL.default,
  language: 'fr',
};

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * The address of the hub typed by the user: an IPv4 address or a host name
 * (`eheimdigital.local`), with an optional port (80 by default). A pasted URL
 * is reduced to its host and port.
 * @returns {{ host: string, port: number } | undefined} undefined when invalid or empty.
 */
export function parseAddress(raw) {
  let text = String(raw ?? '')
    .trim()
    .toLowerCase();
  text = text.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '');
  if (text === '' || text.length > 260) {
    return undefined;
  }
  const match = text.match(/^([^:@]+)(?::(\d{1,5}))?$/);
  if (!match) {
    return undefined;
  }
  const host = match[1];
  const port = match[2] === undefined ? DEFAULT_PORT : Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || host.length > 253) {
    return undefined;
  }
  if (isIP(host) === 4) {
    return { host, port };
  }
  if (/^[\d.]+$/.test(host)) {
    return undefined;
  }
  return host.split('.').every((label) => LABEL.test(label)) ? { host, port } : undefined;
}

export const addressKey = ({ host, port }) => (port === DEFAULT_PORT ? host : `${host}:${port}`);

/** Only `true` (or the text "true") allows: anything else, missing included, refuses. */
const strictTrue = (value) => value === true || value === 'true';

/** A number typed in the form: a finite number, or undefined ('' and null are not 0). */
export function numberOf(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && /^\s*-?\d{1,4}(\.\d{1,3})?\s*$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

/** Half degrees within `range` (rounded towards the inside), else its default. */
function boundOf(value, range, round) {
  const number = numberOf(value);
  if (number === undefined) {
    return range.default;
  }
  return Math.min(range.max, Math.max(range.min, round(number * 2) / 2));
}

export function pollOf(value) {
  const number = numberOf(value);
  if (number === undefined) {
    return POLL.default;
  }
  return Math.min(POLL.max, Math.max(POLL.min, Math.round(number)));
}

export function normalizeConfig(raw = {}) {
  const c = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (Object.hasOwn(DEFAULT_CONFIG, key) && value != null) {
      c[key] = value;
    }
  }
  const typed = String(c.address ?? '').trim();
  const address = parseAddress(typed);
  // The floor rounded up, the ceiling rounded down: never wider than typed.
  const floor = boundOf(c.min_temperature, HEATER_LIMITS.floor, Math.ceil);
  const ceiling = boundOf(c.max_temperature, HEATER_LIMITS.ceiling, Math.floor);
  return {
    address,
    /** What was typed, when it is not a valid address (shown in the status). */
    invalid: typed !== '' && !address ? typed.slice(0, 100) : undefined,
    allowHeater: strictTrue(c.allow_heater),
    floor,
    ceiling,
    /** A floor at or above the ceiling: every setpoint is refused. */
    badRange: floor >= ceiling,
    allowFilter: strictTrue(c.allow_filter),
    pollInterval: pollOf(c.poll_interval),
    language: c.language === 'en' ? 'en' : 'fr',
  };
}
