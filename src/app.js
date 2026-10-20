// -----------------------------------------------------------------------------
// The integration: the EHEIM Digital hub typed in the configuration (its
// address), one websocket kept open, the devices of its mesh (heater,
// filters, pH controller, LED controller, UV sterilizer, feeder), their
// Gladys devices and states, the transport badges, the "Test the
// connection" button, and the commands. index.js only wires the SDK handlers.
//
// Living animals depend on the heater and the filter. The commands follow
// the rules learnt on the previous modules, made stricter here:
//   - the heater (setpoint, on/off) and the filter pump (on/off) are refused
//     unless their option allows them (both off by default), in BOTH
//     directions: turning a heater or a filter off is not a "protective"
//     command for fish, so nothing bypasses the options;
//   - the setpoint stays between the configured floor and ceiling (22 and
//     28 °C by default), never outside 18–32 °C; "On" is refused when the
//     setpoint set on the heater is outside them;
//   - decided on data asked and received AFTER the click, never on the one
//     kept in memory, and refused when a value is missing;
//   - the options and the bounds are checked on arrival and again right
//     before the packet leaves (`beforeSend`), with the latest data;
//   - the packet leaves within 3.5 s of the click or is not sent; the effect
//     is awaited in the data until 4.3 s, then the answer is "sent, without
//     confirmation" (the protocol has no acknowledgement);
//   - one command at a time, never retried; the ack never waits for a
//     publication to Gladys.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { addressKey, normalizeConfig, numberOf } from './config.js';
import {
  DEVICE_TYPES as D,
  FEATURES as F,
  HEATER_LIMITS,
  HEATER_PLAUSIBLE,
  LIMITS,
  TIMINGS,
} from './constants.js';
import {
  buildDevice,
  deviceIds,
  deviceStates,
  isCommand,
  parseDeviceId,
  parseFeatureId,
  rolesOf,
} from './devices.js';
import { ERRORS, T, age, join, word } from './i18n.js';
import { EheimConnection, EheimError, ERROR_KINDS, errorReason } from './eheim/connection.js';
import {
  classicVarioParam,
  dataRequest,
  filterPump,
  heaterParam,
  isSupported,
  macOf,
  parseData,
  parseMesh,
  parseUsrdta,
  usrdtaRequest,
} from './eheim/protocol.js';
import { StatePublisher } from './publisher.js';

/** A wait that ended without its data. */
class WaitError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

const HEATER_ROLES = new Set([F.TARGET_TEMPERATURE, F.HEATER_POWER]);

