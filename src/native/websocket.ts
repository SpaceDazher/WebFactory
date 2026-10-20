import type { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { createHash } from 'node:crypto';

export const NATIVE_WS_MAX_MESSAGE = 8 * 1024 * 1024;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const frame = (opcode: number, data: Uint8Array) => {
  const n = data.byteLength;
  let head: Buffer;
  if (n < 126) { head = Buffer.from([0x80 | opcode, n]); }
  else if (n <= 0xffff) { head = Buffer.allocUnsafe(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.allocUnsafe(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, Buffer.from(data.buffer, data.byteOffset, data.byteLength)]);
};

export type NativeSocket = {
  authenticated?(identity: import('../net/native-transport-protocol').NativeTransportIdentity): void;
  onUnavailable?: () => void;
  setMessageLimit?(bytes: number): void;
  send(text: string): boolean;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readonly bufferedBytes: number;
  readonly isOpen: boolean;
  readonly maxMessageBytes: number;
  readonly canSendSnapshot?: boolean;
};

/** RFC6455 text-only server endpoint. Client masking, control frames, fragmentation and
 *  aggregate message limits are enforced before the application sees any data. */
export function acceptNativeWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer, onText: (text: string, bytes: number) => void, onClose: () => void, maxMessageBytes = NATIVE_WS_MAX_MESSAGE): NativeSocket | null {
  if (!(socket instanceof Socket)) return null;
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1024 || maxMessageBytes > NATIVE_WS_MAX_MESSAGE) return null;
  const upgrade = req.headers.upgrade?.toLowerCase();
  const connection = String(req.headers.connection || '').toLowerCase().split(',').map(x => x.trim());
  const key = req.headers['sec-websocket-key'];
  // Decline optional extensions by omitting Sec-WebSocket-Extensions in the
  // response. In particular, do not negotiate permessage-deflate: parse()
  // rejects RSV bits, so compressed payloads cannot reach the application.
  if (upgrade !== 'websocket' || !connection.includes('upgrade') || req.headers['sec-websocket-version'] !== '13' || typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key) || req.headers['sec-websocket-protocol']) return null;
  let decoded: Buffer; try { decoded = Buffer.from(key, 'base64'); } catch { return null; }
  if (decoded.byteLength !== 16) return null;
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true); socket.setTimeout(45000);
  let open = true, buffer = Buffer.alloc(0), fragmented: Buffer[] | null = null, fragmentBytes = 0, fragmentCount = 0, controlWindowAt = Date.now(), controlCount = 0, lastPong = Date.now();
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  const end = () => { const notify = open; open = false; clearInterval(heartbeat); if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } socket.destroy(); if (notify) onClose(); };
  const rawWrite = (opcode: number, data: Uint8Array) => {
    if (socket.destroyed || !socket.writable) return false;
    try { socket.write(frame(opcode, data)); return true; } catch { return false; }
  };
  const validCloseCode = (code: number) => [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014].includes(code) || code >= 3000 && code <= 4999;
  const write = (opcode: number, data: Uint8Array) => {
    if (!open || data.byteLength > maxMessageBytes) return false;
    if (socket.writableLength > 4 * 1024 * 1024) { close(1013, 'backpressure'); return false; }
    // A false write result means Node accepted the frame into its bounded writable queue.
    return rawWrite(opcode, data);
  };
  const close = (code = 1000, reason = '') => {
    if (!open) return;
    const safeCode = validCloseCode(code) ? code : 1002;
    let text = Buffer.from(reason, 'utf8');
    if (text.length > 123) {
      text = text.subarray(0, 123);
      while (text.length) { try { new TextDecoder('utf-8', { fatal: true }).decode(text); break; } catch { text = text.subarray(0, text.length - 1); } }
    }
    const body = Buffer.allocUnsafe(2 + text.length); body.writeUInt16BE(safeCode, 0); text.copy(body, 2);
    open = false; clearInterval(heartbeat); rawWrite(8, body); socket.end();
    closeTimer = setTimeout(end, 1000); closeTimer.unref(); onClose();
  };
  const socketApi: NativeSocket = {
    send: (text: string) => write(1, Buffer.from(text, 'utf8')),
    close, terminate: end,
    get bufferedBytes() { return socket.writableLength; },
    get isOpen() { return open && !socket.destroyed; },
    get maxMessageBytes() { return maxMessageBytes; },
    setMessageLimit: bytes => { if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > NATIVE_WS_MAX_MESSAGE) throw new Error('Invalid WebSocket message limit'); maxMessageBytes = bytes; },
  };
  const heartbeat = setInterval(() => {
    if (Date.now() - lastPong > 30000) { close(1001, 'heartbeat timeout'); return; }
    const nonce = Buffer.allocUnsafe(8); nonce.writeBigUInt64BE(BigInt(Date.now()), 0); write(9, nonce);
  }, 10000);
  const deliver = (payload: Buffer) => {
    try { const text = new TextDecoder('utf-8', { fatal: true }).decode(payload); onText(text, payload.byteLength); }
    catch { close(1007, 'invalid utf-8'); }
  };
  const parse = () => {
    while (open && buffer.length >= 2) {
      const a = buffer[0], b = buffer[1], fin = !!(a & 0x80), opcode = a & 0x0f, masked = !!(b & 0x80), rsv = a & 0x70;
      if (rsv || !masked) { close(1002, 'invalid client frame'); return; }
      let length = b & 0x7f, offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; if (length < 126) { close(1002, 'noncanonical frame'); return; } }
      else if (length === 127) {
        if (buffer.length < 10) return; const wide = buffer.readBigUInt64BE(2); if (wide > BigInt(maxMessageBytes) || wide < 65536n) { close(1009, 'frame too large'); return; }
        length = Number(wide); offset = 10;
      }
      const control = opcode >= 8;
      if (![0, 1, 2, 8, 9, 10].includes(opcode) || control && (!fin || length > 125) || opcode === 0 && !fragmented) { close(1002, 'invalid opcode'); return; }
      if (control) {
        const now = Date.now();
        if (now - controlWindowAt >= 1000) { controlWindowAt = now; controlCount = 0; }
        if (++controlCount > 120) { close(1008, 'control frame rate'); return; }
      }
      if (length > maxMessageBytes || (fragmentBytes + length) > maxMessageBytes) { close(1009, 'message too large'); return; }
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4); offset += 4; const payload = Buffer.from(buffer.subarray(offset, offset + length)); buffer = buffer.subarray(offset + length);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      if (opcode === 8) {
        if (payload.length === 1) { close(1002, 'invalid close'); return; }
        if (payload.length >= 2) {
          const code = payload.readUInt16BE(0);
          if (!validCloseCode(code)) { close(1002, 'invalid close code'); return; }
          try { new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(2)); }
          catch { close(1007, 'invalid close reason'); return; }
        }
        close(payload.length >= 2 ? payload.readUInt16BE(0) : 1000, payload.length > 2 ? new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(2)) : ''); return;
      }
      if (opcode === 9) { write(10, payload); continue; }
      if (opcode === 10) { lastPong = Date.now(); continue; }
      if (opcode === 2) { close(1003, 'text only'); return; }
      if (opcode === 1) {
        if (fragmented) { close(1002, 'nested message'); return; }
        if (fin) deliver(payload); else { fragmented = [payload]; fragmentBytes = payload.length; fragmentCount = 1; }
      } else {
        if (++fragmentCount > 1024) { close(1009, 'too many fragments'); return; }
        fragmented!.push(payload); fragmentBytes += payload.length;
        if (fin) { const complete = Buffer.concat(fragmented!, fragmentBytes); fragmented = null; fragmentBytes = 0; fragmentCount = 0; deliver(complete); }
      }
    }
  };
  socket.on('data', chunk => {
    if (!open) return;
    if (buffer.length + chunk.length > maxMessageBytes + 14) { close(1009, 'message too large'); return; }
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk); parse();
  });
  socket.on('timeout', () => close(1001, 'timeout'));
  // HTTP-upgraded sockets may remain half-open after a proxy sends TCP FIN.
  // Retire the connection immediately instead of retaining a stale host/seat
  // until the heartbeat timeout and rejecting its signed replacement tunnel.
  socket.on('end', end); socket.on('error', end); socket.on('close', end);
  if (head.length) { buffer = Buffer.from(head); parse(); }
  return socketApi;
}
