// -----------------------------------------------------------------------------
// The packets (pure): the eheimdigital fixtures, and hostile input.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classicVarioParam,
  heaterCelsius,
  heaterParam,
  macOf,
  parseCcv,
  parseClassicVario,
  parseHeater,
  parseMessage,
  parseUsrdta,
  versionOf,
} from '../src/eheim/protocol.js';
import { keepCreatedFeatures } from '../src/devices.js';

// tests/fixtures/heater_data.json of eheimdigital.
const HEATER = {
  title: 'HEATER_DATA',
  from: '44:17:93:28:DA:12',
  mUnit: 0,
  sollTemp: 250,
  isTemp: 249,
  hystLow: 5,
  hystHigh: 5,
  offset: 0,
  active: 1,
  isHeating: 0,
  mode: 0,
  sync: '',
  partnerName: '',
  dayStartT: 0,
  nightStartT: 0,
  nReduce: 0,
  alertState: 0,
  to: 'USER',
};

// tests/fixtures/classic_vario_data.json of eheimdigital.
const VARIO = {
  title: 'CLASSIC_VARIO_DATA',
  from: 'E4:65:B8:2B:60:5C',
  rel_speed: 56,
  pumpMode: 4,
  filterActive: 1,
  turnOffTime: 0,
  serviceHour: 3683,
  rel_manual_motor_speed: 100,
  rel_motor_speed_day: 56,
  rel_motor_speed_night: 20,
  startTime_day: 600,
  startTime_night: 1080,
  pulse_motorSpeed_High: 100,
  pulse_motorSpeed_Low: 20,
  pulse_Time_High: 100,
  pulse_Time_Low: 50,
  turnTimeFeeding: 0,
  errorCode: 0,
  version: 0,
};

test('the SET packets match the fixtures of the library', () => {
  // tests/fixtures/set_eheater_param.json (with its day/night start times).
  assert.deepEqual(
    heaterParam(
      '44:17:93:28:DA:12',
      parseHeater({ ...HEATER, dayStartT: 390, nightStartT: 1080 }),
      {},
    ),
    {
      title: 'SET_EHEATER_PARAM',
      to: '44:17:93:28:DA:12',
      mUnit: 0,
      sollTemp: 250,
      active: 1,
      hystLow: 5,
      hystHigh: 5,
      offset: 0,
      mode: 0,
      sync: '',
      partnerName: '',
      dayStartT: 390,
      nightStartT: 1080,
      nReduce: 0,
      from: 'USER',
    },
  );
  // tests/fixtures/set_classic_vario_param.json.
  assert.deepEqual(classicVarioParam('E4:65:B8:2B:60:5C', parseClassicVario(VARIO), {}), {
    title: 'SET_CLASSIC_VARIO_PARAM',
    to: 'E4:65:B8:2B:60:5C',
    filterActive: 1,
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
});

test('a packet with one field missing or out of range is dropped whole', () => {
  assert.ok(parseHeater(HEATER));
  for (const [key, value] of [
    ['sollTemp', undefined],
    ['sollTemp', '250'],
    ['sollTemp', 25.5],
    ['active', 2],
    ['mode', 7],
    ['sync', 'not a mac'],
    ['partnerName', 'x'.repeat(200)],
  ]) {
    const packet = { ...HEATER, [key]: value };
    if (value === undefined) delete packet[key];
    assert.equal(parseHeater(packet), undefined, `${key}=${value}`);
  }
  assert.equal(parseClassicVario({ ...VARIO, rel_speed: 101 }), undefined);
  assert.equal(parseCcv({ currentValues: [10, 'x'] }), undefined);
  assert.deepEqual(parseCcv({ currentValues: [1, 2, 3, 4, 5, 6] }), {
    currentValues: [1, 2, 3, 4],
  });
});

test('only whitelisted fields are kept: nothing unknown is sent back', () => {
  const parsed = parseHeater({ ...HEATER, evil: 'x', constructor: 1 });
  assert.equal(parsed.evil, undefined);
  const packet = heaterParam('44:17:93:28:DA:12', parsed, { sollTemp: 260 });
  assert.equal(packet.evil, undefined);
  assert.equal(Object.keys(packet).length, 15);
});

test('parseMessage: bounded, linear, no prototype pollution', () => {
  assert.deepEqual(parseMessage('nope'), []);
  assert.deepEqual(parseMessage('null'), []);
  assert.deepEqual(parseMessage('[1,2,"x"]'), []);
  assert.equal(parseMessage(JSON.stringify(Array(100).fill(HEATER))).length, 32);
  assert.equal(parseMessage('x'.repeat(70 * 1024)).length, 0);
  const [packet] = parseMessage(
    '{"title":"USRDTA","from":"AA:BB:CC:DD:EE:FF","__proto__":{"x":1}}',
  );
  assert.equal({}.x, undefined);
  assert.equal(packet.x, undefined);
  // Another app talking to the hub, a title that is not one.
  assert.deepEqual(parseMessage(JSON.stringify({ title: 'USRDTA', from: 'USER' })), []);
  assert.deepEqual(parseMessage(JSON.stringify({ title: 'a b', from: 'x' })), []);
  const big = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]));
  assert.deepEqual(parseMessage(JSON.stringify({ title: 'X', from: 'y', ...big })), []);
});

test('USRDTA: the identity, never the e-mail address nor the user name', () => {
  const identity = parseUsrdta({
    title: 'USRDTA',
    from: '64:B7:08:30:B0:58',
    name: 'Aquarien\u0007licht',
    aqName: 'Aquarium',
    version: 17,
    revision: [2022, 2022],
    emailAddr: 'someone@example.com',
    usrName: 'someone',
    unit: 0,
  });
  assert.equal(identity.mac, '64b70830b058');
  assert.equal(identity.name, 'Aquarienlicht');
  assert.equal(identity.type, 17);
  assert.doesNotMatch(JSON.stringify(identity), /someone/);
  assert.equal(versionOf(identity.revision), '2.02.2 (page) 2.02.2 (server)');
  assert.equal(parseUsrdta({ title: 'USRDTA', from: 'nope', version: 5 }), undefined);
});

test('MAC addresses and °F', () => {
  assert.equal(macOf('44:17:93:28:DA:12'), '44179328da12');
  assert.equal(macOf('44:17:93:28:DA'), undefined);
  assert.equal(macOf({}), undefined);
  assert.equal(heaterCelsius(249, 0), 24.9);
  assert.equal(heaterCelsius(770, 1), 25);
});

test('a republished device keeps the features already created', () => {
  const built = { features: [{ external_id: 'a' }] };
  const created = { features: [{ external_id: 'a' }, { external_id: 'b', name: 'B', extra: 1 }] };
  assert.deepEqual(keepCreatedFeatures(built, created).features, [
    { external_id: 'a' },
    { external_id: 'b', name: 'B' },
  ]);
});
