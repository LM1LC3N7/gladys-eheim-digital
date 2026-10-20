// -----------------------------------------------------------------------------
// One websocket to the EHEIM Digital hub (`ws://<host>/ws`), with the `ws`
// library (already a dependency of the SDK). The hub talks when asked and
// when a value changes; nothing it sends is the answer of one request in
// particular. So this connection only:
//   - opens the socket (5 s at most), drops it on request;
//   - hands over the packets of each text message (src/eheim/protocol.js),
//     LIMITS.messagesPerSecond messages at most per second;
//   - writes a packet, after a last check (`beforeSend`) run right before
//     the bytes leave: what it throws is rethrown with `beforeSend: true` and
//     nothing is written. Once written, a packet may reach the device.
//
// Bounded: a message is 64 KiB at most (`maxPayload`: the library closes the
// socket above), binary messages ignored, no compression negotiated, no
// redirect followed; what we send is 4 KiB at most.
// -----------------------------------------------------------------------------

import WebSocket from 'ws';
import { LIMITS, SECOND, TIMINGS, WS_PATH } from '../constants.js';
import { parseMessage } from './protocol.js';

export const ERROR_KINDS = {
  /** No websocket could be opened: nothing was sent. */
  UNREACHABLE: 'unreachable',
  /** Something answered, but not with a websocket. */
  PROTOCOL: 'protocol',
  /** The connection closed (or is not open). */
  CLOSED: 'closed',
  /** The hub stopped talking (the connection is dropped). */
  SILENT: 'silent',
};

export class EheimError extends Error {
  constructor(kind, { sent = false } = {}) {
    super(kind);
    this.name = 'EheimError';
    this.kind = kind;
    this.sent = sent;
  }
}

/** A short reason for the logs and the messages: our own words only. */
export function errorReason(err) {
  return err instanceof EheimError ? err.kind : 'error';
}

/** The default socket factory. */
export const createWebSocket = (url, options) => new WebSocket(url, options);

export class EheimConnection {
  constructor({
    host,
    port,
    createSocket = createWebSocket,
    timers = globalThis,
    now = Date.now,
    onPacket = () => {},
    onClose = () => {},
  }) {
    this.host = host;
    this.port = port;
    this.createSocket = createSocket;
    this.timers = timers;
    this.now = now;
    this.onPacket = onPacket;
    this.onClose = onClose;
    this.socket = undefined;
    this.closed = false;
    this.window = { start: 0, count: 0 };
    this.lastMessageAt = 0;
  }

  get isOpen() {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN);
  }

  /** Opens the socket; rejects UNREACHABLE or PROTOCOL (nothing sent). */
  open() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      const fail = (kind) => {
        if (!settled) {
          settled = true;
          this.timers.clearTimeout(timer);
          try {
            socket?.terminate();
          } catch {
            // Already closed.
          }
          reject(new EheimError(kind));
        }
      };
      const timer = this.timers.setTimeout(
        () => fail(ERROR_KINDS.UNREACHABLE),
        TIMINGS.connectTimeout,
      );
      try {
        socket = this.createSocket(`ws://${this.host}:${this.port}${WS_PATH}`, {
          handshakeTimeout: TIMINGS.connectTimeout,
          maxPayload: LIMITS.messageBytes,
          perMessageDeflate: false,
          followRedirects: false,
        });
      } catch {
        fail(ERROR_KINDS.UNREACHABLE);
        return;
      }
      socket.once('unexpected-response', (_req, res) => {
        res?.resume?.();
        fail(ERROR_KINDS.PROTOCOL);
      });
      socket.on('error', () => {
        // Before 'open': unreachable; after: the 'close' that follows tells.
        fail(ERROR_KINDS.UNREACHABLE);
      });
      socket.once('close', () => fail(ERROR_KINDS.UNREACHABLE));
      socket.once('open', () => {
        if (settled) {
          return;
        }
        settled = true;
        this.timers.clearTimeout(timer);
        if (this.closed) {
          socket.terminate();
          reject(new EheimError(ERROR_KINDS.UNREACHABLE));
          return;
        }
        this.socket = socket;
        this.lastMessageAt = this.now();
        socket.on('message', (data, isBinary) => this.receive(socket, data, isBinary));
        socket.on('close', () => {
          if (this.socket === socket) {
            this.drop(new EheimError(ERROR_KINDS.CLOSED, { sent: true }));
          }
        });
        resolve();
      });
    });
  }

  receive(socket, data, isBinary) {
    if (socket !== this.socket) {
      return;
    }
    const now = this.now();
    this.lastMessageAt = now;
    if (now - this.window.start >= SECOND) {
      this.window = { start: now, count: 0 };
    }
    this.window.count += 1;
    if (this.window.count > LIMITS.messagesPerSecond || isBinary) {
      return;
    }
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    for (const packet of parseMessage(text)) {
      try {
        this.onPacket(packet);
      } catch {
        // A handler error never breaks the stream.
      }
      if (socket !== this.socket) {
        return;
      }
    }
  }

  /**
   * Writes one packet. Throws CLOSED when there is no connection (nothing
   * sent); `beforeSend` runs right before the bytes leave.
   */
  send(packet, { beforeSend } = {}) {
    const text = JSON.stringify(packet);
    if (text.length > LIMITS.sendBytes) {
      throw new EheimError(ERROR_KINDS.PROTOCOL);
    }
    if (!this.isOpen) {
      throw new EheimError(ERROR_KINDS.CLOSED);
    }
    if (beforeSend) {
      try {
        beforeSend();
      } catch (err) {
        err.beforeSend = true;
        throw err;
      }
    }
    // From here the packet may reach the device.
    this.socket.send(text);
  }

  /** Drops the connection for good (a stop, another address). */
  close() {
    this.closed = true;
    this.drop(new EheimError(ERROR_KINDS.CLOSED, { sent: true }));
  }

  /** Closes the socket; `onClose(err)` once per connection. */
  drop(err) {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    this.socket = undefined;
    try {
      socket.terminate();
    } catch {
      // Already closed.
    }
    try {
      this.onClose(err);
    } catch {
      // Never thrown back into the socket.
    }
  }
}
