// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake hub behind the websocket factory. Timers and Date are
// mocked: the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { EheimApp } from '../src/app.js';
import { ACTIONS, MINUTE, SECOND } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import {
  HEATER as HEATER_MAC,
  HEATER_ID,
  HOST,
  NOW,
  VARIO_ID,
  fakeHub,
  settle,
} from './helpers/fakeHub.js';

const CONFIG = { address: HOST };
const HEATER_ON = { address: HOST, allow_heater: true };
const FILTER_ON = { address: HOST, allow_filter: true };
const HEATER = `ext:test-integration:eheim:${HEATER_ID}`;
const VARIO = `ext:test-integration:eheim:${VARIO_ID}`;

async function setup(t, { config = CONFIG, hub = fakeHub(), create = true, logs = [], wrap } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  wrap?.(gladys);
  const app = new EheimApp({
    gladys,
    logger: recorder(logs),
    createSocket: hub.createSocket,
    now: () => Date.now(),
  });
  registerHandlers(gladys, app, recorder(logs));
  const advance = async (ms, step = 100) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  await advance(SECOND);
  if (create) {
    for (const d of [...gladys.fake.discoveredDevices]) {
      await gladys.fake.deviceCreated(d);
    }
    await settle();
  }
  /** A command on a feature of a created device; resolves with the ack. */
  const command = async (device, role, value, { wait = 5 * SECOND } = {}) => {
    const d = gladys.fake.devices.find((x) => x.external_id === device);
    const target = d.features.find((f) => f.external_id === `${device}:${role}`);
    const ack = gladys.fake.setValue(d, target, value);
    await settle();
    await advance(wait);
    return ack;
  };
  return { gladys, app, hub, advance, logs, command };
}

const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

const last = (gladys, device, role) => gladys.fake.lastState(`${device}:${role}`);
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const discovered = (gladys, id) => gladys.fake.discoveredDevices.find((d) => d.external_id === id);
const roles = (d) => d.features.map((f) => f.external_id.slice(d.external_id.length + 1));
const transportOf = (gladys, id) =>
  gladys.fake.transports.filter((x) => x.device_external_id === id).at(-1)?.transport;

test('without an address, the status asks for it and nothing is opened', async (t) => {
  const hub = fakeHub();
  const { gladys } = await setup(t, { config: {}, hub });
  assert.equal(hub.connects.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /adresse de votre hub EHEIM Digital/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /address of your EHEIM Digital hub/);
});

test('opens ws://host:80/ws, bounded, asks the mesh then each device, shows it connected', async (t) => {
  const hub = fakeHub();
  const { gladys } = await setup(t, { hub, create: false });
  assert.equal(hub.connects.length, 1);
  assert.equal(hub.connects[0].url, `ws://${HOST}:80/ws`);
  assert.equal(hub.connects[0].options.maxPayload, 64 * 1024);
  assert.equal(hub.connects[0].options.perMessageDeflate, false);
  assert.equal(hub.connects[0].options.followRedirects, false);
  assert.deepEqual(hub.received[0], { title: 'GET_USRDTA', to: 'ALL', from: 'USER' });
  const titles = hub.received.map((p) => p.title);
  assert.ok(titles.includes('GET_EHEATER_DATA'));
  assert.ok(titles.includes('GET_CLASSIC_VARIO_DATA'));
  assert.equal(hub.commands().length, 0, 'nothing but requests');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).fr, /Connecté : 2 appareils EHEIM Digital/);
});

test('one Gladys device per EHEIM device, no switch, the commands as lists', async (t) => {
  const { gladys } = await setup(t, { create: false });
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  const heater = discovered(gladys, HEATER);
  assert.equal(heater.name, 'Heizer');
  assert.equal(heater.model, 'EHEIM thermocontrol+e');
  assert.equal(heater.should_poll, false);
  assert.deepEqual(roles(heater), [
    'water-temperature',
    'target-temperature',
    'heating',
    'heater-power',
    'heater-mode',
    'heater-alert',
  ]);
  const vario = discovered(gladys, VARIO);
  assert.deepEqual(roles(vario), [
    'filter-power',
    'filter-speed',
    'filter-mode',
    'filter-error',
    'service-hours',
  ]);
  const all = [...heater.features, ...vario.features];
  assert.ok(all.every((f) => f.category !== 'switch'));
  // A "turn everything off" never reaches a writable binary.
  assert.ok(all.filter((f) => !f.read_only).every((f) => f.type !== 'binary'));
  const writable = all.filter((f) => !f.read_only).map((f) => [f.category, f.type]);
  assert.deepEqual(writable, [
    ['thermostat', 'target-temperature'],
    ['text', 'select'],
    ['text', 'select'],
  ]);
  const setpoint = heater.features.find((f) => f.type === 'target-temperature');
  assert.deepEqual([setpoint.min, setpoint.max, setpoint.unit], [18, 32, 'celsius']);
  // Neither the e-mail address nor the user name of the hub is ever published.
  const json = JSON.stringify(gladys.fake.discoveredDevices);
  assert.doesNotMatch(json, /someone/);
});