export class EheimApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'eheim' }),
    createSocket,
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    /** The websocket factory (tests); the `ws` library otherwise. */
    this.createSocket = createSocket;
    this.now = now;
    this.timers = timers;
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.hub = undefined;
    this.generation = 0;
    this.started = false;
    this.lastStatus = undefined;
    this.published = undefined;
    this.badge = undefined;
    this.lastTestAt = -Infinity;
    this.watchdog = undefined;
    this.changeTimer = undefined;
    this.lastChangedAt = -Infinity;
    /** A data sequence number, shared by every device. */
    this.seq = 0;
    /** A command is running (one at a time). */
    this.busy = false;
    /** The device types already logged as not supported. */
    this.loggedTypes = new Set();
    /** kind -> the last publication of that kind (see serial()). */
    this.queues = {};
  }

  // --- Lifecycle -------------------------------------------------------------

  freshHub(address) {
    return {
      address,
      conn: undefined,
      /** The websocket is open. */
      linked: false,
      /** false after a failure; true once linked. */
      online: undefined,
      failures: 0,
      wait: undefined,
      error: undefined,
      timer: undefined,
      lastPollAt: -Infinity,
      /** mac -> the device entry (bounded by LIMITS.devices). */
      devices: new Map(),
      waiters: new Set(),
      liveKey: undefined,
      /** The MACs whose first data was published at once (once per MAC and run). */
      immediate: new Set(),
      /** mac -> when its USRDTA was last asked for a MESH_NETWORK list. */
      meshAsked: new Map(),
      /** mac -> { seq, done(data), until }: a command sent, not confirmed yet. */
      guards: new Map(),
    };
  }

  async start(raw = {}) {
    this.stop();
    this.config = normalizeConfig(raw);
    this.hub = this.config.address ? this.freshHub(this.config.address) : undefined;
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    this.publisher.start();
    if (!this.hub) {
      // The devices already created are shown unreachable.
      await this.publishAll();
      return;
    }
    const generation = this.generation;
    this.watchdog = this.timers.setInterval(() => {
      if (generation === this.generation) {
        this.check();
      }
    }, TIMINGS.watchdog);
    await this.updateStatus();
    await this.dial(this.hub);
  }

  stop() {
    this.generation += 1;
    if (this.watchdog) {
      this.timers.clearInterval(this.watchdog);
      this.watchdog = undefined;
    }
    if (this.changeTimer) {
      this.timers.clearTimeout(this.changeTimer);
      this.changeTimer = undefined;
    }
    const hub = this.hub;
    if (hub) {
      if (hub.timer) {
        this.timers.clearTimeout(hub.timer);
        hub.timer = undefined;
      }
      hub.conn?.close();
      this.endWaiters(hub, 'closed');
    }
    this.publisher.stop();
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (status, Discovery
   * list, badges) and the last states. The connection to the hub stays.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    if (this.needsRestart(raw)) {
      await this.start(raw);
      return;
    }
    this.config = normalizeConfig(raw);
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    this.gladys.forgetPublishedStates?.();
    await this.publishAll();
  }

  needsRestart(raw) {
    const next = normalizeConfig(raw);
    return (
      JSON.stringify(next.address ?? null) !== JSON.stringify(this.config.address ?? null) ||
      next.invalid !== this.config.invalid
    );
  }

  /** A new address restarts; the options, the bounds, the interval and the language apply at once. */
  async configUpdated(raw = {}) {
    if (this.needsRestart(raw)) {
      await this.start(raw);
      return;
    }
    const previous = this.config;
    this.config = normalizeConfig(raw);
    const c = this.config;
    if (
      c.allowHeater !== previous.allowHeater ||
      c.allowFilter !== previous.allowFilter ||
      c.floor !== previous.floor ||
      c.ceiling !== previous.ceiling
    ) {
      this.logger.info(
        `EHEIM options: heater ${c.allowHeater ? 'allowed' : 'disabled'} (${c.floor}–${c.ceiling} °C), filter ${c.allowFilter ? 'allowed' : 'disabled'}`,
      );
    }
    if (c.language !== previous.language) {
      await this.publishAll();
      return;
    }
    await this.updateStatus();
  }

  setStatus(connected, message) {
    return this.serial('status', () => this.setStatusNow(connected, message));
  }

  async setStatusNow(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- The connection ----------------------------------------------------------

  async dial(hub) {
    const generation = this.generation;
    if (hub.timer) {
      this.timers.clearTimeout(hub.timer);
      hub.timer = undefined;
    }
    const conn = new EheimConnection({
      host: hub.address.host,
      port: hub.address.port,
      timers: this.timers,
      now: this.now,
      ...(this.createSocket ? { createSocket: this.createSocket } : {}),
      onPacket: (packet) => {
        if (generation === this.generation && hub.conn === conn) {
          this.onPacket(hub, packet);
        }
      },
      onClose: (err) => {
        if (generation === this.generation && hub.conn === conn) {
          this.onClosed(hub, err);
        }
      },
    });
    hub.conn = conn;
    try {
      await conn.open();
    } catch (err) {
      if (generation === this.generation && hub.conn === conn) {
        await this.failed(hub, err);
      }
      return;
    }
    if (generation !== this.generation || hub.conn !== conn) {
      conn.close();
      return;
    }
    hub.linked = true;
    hub.online = true;
    hub.error = undefined;
    hub.wait = undefined;
    this.logger.info(`EHEIM Digital: connected to ${addressKey(hub.address)}`);
    this.poll(hub);
    await this.publishAll();
  }

  onClosed(hub, err) {
    hub.linked = false;
    this.endWaiters(hub, 'closed');
    this.failed(hub, err).catch(() => {});
  }

  async failed(hub, err) {
    const reason = errorReason(err);
    const wait = TIMINGS.backoff[Math.min(hub.failures, TIMINGS.backoff.length - 1)];
    hub.failures += 1;
    hub.online = false;
    hub.linked = false;
    hub.error = reason;
    hub.wait = wait;
    const generation = this.generation;
    if (hub.timer) {
      this.timers.clearTimeout(hub.timer);
    }
    hub.timer = this.timers.setTimeout(() => {
      hub.timer = undefined;
      if (generation === this.generation && this.hub === hub) {
        this.dial(hub).catch(() => this.logger.error('EHEIM Digital connection failed'));
      }
    }, wait);
    this.logger.warn(
      `EHEIM Digital ${addressKey(hub.address)}: ${reason}; next try in ${Math.round(wait / 1000)} s`,
    );
    await this.publishAll();
  }

  get pollMs() {
    return this.config.pollInterval * 1000;
  }

  /** Every few seconds: silence, the poll when due, the badges of devices gone quiet. */
  check() {
    const hub = this.hub;
    if (!hub?.linked || !hub.conn?.isOpen) {
      return;
    }
    const now = this.now();
    const silence = Math.max(TIMINGS.silenceMin, TIMINGS.staleIntervals * this.pollMs);
    if (now - hub.conn.lastMessageAt > silence) {
      this.logger.warn('EHEIM Digital: the hub stopped talking, connecting again');
      hub.conn.drop(new EheimError(ERROR_KINDS.SILENT, { sent: true }));
      return;
    }
    if (now - hub.lastPollAt >= this.pollMs) {
      this.poll(hub);
    }
    this.liveChanged();
  }

  sendQuietly(hub, packet) {
    try {
      hub.conn.send(packet);
    } catch {
      // Not connected: the watchdog or the reconnection tells.
    }
  }

  /** Asks every device of the mesh (USRDTA) and the data of every device known. */
  poll(hub) {
    if (!hub.linked) {
      return;
    }
    hub.lastPollAt = this.now();
    this.sendQuietly(hub, usrdtaRequest());
    for (const entry of hub.devices.values()) {
      if (isSupported(entry.type)) {
        this.sendQuietly(hub, dataRequest(entry.type, entry.wire));
      }
    }
  }

  // --- What the hub says ---------------------------------------------------------

  onPacket(hub, packet) {
    switch (packet.title) {
      case 'USRDTA':
        this.onUsrdta(hub, packet);
        return;
      case 'MESH_NETWORK':
        this.onMesh(hub, packet);
        return;
      default:
        this.onData(hub, packet);
    }
  }

  /**
   * The devices of a MESH_NETWORK list not known yet: each asked at most
   * once per poll interval (a hub repeating the list never makes us flood
   * it), LIMITS.meshAsked MACs remembered.
   */
  onMesh(hub, packet) {
    const now = this.now();
    for (const [mac, at] of hub.meshAsked) {
      if (now - at >= this.pollMs) {
        hub.meshAsked.delete(mac);
      }
    }
    for (const wire of parseMesh(packet)) {
      const mac = macOf(wire);
      if (
        hub.devices.has(mac) ||
        hub.devices.size >= LIMITS.devices ||
        hub.meshAsked.has(mac) ||
        hub.meshAsked.size >= LIMITS.meshAsked
      ) {
        continue;
      }
      hub.meshAsked.set(mac, now);
      this.sendQuietly(hub, { title: 'GET_USRDTA', to: wire, from: 'USER' });
    }
  }

  onUsrdta(hub, packet) {
    const identity = parseUsrdta(packet);
    if (!identity) {
      return;
    }
    // The hub talks on this connection: the backoff starts again from 10 s.
    hub.failures = 0;
    const known = hub.devices.get(identity.mac);
    if (known && known.type === identity.type) {
      const before = JSON.stringify([known.name, known.aquarium, known.revision, known.wire]);
      Object.assign(known, {
        name: identity.name,
        aquarium: identity.aquarium,
        revision: identity.revision,
        unit: identity.unit,
        wire: identity.wire,
      });
      if (before !== JSON.stringify([known.name, known.aquarium, known.revision, known.wire])) {
        this.changed();
      }
      return;
    }
    if (!known && hub.devices.size >= LIMITS.devices) {
      return;
    }
    // A new device, or another type at this address: what was known goes.
    hub.devices.set(identity.mac, {
      ...identity,
      data: undefined,
      dataKey: undefined,
      seq: 0,
      dataAt: -Infinity,
      seen: new Set(),
    });
    if (!isSupported(identity.type)) {
      if (!this.loggedTypes.has(identity.type) && this.loggedTypes.size < 64) {
        this.loggedTypes.add(identity.type);
        this.logger.info(`EHEIM Digital: device type ${identity.type} is not supported yet`);
      }
      return;
    }
    this.sendQuietly(hub, dataRequest(identity.type, identity.wire));
    this.changed();
  }

  onData(hub, packet) {
    const entry = hub.devices.get(macOf(packet.from));
    if (!entry) {
      return;
    }
    const data = parseData(entry.type, packet);
    if (!data) {
      return;
    }
    hub.failures = 0;
    const key = JSON.stringify(data);
    const first = entry.data === undefined;
    const same = key === entry.dataKey;
    const rolesBefore = first ? '' : rolesOf(entry.type, entry.data).join();
    entry.data = data;
    entry.dataKey = key;
    this.seq += 1;
    entry.seq = this.seq;
    entry.dataAt = this.now();
    const guard = hub.guards.get(entry.mac);
    if (guard && entry.seq > guard.seq && guard.entry === entry && guard.done(data)) {
      // Data shows the effect of the unconfirmed command: other commands may go.
      hub.guards.delete(entry.mac);
    }
    for (const waiter of [...hub.waiters]) {
      waiter.check();
    }
    if (first || rolesOf(entry.type, data).join() !== rolesBefore) {
      // At once only the first time a MAC gives data in this run (16 at most):
      // a hub flipping the type of a MAC goes through the 5 s limit.
      const now = first && !hub.immediate.has(entry.mac) && hub.immediate.size < LIMITS.devices;
      if (now) {
        hub.immediate.add(entry.mac);
      }
      this.changed(now);
    }
    if (!same) {
      this.queueStates(undefined, entry.mac);
      this.flush().catch(() => {});
    }
    this.liveChanged();
  }

  /**
   * Something the Discovery list depends on changed: published in the
   * background, at most once every TIMINGS.changedEvery (a hub repeating
   * itself never floods Gladys); `now` for the first data of a device.
   */
  changed(now = false) {
    const run = () => {
      this.lastChangedAt = this.now();
      this.publishAll().catch((err) => this.logger.warn(`Publishing failed: ${err.message}`));
    };
    if (now) {
      // The first data of a device: at most once per device (LIMITS.devices).
      if (this.changeTimer) {
        this.timers.clearTimeout(this.changeTimer);
        this.changeTimer = undefined;
      }
      run();
      return;
    }
    if (this.changeTimer) {
      return;
    }
    const wait = this.lastChangedAt + TIMINGS.changedEvery - this.now();
    if (wait <= 0) {
      run();
      return;
    }
    const generation = this.generation;
    this.changeTimer = this.timers.setTimeout(() => {
      this.changeTimer = undefined;
      if (generation === this.generation) {
        run();
      }
    }, wait);
  }

  /** Whether a device has given fresh data on the open connection. */
  isLive(entry) {
    if (!this.hub?.linked || !entry?.data) {
      return false;
    }
    const stale = TIMINGS.staleIntervals * this.pollMs + 30_000;
    return this.now() - entry.dataAt <= stale;
  }

  liveDevices() {
    return [...(this.hub?.devices.values() ?? [])].filter(
      (entry) => isSupported(entry.type) && this.isLive(entry),
    );
  }

  /** The badges and the status follow the devices that come and go. */
  liveChanged() {
    const hub = this.hub;
    if (!hub) {
      return;
    }
    const key = this.liveDevices()
      .map((e) => e.mac)
      .sort()
      .join();
    if (key === hub.liveKey) {
      return;
    }
    hub.liveKey = key;
    this.publishBadge()
      .then(() => this.updateStatus())
      .catch(() => {});
  }

  // --- Gladys ----------------------------------------------------------------

  async publishAll() {
    await this.publishDevices();
    this.queueStates();
    await this.flush();
    await this.publishBadge();
    await this.updateStatus();
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  createdDevice(externalId) {
    return (this.gladys.devices ?? []).find((d) => d?.external_id === externalId);
  }

  /** Our created devices: [{ device, mac }]. */
  ourDevices() {
    const list = [];
    for (const device of this.gladys.devices ?? []) {
      const mac = parseDeviceId(device?.external_id);
      if (mac && deviceIds(this.gladys, mac).device === device.external_id) {
        list.push({ device, mac });
      }
    }
    return list;
  }

  /** The roles of a device: those of its data, then any other seen during this run. */
  rolesFor(entry) {
    const roles = rolesOf(entry.type, entry.data);
    for (const role of roles) {
      entry.seen.add(role);
    }
    return [...roles, ...[...entry.seen].filter((role) => !roles.includes(role))];
  }

  /**
   * One publication of a kind at a time, in order: each builds its content
   * when its turn comes, so the last one to land is the latest (an older
   * list answered late never stays in Gladys).
   */
  serial(kind, run) {
    const next = (this.queues[kind] ?? Promise.resolve()).catch(() => {}).then(run);
    this.queues[kind] = next;
    return next;
  }

  /** The Discovery list: every supported device of the mesh that gave its data. */
  publishDevices() {
    return this.serial('devices', () => this.publishDevicesNow());
  }

  async publishDevicesNow() {
    const hub = this.hub;
    if (!hub) {
      return;
    }
    const devices = [...hub.devices.values()]
      .filter((entry) => isSupported(entry.type) && entry.data)
      .sort((a, b) => (a.mac < b.mac ? -1 : 1))
      .map((entry) =>
        buildDevice(this.gladys, entry, {
          roles: this.rolesFor(entry),
          language: this.config.language,
          created: this.createdDevice(deviceIds(this.gladys, entry.mac).device),
        }),
      );
    if (devices.length === 0) {
      return;
    }
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /**
   * Queues the states of the created devices that are live (`only`: one
   * MAC). An unreachable device keeps its last values in Gladys, its badge
   * says it.
   */
  queueStates(created = this.createdFeatures(), only = undefined) {
    const hub = this.hub;
    if (!hub) {
      return;
    }
    for (const { mac } of this.ourDevices()) {
      if (only !== undefined && mac !== only) {
        continue;
      }
      const entry = hub.devices.get(mac);
      if (!entry || !isSupported(entry.type) || !this.isLive(entry)) {
        continue;
      }
      const ids = deviceIds(this.gladys, mac);
      for (const { role, ...value } of deviceStates(
        this.rolesFor(entry),
        entry.type,
        entry.data,
        this.config.language,
      )) {
        const id = ids.feature(role);
        if (created.has(id)) {
          this.publisher.push(id, value);
        }
      }
    }
  }

  publishBadge() {
    return this.serial('badge', () => this.publishBadgeNow());
  }

  async publishBadgeNow() {
    const entries = this.ourDevices().map(({ device, mac }) => ({
      external_id: device.external_id,
      transport: this.isLive(this.hub?.devices.get(mac))
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.UNREACHABLE,
    }));
    const json = JSON.stringify(entries);
    if (entries.length === 0 || json === this.badge) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      this.badge = json;
    } catch (err) {
      this.logger.warn(`Transport badge failed: ${err.message}`);
    }
  }

  async updateStatus() {
    const [connected, message] = this.status();
    const c = this.config;
    await this.setStatus(
      connected,
      c.badRange ? join([message, T.badRange(c.floor, c.ceiling)]) : message,
    );
  }

  withInvalid(message) {
    return this.config.invalid ? join([message, T.invalid(this.config.invalid)]) : message;
  }

  status() {
    const hub = this.hub;
    if (!hub) {
      return [false, this.withInvalid(T.noAddress)];
    }
    if (hub.online === false) {
      return [false, T.unreachable(addressKey(hub.address), hub.error, age(hub.wait))];
    }
    if (hub.online === undefined) {
      return [false, T.connecting];
    }
    const live = this.liveDevices().length;
    if (live === 0) {
      return [false, T.waiting];
    }
    return [true, T.connected(live)];
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badge = undefined;
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(created);
    await this.flush();
    await this.publishBadge();
    await this.updateStatus();
  }

  async deviceDeleted(device) {
    this.badge = undefined;
    if (typeof device?.external_id === 'string') {
      this.publisher.forget(device.external_id);
    }
  }

  /**
   * The Discovery tab asks for a scan: the devices sent again; the hub asked
   * only when the poll is due anyway (never faster than the interval).
   */
  async scan() {
    const hub = this.hub;
    if (hub?.linked && this.now() - hub.lastPollAt >= Math.max(TIMINGS.testCooldown, this.pollMs)) {
      this.poll(hub);
    }
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Configuration button --------------------------------------------------

  async testConnection() {
    const hub = this.hub;
    if (!hub) {
      return this.withInvalid(T.noAddress);
    }
    const current = () => JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? T.connecting;
    if (this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      return join([T.test.cooldown, current()]);
    }
    this.lastTestAt = this.now();
    if (!hub.linked) {
      // A connection now, rather than at the end of the backoff.
      hub.failures = 0;
      await this.dial(hub);
    }
    if (hub.linked && this.liveDevices().length === 0) {
      this.poll(hub);
      await this.waitFor(
        hub,
        () => this.liveDevices().length > 0,
        this.now() + TIMINGS.testWait,
      ).catch(() => {});
      await this.publishAll();
    }
    return current();
  }

  // --- Waiting for the hub ---------------------------------------------------------

  /**
   * Resolves when `test()` is true (checked now and on every data packet),
   * or rejects at `by` or when the connection closes.
   */
  waitFor(hub, test, by) {
    return new Promise((resolve, reject) => {
      const waiter = {
        check: () => {
          let ok;
          try {
            ok = test();
          } catch {
            ok = false;
          }
          if (ok) {
            finish();
            resolve();
          }
        },
        end: (kind) => {
          finish();
          reject(new WaitError(kind));
        },
      };
      const timer = this.timers.setTimeout(() => waiter.end('late'), Math.max(0, by - this.now()));
      const finish = () => {
        this.timers.clearTimeout(timer);
        hub.waiters.delete(waiter);
      };
      hub.waiters.add(waiter);
      waiter.check();
    });
  }

  endWaiters(hub, kind) {
    for (const waiter of [...hub.waiters]) {
      waiter.end(kind);
    }
  }

  // --- The commands --------------------------------------------------------------

  refusal(text) {
    return new Error(word(text, this.config.language));
  }

  /**
   * The value of a command, checked strictly: a setpoint is a finite number
   * or a plain decimal text ('' and null are not 0), a multiple of 0.5 °C;
   * on/off one exact option.
   */
  parseCommand(role, value) {
    if (role === F.TARGET_TEMPERATURE) {
      const number = numberOf(value);
      if (number === undefined) {
        throw this.refusal(ERRORS.badNumber);
      }
      if (!Number.isInteger(number * 2)) {
        throw this.refusal(ERRORS.badStep);
      }
      return { kind: 'setpoint', value: number };
    }
    if (value !== 'on' && value !== 'off') {
      throw this.refusal(ERRORS.badValue);
    }
    return { kind: 'power', on: value === 'on' ? 1 : 0 };
  }

  /** The setpoint bounds of the latest configuration, refused outside. */
  checkBounds(value) {
    const c = this.config;
    if (c.badRange) {
      throw this.refusal(ERRORS.badRange);
    }
    if (
      value < c.floor ||
      value > c.ceiling ||
      value < HEATER_LIMITS.min ||
      value > HEATER_LIMITS.max
    ) {
      throw this.refusal(ERRORS.outOfBounds(c.floor, c.ceiling));
    }
  }

  /** The options and the bounds, on the latest configuration: no command bypasses them. */
  checkAllowed(role, wanted) {
    if (HEATER_ROLES.has(role)) {
      if (!this.config.allowHeater) {
        throw this.refusal(ERRORS.heaterDisabled);
      }
      if (wanted.kind === 'setpoint') {
        this.checkBounds(wanted.value);
      }
      return;
    }
    if (!this.config.allowFilter) {
      throw this.refusal(ERRORS.filterDisabled);
    }
  }

  async setValue(_device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.now();
    const target = parseFeatureId(feature?.external_id);
    if (!target) {
      throw this.refusal(ERRORS.readOnly);
    }
    const entry = this.hub?.devices.get(target.mac);
    if (!entry) {
      throw this.refusal(this.hub?.linked ? ERRORS.unknownDevice : ERRORS.notConnected);
    }
    if (!isCommand(target.role, entry.type)) {
      throw this.refusal(ERRORS.readOnly);
    }
    const wanted = this.parseCommand(target.role, value);
    this.checkAllowed(target.role, wanted);
    if (this.busy) {
      throw this.refusal(ERRORS.stillRunning);
    }
    this.busy = true;
    try {
      return await this.command(entry, target, wanted, received);
    } finally {
      this.busy = false;
    }
  }

  /**
   * The checks before every packet, on the latest configuration. With
   * `context.seq`: the data the decision was taken on must still be the
   * latest one.
   */
  checkBeforeSend(context, target, wanted) {
    this.checkAllowed(target.role, wanted);
    const hub = this.hub;
    if (
      context.generation !== this.generation ||
      hub !== context.hub ||
      !hub.linked ||
      hub.devices.get(target.mac) !== context.entry
    ) {
      throw this.refusal(ERRORS.unknownDevice);
    }
    if (context.seq !== undefined && context.entry.seq !== context.seq) {
      throw this.refusal(ERRORS.stateChanged);
    }
  }

  async command(entry, target, wanted, received) {
    const hub = this.hub;
    const context = {
      generation: this.generation,
      hub,
      entry,
      seq: undefined,
      sendBy: received + TIMINGS.commandSendBy,
      answerBy: received + TIMINGS.commandAnswerBy,
    };
    if (!hub?.linked) {
      throw this.refusal(ERRORS.notConnected);
    }
    this.checkBeforeSend(context, target, wanted);
    this.checkGuard(hub, target.mac);
    // Data asked and received after the click: never the one kept in memory.
    const after = entry.seq;
    try {
      hub.conn.send(dataRequest(entry.type, entry.wire));
    } catch (err) {
      throw this.refusal(ERRORS.notSent(errorReason(err)));
    }
    try {
      await this.waitFor(
        hub,
        () => entry.seq > after,
        Math.min(received + TIMINGS.commandFreshBy, context.sendBy),
      );
    } catch {
      throw this.refusal(ERRORS.noFreshState);
    }
    this.checkBeforeSend(context, target, wanted);
    // The latest data, read synchronously right before deciding.
    const data = entry.data;
    context.seq = entry.seq;
    const plan = this.plan(entry, target, wanted, data);
    if (!plan) {
      // Already so: nothing sent.
      return;
    }
    this.send(context, target, wanted, plan.packet, plan.check);
    const sentSeq = context.seq;
    this.logger.info(`EHEIM ${target.role}: command sent`);
    // Until data shows its effect (or 30 s), no other command on this device
    // is decided on data that may not show it yet (lifted in onData).
    hub.guards.set(target.mac, {
      seq: sentSeq,
      entry,
      done: plan.done,
      until: this.now() + TIMINGS.guard,
    });
    // The hub may not push the new data: asked again shortly after.
    const generation = this.generation;
    for (const delay of TIMINGS.confirmAsk) {
      this.timers.setTimeout(() => {
        if (generation === this.generation && this.hub === hub && hub.linked) {
          this.sendQuietly(hub, dataRequest(entry.type, entry.wire));
        }
      }, delay);
    }
    try {
      await this.waitFor(hub, () => entry.seq > sentSeq && plan.done(entry.data), context.answerBy);
    } catch {
      throw this.refusal(ERRORS.sentUnconfirmed);
    }
  }

  /**
   * What to send, decided on `data` (received after the click):
   * `{ packet, done(data), check() }`, or undefined when already so.
   */
  plan(entry, target, wanted, data) {
    const wire = entry.wire;
    if (entry.type === D.HEATER) {
      if (data.mUnit !== 0) {
        throw this.refusal(ERRORS.fahrenheit);
      }
      // Right before the packet: still °C, the bounds of the latest
      // configuration, and the packet itself plausible whatever the command.
      const checkWith = (packet) => () => {
        const latest = this.hub.devices.get(target.mac)?.data;
        if (!latest || latest.mUnit !== 0) {
          throw this.refusal(ERRORS.fahrenheit);
        }
        if (wanted.kind === 'setpoint') {
          this.checkBounds(wanted.value);
        } else if (wanted.on === 1) {
          this.checkSetpointInside(latest.sollTemp / 10);
        }
        this.checkHeaterPacket(packet);
      };
      if (wanted.kind === 'setpoint') {
        const tenths = Math.round(wanted.value * 10);
        if (data.sollTemp === tenths) {
          return undefined;
        }
        const packet = heaterParam(wire, data, { sollTemp: tenths });
        this.checkHeaterPacket(packet);
        return { packet, done: (d) => d.sollTemp === tenths, check: checkWith(packet) };
      }
      if (wanted.on === 1) {
        // "On" heats to the setpoint set on the heater: never outside the bounds.
        this.checkSetpointInside(data.sollTemp / 10);
      }
      if (data.active === wanted.on) {
        return undefined;
      }
      const packet = heaterParam(wire, data, { active: wanted.on });
      this.checkHeaterPacket(packet);
      return { packet, done: (d) => d.active === wanted.on, check: checkWith(packet) };
    }
    if (data.filterActive === wanted.on) {
      return undefined;
    }
    return {
      packet:
        entry.type === D.CLASSIC_VARIO
          ? classicVarioParam(wire, data, { filterActive: wanted.on })
          : filterPump(wire, wanted.on),
      done: (d) => d.filterActive === wanted.on,
      check: () => {},
    };
  }

  /**
   * A SET_EHEATER_PARAM never carries settings outside the plausible ranges
   * (HEATER_PLAUSIBLE): °C only, setpoint 18–32 °C, hysteresis, calibration
   * offset and night reduction bounded; in Bio mode with the heater on, the
   * night setpoint (setpoint − night reduction) stays at or above the floor.
   */
  checkHeaterPacket(packet) {
    if (packet.mUnit !== 0) {
      throw this.refusal(ERRORS.fahrenheit);
    }
    for (const [key, [min, max]] of Object.entries(HEATER_PLAUSIBLE)) {
      const value = packet[key];
      if (!Number.isInteger(value) || value < min || value > max) {
        throw this.refusal(ERRORS.heaterOdd);
      }
    }
    if (packet.active === 1 && packet.mode === 2) {
      const night = (packet.sollTemp - packet.nReduce) / 10;
      if (night < this.config.floor) {
        throw this.refusal(ERRORS.nightBelowFloor(night, this.config.floor));
      }
    }
  }

  /** A command sent without confirmation on this device: nothing else is decided yet. */
  checkGuard(hub, mac) {
    const guard = hub.guards.get(mac);
    if (!guard) {
      return;
    }
    if (this.now() >= guard.until) {
      hub.guards.delete(mac);
      return;
    }
    throw this.refusal(ERRORS.unconfirmed);
  }

  checkSetpointInside(value) {
    const c = this.config;
    if (c.badRange) {
      throw this.refusal(ERRORS.badRange);
    }
    if (value < c.floor || value > c.ceiling) {
      throw this.refusal(ERRORS.setpointOutside(value, c.floor, c.ceiling));
    }
  }

  /** Sends one packet now, or refuses unsent (late, not allowed, not connected). */
  send(context, target, wanted, packet, extraCheck) {
    if (this.now() > context.sendBy) {
      throw this.refusal(ERRORS.tooSlow);
    }
    try {
      context.hub.conn.send(packet, {
        // The very last check, right before the bytes leave.
        beforeSend: () => {
          this.checkBeforeSend(context, target, wanted);
          extraCheck();
        },
      });
    } catch (err) {
      if (err.beforeSend) {
        throw err;
      }
      throw this.refusal(ERRORS.notSent(errorReason(err)));
    }
  }
}
