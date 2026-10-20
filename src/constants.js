// -----------------------------------------------------------------------------
// Constants: the EHEIM Digital local protocol, manifest keys, feature roles,
// limits and timings.
//
// An EHEIM Digital hub (the "main" device of a mesh: any EHEIM Digital device
// with Wi-Fi) answers on `ws://<host>/ws` of the local network, without
// authentication, with JSON packets `{ title, from, to, ... }`. The protocol
// is not documented by EHEIM: everything here comes from the eheimdigital
// library (MIT, autinerd, 1.7.1, the library of Home Assistant's EHEIM
// Digital integration), and every message is checked and bounded
// (src/eheim/protocol.js, src/eheim/connection.js).
// -----------------------------------------------------------------------------

export const DEFAULT_PORT = 80;
export const WS_PATH = '/ws';

/** The device types (`version` of a USRDTA packet) this integration reads. */
export const DEVICE_TYPES = {
  FILTER: 4,
  HEATER: 5,
  FEEDER: 6,
  PH_CONTROL: 9,
  REEFLEX: 11,
  LED_CONTROL: 17,
  CLASSIC_VARIO: 18,
};

/** Per device type: its model name, the request of its data, the title of the answer. */
export const TYPE_INFO = {
  [DEVICE_TYPES.FILTER]: {
    model: 'professionel 5e',
    request: 'GET_FILTER_DATA',
    data: 'FILTER_DATA',
  },
  [DEVICE_TYPES.HEATER]: {
    model: 'thermocontrol+e',
    request: 'GET_EHEATER_DATA',
    data: 'HEATER_DATA',
  },
  [DEVICE_TYPES.FEEDER]: {
    model: 'autofeeder+',
    request: 'GET_FEEDER_DATA',
    data: 'FEEDER_DATA',
  },
  [DEVICE_TYPES.PH_CONTROL]: { model: 'pHcontrol+e', request: 'GET_PH_DATA', data: 'PH_DATA' },
  [DEVICE_TYPES.REEFLEX]: {
    model: 'reeflexUV+e',
    request: 'GET_REEFLEX_UVC_DATA',
    data: 'REEFLEX_DATA',
  },
  [DEVICE_TYPES.LED_CONTROL]: { model: 'classicLEDcontrol+e', request: 'REQ_CCV', data: 'CCV' },
  [DEVICE_TYPES.CLASSIC_VARIO]: {
    model: 'classicVARIO+e',
    request: 'GET_CLASSIC_VARIO_DATA',
    data: 'CLASSIC_VARIO_DATA',
  },
};

/** Feature roles (the last part of the feature external ids): frozen. */
export const FEATURES = {
  WATER_TEMPERATURE: 'water-temperature',
  TARGET_TEMPERATURE: 'target-temperature',
  HEATING: 'heating',
  HEATER_POWER: 'heater-power',
  HEATER_MODE: 'heater-mode',
  HEATER_ALERT: 'heater-alert',
  FILTER_POWER: 'filter-power',
  FILTER_SPEED: 'filter-speed',
  FILTER_FREQUENCY: 'filter-frequency',
  FILTER_MODE: 'filter-mode',
  FILTER_ERROR: 'filter-error',
  SERVICE_HOURS: 'service-hours',
  OPERATING_TIME: 'operating-time',
  PH: 'ph',
  TARGET_PH: 'target-ph',
  CO2_VALVE: 'co2-valve',
  PH_ALERT: 'ph-alert',
  CALIBRATION_DAYS: 'calibration-days',
  /** `light-channel-1` to `light-channel-4` (read only). */
  LIGHT_CHANNEL: 'light-channel',
  UV_LAMP: 'uv-lamp',
  UV_ACTIVE: 'uv-active',
  UV_MODE: 'uv-mode',
  FEEDER_WEIGHT: 'feeder-weight',
  FEEDER_DRUM: 'feeder-drum',
  FEEDER_SPINNING: 'feeder-spinning',
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/**
 * The aquarium heater setpoint Gladys may send, in °C. The thermocontrol+e
 * accepts 18 to 32 °C (Home Assistant's limits): nothing outside is ever
 * sent, whatever the configuration says. The configuration chooses a floor
 * and a ceiling inside, 22 and 28 °C by default.
 */
export const HEATER_LIMITS = {
  min: 18,
  max: 32,
  floor: { min: 18, max: 30, default: 22 },
  ceiling: { min: 20, max: 32, default: 28 },
};

/** The setpoint feature of Gladys: its slider (°C), frozen at creation. */
export const SETPOINT_FEATURE = { min: HEATER_LIMITS.min, max: HEATER_LIMITS.max };

export const POLL = { min: 15, max: 600, default: 30 };

export const LIMITS = {
  /** Gladys: 300 states per minute. */
  statesPerMinute: 300,
  statesPerRequest: 100,
  /**
   * One websocket message: 64 KiB at most (the `ws` library closes the
   * socket above). A USRDTA packet is about 1 KiB.
   */
  messageBytes: 64 * 1024,
  /** Packets in one message (the hub may send an array). */
  packetsPerMessage: 32,
  /** Messages handled per second; the extra ones are dropped. */
  messagesPerSecond: 50,
  /** Devices of one mesh (others are ignored). */
  devices: 16,
  /** Keys of one packet: a bigger object is not an EHEIM packet. */
  keysPerPacket: 80,
  /** A packet we send: 4 KiB at most. */
  sendBytes: 4 * 1024,
  /** Names typed in the EHEIM app. */
  nameLength: 64,
  /** Light channels of a classicLEDcontrol+e. */
  lightChannels: 4,
};

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;

export const TIMINGS = {
  /** Opening the websocket to the hub. */
  connectTimeout: 5 * SECOND,
  /** Failed connections: 10 s, 30 s, 1, 2, then 5 minutes. */
  backoff: [10 * SECOND, 30 * SECOND, 60 * SECOND, 2 * MINUTE, 5 * MINUTE],
  /** The watchdog runs every few seconds. */
  watchdog: 5 * SECOND,
  /** Silence (no message at all) after which the connection is dropped: at least this. */
  silenceMin: 90 * SECOND,
  /** A device without data for this many poll intervals (plus 30 s) is unreachable. */
  staleIntervals: 3,
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /** The Discovery list is republished at most this often. */
  changedEvery: 5 * SECOND,
  /** The "Test the connection" button. */
  testCooldown: 10 * SECOND,
  testWait: 5 * SECOND,
  /**
   * Commands (Gladys waits 5 s for the ack): the device data asked after
   * the click is awaited 2 s at most; the packet leaves by 3.5 s after the
   * click or is not sent; the effect is awaited until 4.3 s, after which
   * the command is "sent, without confirmation".
   */
  commandFreshBy: 2_000,
  commandSendBy: 3_500,
  commandAnswerBy: 4_300,
  /** After a command packet, the data asked again at these delays. */
  confirmAsk: [400, 1_500],
};