test('the values of the created devices, badges local', async (t) => {
  const { gladys } = await setup(t);
  assert.equal(last(gladys, HEATER, 'water-temperature'), 24.9);
  assert.equal(last(gladys, HEATER, 'target-temperature'), 25);
  assert.equal(last(gladys, HEATER, 'heating'), 0);
  assert.equal(last(gladys, HEATER, 'heater-power'), 'on');
  assert.equal(last(gladys, HEATER, 'heater-mode'), 'Manuel');
  assert.equal(last(gladys, VARIO, 'filter-power'), 'on');
  assert.equal(last(gladys, VARIO, 'filter-speed'), 56);
  assert.equal(last(gladys, VARIO, 'filter-mode'), 'Bio (jour/nuit)');
  assert.equal(last(gladys, VARIO, 'filter-error'), 'OK');
  assert.equal(last(gladys, VARIO, 'service-hours'), 3683);
  assert.equal(transportOf(gladys, HEATER), DEVICE_TRANSPORTS.LOCAL);
  assert.equal(transportOf(gladys, VARIO), DEVICE_TRANSPORTS.LOCAL);
});

test('a changed value is published at the next poll', async (t) => {
  const { gladys, hub, advance } = await setup(t);
  hub.heater.isTemp = 251;
  hub.heater.isHeating = 1;
  await advance(31 * SECOND, 1000);
  assert.equal(last(gladys, HEATER, 'water-temperature'), 25.1);
  assert.equal(last(gladys, HEATER, 'heating'), 1);
});

test('heater and filter commands refused by default, in both directions, nothing sent', async (t) => {
  const { hub, command } = await setup(t);
  for (const [device, role, value] of [
    [HEATER, 'target-temperature', 26],
    [HEATER, 'heater-power', 'off'],
    [HEATER, 'heater-power', 'on'],
    [VARIO, 'filter-power', 'off'],
    [VARIO, 'filter-power', 'on'],
  ]) {
    const ack = await command(device, role, value);
    assert.equal(ack.success, false, `${role} ${value}`);
    assert.match(ack.error, /désactivées/);
  }
  assert.equal(hub.commands().length, 0);
});

test('the setpoint: sent with the fresh data, bounded by the floor and the ceiling', async (t) => {
  const { gladys, hub, command } = await setup(t, { config: HEATER_ON });
  const before = hub.received.length;
  const ack = await command(HEATER, 'target-temperature', 26.5);
  assert.equal(ack.success, true, ack.error);
  // Fresh data asked after the click, before the packet.
  const after = hub.received.slice(before).map((p) => p.title);
  assert.ok(after.indexOf('GET_EHEATER_DATA') < after.indexOf('SET_EHEATER_PARAM'));
  assert.deepEqual(hub.commands().at(-1), {
    title: 'SET_EHEATER_PARAM',
    to: '44:17:93:28:DA:12',
    mUnit: 0,
    sollTemp: 265,
    active: 1,
    hystLow: 5,
    hystHigh: 5,
    offset: 0,
    mode: 0,
    sync: '',
    partnerName: '',
    dayStartT: 0,
    nightStartT: 0,
    nReduce: 0,
    from: 'USER',
  });
  assert.equal(last(gladys, HEATER, 'target-temperature'), 26.5);
  const sent = hub.commands().length;
  assert.match((await command(HEATER, 'target-temperature', 28.5)).error, /entre 22 et 28 °C/);
  assert.match((await command(HEATER, 'target-temperature', 21.5)).error, /entre 22 et 28 °C/);
  assert.match((await command(HEATER, 'target-temperature', 25.3)).error, /multiple de 0,5/);
  for (const bad of ['', null, 'abc', Number.NaN, '26°']) {
    assert.equal((await command(HEATER, 'target-temperature', bad)).success, false, String(bad));
  }
  assert.equal(hub.commands().length, sent, 'nothing else sent');
  assert.equal((await command(HEATER, 'target-temperature', '28')).success, true);
});

