// -----------------------------------------------------------------------------
// A fake EHEIM Digital hub behind the websocket factory: it reads the packets
// the client sends (JSON), answers the requests with the packets of the
// eheimdigital fixtures, and applies the SET_* packets. No network: every
// socket is an in-memory EventEmitter.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

export const HOST = '192.168.1.60';
export const NOW = Date.UTC(2026, 9, 20, 18, 0, 0);

export const HEATER = '44:17:93:28:DA:12';
export const VARIO = 'E4:65:B8:2B:60:5C';
export const PH = '64:B7:08:30:B0:58';
export const HEATER_ID = '44179328da12';
export const VARIO_ID = 'e465b82b605c';

export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const usrdta = (from, version, name) => ({
  title: 'USRDTA',
  from,
  name,
  aqName: 'Aquarium',
  version,
  language: 'EN',
  timezone: 60,
  tankconfig: '',
  power: '',
  netmode: 'ST',
  host: 'eheimdigital',
  revision: [2022, 2022],
  emailAddr: 'someone@example.com',
  usrName: 'someone',
  unit: 0,
  sysLED: 100,
  to: 'USER',
});

export function fakeHub({ withPh = false } = {}) {
  const hub = {
    heater: {
      title: 'HEATER_DATA',
      from: HEATER,
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
    },
    vario: {
      title: 'CLASSIC_VARIO_DATA',
      from: VARIO,
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
    },
    ph: {
      title: 'PH_DATA',
      from: PH,
      sollPH: 68,
      isPH: 70,
      active: 1,
      valveIsActive: 0,
      alertState: 0,
      serviceTime: 30,
      to: 'USER',
    },
    devices: [usrdta(HEATER, 5, 'Heizer'), usrdta(VARIO, 18, 'Filter')],
    /** Packets received (parsed). */
    received: [],
    connects: [],
    sockets: [],
    down: false,
    /** Requests are not answered. */
    mute: false,
    /** SET_* packets are received but not applied. */
    ignore: false,
    /** A SET_* is applied without pushing the new data (only a GET shows it). */
    silentSet: false,
  };
  if (withPh) {
    hub.devices.push(usrdta(PH, 9, 'pH'));
  }

  const write = (socket, value) => {
    setImmediate(() => {
      if (socket.readyState === 1) {
        socket.emit(
          'message',
          Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
          false,
        );
      }
    });
  };

  hub.push = (value) => {
    for (const socket of hub.sockets) {
      write(socket, value);
    }
  };

  const handle = (socket, packet) => {
    hub.received.push(packet);
    if (hub.mute) {
      return;
    }
    switch (packet.title) {
      case 'GET_USRDTA':
        if (packet.to === 'ALL') {
          write(socket, hub.devices);
        } else {
          const d = hub.devices.find((x) => x.from === packet.to);
          if (d) write(socket, d);
        }
        return;
      case 'GET_EHEATER_DATA':
        write(socket, hub.heater);
        return;
      case 'GET_CLASSIC_VARIO_DATA':
        write(socket, hub.vario);
        return;
      case 'GET_PH_DATA':
        write(socket, hub.ph);
        return;
      case 'SET_EHEATER_PARAM':
        if (!hub.ignore) {
          for (const key of ['sollTemp', 'active', 'mode']) {
            hub.heater[key] = packet[key];
          }
          if (!hub.silentSet) write(socket, hub.heater);
        }
        return;
      case 'SET_CLASSIC_VARIO_PARAM':
        if (!hub.ignore) {
          hub.vario.filterActive = packet.filterActive;
          if (!hub.silentSet) write(socket, hub.vario);
        }
        return;
      default:
    }
  };

  hub.createSocket = (url, options) => {
    hub.connects.push({ url, options });
    const socket = new EventEmitter();
    socket.readyState = 0;
    socket.terminate = () => {
      if (socket.readyState !== 3) {
        socket.readyState = 3;
        hub.sockets = hub.sockets.filter((s) => s !== socket);
        setImmediate(() => socket.emit('close'));
      }
    };
    socket.send = (text) => {
      if (socket.readyState !== 1) {
        throw new Error('not open');
      }
      handle(socket, JSON.parse(text));
    };
    setImmediate(() => {
      if (hub.down) {
        socket.readyState = 3;
        socket.emit(
          'error',
          Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
        );
        socket.emit('close');
      } else {
        socket.readyState = 1;
        hub.sockets.push(socket);
        socket.emit('open');
      }
    });
    return socket;
  };

  /** The SET_* packets received. */
  hub.commands = () => hub.received.filter((p) => p.title.startsWith('SET_'));
  return hub;
}