test('the configured ceiling never goes above 32 °C, the floor never below 18 °C', async (t) => {
  const config = { ...HEATER_ON, min_temperature: 5, max_temperature: 45 };
  const { hub, command } = await setup(t, { config });
  assert.match((await command(HEATER, 'target-temperature', 32.5)).error, /entre 18 et 32 °C/);
  assert.match((await command(HEATER, 'target-temperature', 17.5)).error, /entre 18 et 32 °C/);
  assert.equal(hub.commands().length, 0);
});

test('a floor at or above the ceiling refuses every setpoint and says so', async (t) => {
  const config = { ...HEATER_ON, min_temperature: 27, max_temperature: 26 };
  const { gladys, hub, command } = await setup(t, { config });
  assert.match(message(gladys).fr, /plancher de la consigne/);
  assert.match((await command(HEATER, 'target-temperature', 26)).error, /plancher/);
  assert.equal(hub.commands().length, 0);
});

test('heater off and on with the option; "on" refused when the setpoint is outside the bounds', async (t) => {
  const { gladys, hub, command } = await setup(t, { config: HEATER_ON });
  assert.equal((await command(HEATER, 'heater-power', 'off')).success, true);
  assert.equal(hub.commands().at(-1).active, 0);
  assert.equal(last(gladys, HEATER, 'heater-power'), 'off');
  hub.heater.sollTemp = 300;
  const ack = await command(HEATER, 'heater-power', 'on');
  assert.match(ack.error, /hors de 22–28 °C/);
  assert.equal(hub.commands().length, 1);
  hub.heater.sollTemp = 250;
  assert.equal((await command(HEATER, 'heater-power', 'on')).success, true);
  assert.equal(hub.commands().at(-1).active, 1);
  assert.equal((await command(HEATER, 'heater-power', 'maybe')).success, false);
});

test('already so: success, nothing sent', async (t) => {
  const { hub, command } = await setup(t, { config: { ...HEATER_ON, allow_filter: true } });
  assert.equal((await command(HEATER, 'target-temperature', 25)).success, true);
  assert.equal((await command(VARIO, 'filter-power', 'on')).success, true);
  assert.equal(hub.commands().length, 0);
});

test('the filter pump with its option: the full classicVARIO packet', async (t) => {
  const { gladys, hub, command } = await setup(t, { config: FILTER_ON });
  assert.equal((await command(VARIO, 'filter-power', 'off')).success, true);
  assert.deepEqual(hub.commands().at(-1), {
    title: 'SET_CLASSIC_VARIO_PARAM',
    to: 'E4:65:B8:2B:60:5C',
    filterActive: 0,
    rel_manual_motor_speed: 100,
    rel_motor_speed_day: 56,
    rel_motor_speed_night: 20,
    startTime_day: 600,
    startTime_night: 1080,
    pulse_motorSpeed_High: 100,
    pulse_motorSpeed_Low: 20,
    pulse_Time_High: 100,
    pulse_Time_Low: 50,
    pumpMode: 4,
    from: 'USER',
  });
  assert.equal(last(gladys, VARIO, 'filter-power'), 'off');
  // The heater option does not follow the filter one.
  assert.match((await command(HEATER, 'heater-power', 'off')).error, /chauffage sont désactivées/);
});

test('no fresh data after the click: refused, nothing sent', async (t) => {
  const { hub, command } = await setup(t, { config: HEATER_ON });
  hub.mute = true;
  const ack = await command(HEATER, 'target-temperature', 26);
  assert.match(ack.error, /pas envoyé son état à l'instant/);
  assert.equal(hub.commands().length, 0);
});

test('the option turned off while the fresh data is awaited: refused before sending', async (t) => {
  const { app, hub, gladys, advance } = await setup(t, { config: HEATER_ON });
  hub.mute = true;
  const d = gladys.fake.devices.find((x) => x.external_id === HEATER);
  const f = d.features.find((x) => x.external_id === `${HEATER}:target-temperature`);
  const ack = gladys.fake.setValue(d, f, 26);
  await settle();
  await advance(300);
  await app.configUpdated({ address: HOST, allow_heater: false });
  hub.mute = false;
  hub.push(hub.heater);
  await advance(5 * SECOND);
  const result = await ack;
  assert.match(result.error, /chauffage sont désactivées/);
  assert.equal(hub.commands().length, 0);
});

test('a ceiling lowered while waiting stops the setpoint', async (t) => {
  const { app, hub, gladys, advance } = await setup(t, { config: HEATER_ON });
  hub.mute = true;
  const d = gladys.fake.devices.find((x) => x.external_id === HEATER);
  const f = d.features.find((x) => x.external_id === `${HEATER}:target-temperature`);
  const ack = gladys.fake.setValue(d, f, 27);
  await settle();
  await advance(300);
  await app.configUpdated({ ...HEATER_ON, max_temperature: 26 });
  hub.mute = false;
  hub.push(hub.heater);
  await advance(5 * SECOND);
  assert.match((await ack).error, /entre 22 et 26 °C/);
  assert.equal(hub.commands().length, 0);
});

test('no effect seen by 4.3 s: "sent, without confirmation", never retried', async (t) => {
  const { hub, command } = await setup(t, { config: HEATER_ON });
  hub.ignore = true;
  const ack = await command(HEATER, 'target-temperature', 26);
  assert.match(ack.error, /envoyée, sans confirmation/);
  assert.equal(hub.commands().length, 1);
});

test('a set the hub does not push is confirmed by the data asked again', async (t) => {
  const { hub, command } = await setup(t, { config: HEATER_ON });
  hub.silentSet = true;
  const ack = await command(HEATER, 'target-temperature', 26);
  assert.equal(ack.success, true, ack.error);
});

test('a heater set to °F is never commanded', async (t) => {
  const { hub, command } = await setup(t, { config: HEATER_ON });
  hub.heater.mUnit = 1;
  hub.heater.sollTemp = 770;
  const ack = await command(HEATER, 'target-temperature', 25);
  assert.match(ack.error, /°F/);
  assert.equal(hub.commands().length, 0);
});

test('one command at a time', async (t) => {
  const { hub, gladys, advance } = await setup(t, { config: { ...HEATER_ON, allow_filter: true } });
  hub.mute = true;
  const d = gladys.fake.devices.find((x) => x.external_id === HEATER);
  const f = d.features.find((x) => x.external_id === `${HEATER}:target-temperature`);
  const v = gladys.fake.devices.find((x) => x.external_id === VARIO);
  const vf = v.features.find((x) => x.external_id === `${VARIO}:filter-power`);
  const first = gladys.fake.setValue(d, f, 26);
  await settle();
  const second = gladys.fake.setValue(v, vf, 'off');
  await settle();
  await advance(5 * SECOND);
  assert.match((await second).error, /encore en cours/);
  assert.equal((await first).success, false);
  assert.equal(hub.commands().length, 0);
});

test('read-only features refuse commands', async (t) => {
  const { command } = await setup(t, { config: { ...HEATER_ON, allow_filter: true } });
  assert.match((await command(HEATER, 'water-temperature', 20)).error, /lecture seule/);
  assert.match((await command(VARIO, 'filter-speed', 20)).error, /lecture seule/);
});

test('the hub down: unreachable status and badges, retried after 10 s', async (t) => {
  const hub = fakeHub();
  const { gladys, advance } = await setup(t, { hub });
  hub.down = true;
  for (const socket of [...hub.sockets]) {
    socket.terminate();
  }
  await advance(SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /Pas de connexion au hub/);
  assert.equal(transportOf(gladys, HEATER), DEVICE_TRANSPORTS.UNREACHABLE);
  hub.down = false;
  await advance(11 * SECOND, 500);
  assert.equal(hub.connects.length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(transportOf(gladys, HEATER), DEVICE_TRANSPORTS.LOCAL);
});

test('a silent hub is dropped and connected again', async (t) => {
  const hub = fakeHub();
  const { advance } = await setup(t, { hub });
  hub.mute = true;
  await advance(110 * SECOND, 1000);
  assert.ok(hub.connects.length >= 2);
});

test('a reconnection to Gladys sends the status, Discovery and badges again', async (t) => {
  const { gladys, app } = await setup(t);
  gladys.fake.discoveredDevices.length = 0;
  gladys.fake.transports.length = 0;
  await app.connected({ address: HOST });
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.equal(transportOf(gladys, HEATER), DEVICE_TRANSPORTS.LOCAL);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the pH controller is read only', async (t) => {
  const hub = fakeHub({ withPh: true });
  const { gladys } = await setup(t, { hub });
  const id = 'ext:test-integration:eheim:64b70830b058';
  assert.equal(last(gladys, id, 'ph'), 7);
  assert.equal(last(gladys, id, 'target-ph'), 6.8);
  assert.equal(last(gladys, id, 'co2-valve'), 0);
  assert.ok(discovered(gladys, id).features.every((f) => f.read_only));
});

test('junk from the hub is ignored: no crash, nothing published from it', async (t) => {
  const { gladys, hub, advance, logs } = await setup(t);
  hub.push('not json');
  hub.push('{"title":"HEATER_DATA","from":"44:17:93:28:DA:12","__proto__":{"polluted":1}}');
  hub.push({ ...hub.heater, isTemp: 'hot' });
  hub.push({ ...hub.heater, isTemp: 9999 });
  hub.push(Array.from({ length: 100 }, () => ({ ...hub.heater, isTemp: 260 })));
  hub.push({ ...hub.heater, from: 'USER', isTemp: 200 });
  await advance(SECOND);
  assert.equal({}.polluted, undefined);
  // The array was cut to 32 packets, all valid: the value is 26.
  assert.equal(last(gladys, HEATER, 'water-temperature'), 26);
  assert.ok(
    logs.every((l) => !/44:17|44179328da12|someone/i.test(l)),
    'no MAC nor e-mail logged',
  );
});

test('the test button connects and answers with the device count', async (t) => {
  const { gladys } = await setup(t);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.fr, /2 appareils/);
});

// --- Review 1 -----------------------------------------------------------------

const dropAll = (hub) => {
  for (const socket of [...hub.sockets]) socket.terminate();
};

test('R1 a command sent without confirmation guards its device until data shows it', async (t) => {
  const { hub, command, advance } = await setup(t, { config: HEATER_ON });
  hub.ignore = true; // the hub is slow: the "off" is not applied yet
  const off = await command(HEATER, 'heater-power', 'off', { wait: 4400 });
  assert.match(off.error, /sans confirmation/);
  hub.ignore = false;
  // A setpoint right after would resend active=1 from data that does not show the "off".
  const next = await command(HEATER, 'target-temperature', 26);
  assert.match(next.error, /pas encore confirmée/);
  assert.deepEqual(
    hub.commands().map((p) => p.active),
    [0],
  );
  // The heater shows the "off" at the next poll: the guard goes.
  hub.heater.active = 0;
  await advance(31 * SECOND, 1000);
  const after = await command(HEATER, 'target-temperature', 26);
  assert.equal(after.success, true, after.error);
  assert.equal(hub.commands().at(-1).active, 0, 'the "off" is kept');
});

test('R1b the guard expires after 30 s when the effect never shows', async (t) => {
  const { hub, command, advance } = await setup(t, { config: HEATER_ON });
  hub.ignore = true;
  await command(HEATER, 'target-temperature', 27, { wait: 4400 });
  assert.match((await command(HEATER, 'target-temperature', 26)).error, /pas encore confirmée/);
  await advance(30 * SECOND, 1000);
  hub.ignore = false;
  assert.equal((await command(HEATER, 'target-temperature', 26)).success, true);
});

test('R2 a packet carrying a setpoint outside 18–32 °C or odd settings is never sent', async (t) => {
  const { hub, command } = await setup(t, { config: HEATER_ON });
  hub.heater.sollTemp = 350; // 35 °C set in the EHEIM app (or a hostile hub)
  assert.match((await command(HEATER, 'heater-power', 'off')).error, /hors des plages attendues/);
  hub.heater.sollTemp = 250;
  for (const [key, value] of [
    ['offset', -100],
    ['nReduce', 100],
    ['hystLow', 50],
  ]) {
    const saved = hub.heater[key];
    hub.heater[key] = value;
    const ack = await command(HEATER, 'heater-power', 'off');
    assert.match(ack.error, /hors des plages attendues/, key);
    hub.heater[key] = saved;
  }
  assert.equal(hub.commands().length, 0);
});

test('R2b Bio mode: the night setpoint stays at or above the floor', async (t) => {
  const { hub, command } = await setup(t, { config: HEATER_ON });
  hub.heater.mode = 2;
  hub.heater.nReduce = 40; // 4 °C at night
  // 25 − 4 = 21 °C < 22 °C.
  assert.match((await command(HEATER, 'target-temperature', 25.5)).error, /nuit serait de 21,5/);
  assert.equal((await command(HEATER, 'target-temperature', 26)).success, true);
  assert.equal(hub.commands().length, 1);
});

test('R3 a hub flipping the type of a MAC never floods the Discovery list', async (t) => {
  const hub = fakeHub();
  const { gladys, advance } = await setup(t, { hub });
  const count = () =>
    gladys.fake.requests.filter((r) => r.method === 'POST' && r.path === '/discovered_device')
      .length;
  const before = count();
  const usr = (version) => ({ ...hub.devices[0], version });
  const burst = [];
  for (let i = 0; i < 8; i += 1) {
    burst.push(usr(5), hub.heater, usr(18), { ...hub.vario, from: HEATER_MAC });
  }
  for (let m = 0; m < 50; m += 1) hub.push(burst);
  await advance(11 * SECOND, 50);
  assert.ok(count() - before <= 3, `published ${count() - before}`);
});

test('R4 MESH_NETWORK lists never amplify into a flood of requests', async (t) => {
  const hub = fakeHub();
  const { advance } = await setup(t, { hub });
  const asked = () => hub.received.filter((p) => p.title === 'GET_USRDTA' && p.to !== 'ALL').length;
  const before = asked();
  const macs = Array.from({ length: 16 }, (_, i) => `AA:BB:CC:DD:EE:${String(i).padStart(2, '0')}`);
  hub.mute = true;
  const mesh = Array.from({ length: 32 }, () => ({
    title: 'MESH_NETWORK',
    from: HEATER_MAC,
    clientList: macs,
  }));
  for (let m = 0; m < 50; m += 1) hub.push(mesh);
  await advance(SECOND, 50);
  // Each unknown MAC asked once.
  assert.equal(asked() - before, 16);
  for (let m = 0; m < 50; m += 1) hub.push(mesh);
  await advance(SECOND, 50);
  assert.equal(asked() - before, 16, 'not asked again within the interval');
});

test('R5 the backoff starts again from 10 s once the hub talked', async (t) => {
  const hub = fakeHub();
  const { advance } = await setup(t, { hub });
  for (const w of [10, 30, 60, 120, 300]) {
    hub.down = true;
    dropAll(hub);
    await advance(SECOND, 500);
    hub.down = false;
    await advance((w + 2) * SECOND, 1000);
  }
  const before = hub.connects.length;
  await advance(10 * MINUTE, 5000);
  dropAll(hub);
  await advance(12 * SECOND, 1000);
  assert.equal(hub.connects.length - before, 1, 'reconnected after 10 s');
});

test('R6 an older Discovery list answered late never stays in Gladys', async (t) => {
  let n = 0;
  const wrap = (gladys) => {
    const orig = gladys.publishDiscoveredDevices.bind(gladys);
    gladys.publishDiscoveredDevices = (devices) => {
      n += 1;
      const delay = n === 1 ? 300 : 0;
      return new Promise((resolve, reject) =>
        setTimeout(() => orig(devices).then(resolve, reject), delay),
      );
    };
  };
  const { gladys, advance } = await setup(t, { create: false, wrap });
  await advance(2 * SECOND);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('R9 a scan never asks the hub faster than the interval', async (t) => {
  const hub = fakeHub();
  const { gladys, advance } = await setup(t, {
    hub,
    config: { address: HOST, poll_interval: 600 },
  });
  const before = hub.received.filter((p) => p.title === 'GET_USRDTA').length;
  for (let i = 0; i < 6; i += 1) {
    await gladys.fake.scanRequest();
    await advance(10 * SECOND, 1000);
  }
  assert.equal(hub.received.filter((p) => p.title === 'GET_USRDTA').length - before, 0);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('R10 the reason of a failure is translated', async (t) => {
  const hub = fakeHub();
  const { gladys, advance } = await setup(t, { hub });
  hub.down = true;
  dropAll(hub);
  await advance(SECOND);
  assert.match(message(gladys).fr, /connexion fermée/);
  assert.match(message(gladys).en, /connection closed/);
});
