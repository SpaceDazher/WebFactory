import { connect as connectTls, type TLSSocket } from 'node:tls';
import { createHash, randomBytes } from 'node:crypto';
import type { NativeSocket } from './websocket';
import { NATIVE_WS_MAX_MESSAGE } from './websocket';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const validCloseCode = (code: number) => [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014].includes(code) || code >= 3000 && code <= 4999;
const frame = (opcode: number, payload: Uint8Array) => {
  const n = payload.byteLength, mask = randomBytes(4);
  let head: Buffer;
  if (n < 126) { head = Buffer.from([0x80 | opcode, 0x80 | n]); }
  else if (n <= 0xffff) { head = Buffer.allocUnsafe(4); head[0] = 0x80 | opcode; head[1] = 0x80 | 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.allocUnsafe(10); head[0] = 0x80 | opcode; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(n), 2); }
  const body = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) body[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, body]);
};

/** A strict WSS client handshake: exact configured endpoint, default TLS verification, no redirects/extensions. */
export function connectNativeWebSocket(url: URL, onText: (text: string, bytes: number) => void, onClose: () => void, maxMessageBytes = NATIVE_WS_MAX_MESSAGE): Promise<NativeSocket> {
  if (url.protocol !== 'wss:' || url.username || url.password || url.hash || !Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1024 || maxMessageBytes > NATIVE_WS_MAX_MESSAGE) return Promise.reject(new Error('Invalid secure WebSocket endpoint'));
  return new Promise((resolve, reject) => {
    const port = Number(url.port || 443), host = url.hostname;
    const socket: TLSSocket = connectTls({ host, port, servername: /^[0-9.]+$/.test(host) || host.includes(':') ? undefined : host, rejectUnauthorized: true });
    const key = randomBytes(16).toString('base64');
    const expectedAccept = createHash('sha1').update(key + GUID).digest('base64');
    let open = false, settled = false, closeNotified = false, buffer = Buffer.alloc(0), fragmented: Buffer[] | null = null, fragmentBytes = 0, fragmentCount = 0, lastPong = Date.now();
    let heartbeat: ReturnType<typeof setInterval> | null = null, closeTimer: ReturnType<typeof setTimeout> | null = null;
    const notifyClose = () => { if (closeNotified) return; closeNotified = true; if (heartbeat) clearInterval(heartbeat); onClose(); };
    const rawWrite = (opcode: number, payload: Uint8Array) => {
      if (socket.destroyed || !socket.writable || payload.byteLength > maxMessageBytes) return false;
      try { socket.write(frame(opcode, payload)); return true; } catch { return false; }
    };
    const terminate = () => { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } if (!open && socket.destroyed) return; open = false; if (heartbeat) clearInterval(heartbeat); socket.destroy(); notifyClose(); };
    const close = (code = 1000, reason = '') => {
      if (!open) { terminate(); return; }
      const safeCode = validCloseCode(code) ? code : 1002;
      let text = Buffer.from(reason, 'utf8');
      if (text.length > 123) {
        text = text.subarray(0, 123);
        while (text.length) { try { new TextDecoder('utf-8', { fatal: true }).decode(text); break; } catch { text = text.subarray(0, text.length - 1); } }
      }
      const body = Buffer.allocUnsafe(text.length + 2); body.writeUInt16BE(safeCode, 0); text.copy(body, 2);
      open = false; if (heartbeat) clearInterval(heartbeat); rawWrite(8, body); socket.end();
      closeTimer = setTimeout(terminate, 1000); closeTimer.unref(); notifyClose();
    };
    const api: NativeSocket = {
      send(text: string) { const bytes = Buffer.from(text, 'utf8'); if (!open || bytes.byteLength > maxMessageBytes || socket.writableLength > 4 * 1024 * 1024) return false; return rawWrite(1, bytes); },
      close, terminate,
      get bufferedBytes() { return socket.writableLength; },
      get isOpen() { return open && !socket.destroyed; },
      maxMessageBytes,
    };
    const fail = (error: Error) => {
      if (!settled) { settled = true; reject(error); }
      open = false; if (heartbeat) clearInterval(heartbeat); socket.destroy(); notifyClose();
    };
    const deliver = (payload: Buffer) => {
      try { onText(new TextDecoder('utf-8', { fatal: true }).decode(payload), payload.byteLength); }
      catch { close(1007, 'invalid utf-8'); }
    };
    const parseFrames = () => {
      while (open && buffer.length >= 2) {
        const a = buffer[0], b = buffer[1], fin = !!(a & 0x80), opcode = a & 0x0f, masked = !!(b & 0x80), rsv = a & 0x70;
        if (rsv || masked) { close(1002, 'invalid server frame'); return; }
        let length = b & 0x7f, offset = 2;
        if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; if (length < 126) { close(1002, 'noncanonical frame'); return; } }
        else if (length === 127) { if (buffer.length < 10) return; const wide = buffer.readBigUInt64BE(2); if (wide > BigInt(maxMessageBytes) || wide < 65536n) { close(1009, 'frame too large'); return; } length = Number(wide); offset = 10; }
        const control = opcode >= 8;
        if (![0, 1, 2, 8, 9, 10].includes(opcode) || control && (!fin || length > 125) || opcode === 0 && !fragmented) { close(1002, 'invalid opcode'); return; }
        if (!control && (length > maxMessageBytes || fragmentBytes + length > maxMessageBytes)) { close(1009, 'message too large'); return; }
        if (buffer.length < offset + length) return;
        const payload = buffer.subarray(offset, offset + length); buffer = buffer.subarray(offset + length);
        if (control) {
          if (opcode === 8) {
            if (payload.length === 1) { close(1002, 'invalid close'); return; }
            if (payload.length >= 2) { const code = payload.readUInt16BE(0); if (!validCloseCode(code)) { close(1002, 'invalid close code'); return; }
              try { new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(2)); } catch { close(1007, 'invalid close reason'); return; }
              if (open) { open = false; rawWrite(8, payload); socket.end(); notifyClose(); } return; }
            if (open) { open = false; rawWrite(8, Buffer.alloc(0)); socket.end(); notifyClose(); } return;
          }
          if (opcode === 9) { rawWrite(10, payload); continue; }
          if (opcode === 10) { lastPong = Date.now(); continue; }
          close(1002, 'invalid control'); return;
        }
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
    let handshake = Buffer.alloc(0), upgraded = false;
    socket.setTimeout(45_000);
    socket.once('secureConnect', () => {
      const path = `${url.pathname}${url.search}`;
      const authority = url.port ? `${url.hostname}:${url.port}` : url.hostname;
      socket.write(`GET ${path} HTTP/1.1\r\nHost: ${authority}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    socket.on('data', chunk => {
      if (!upgraded) {
        handshake = handshake.length ? Buffer.concat([handshake, chunk]) : Buffer.from(chunk);
        if (handshake.length > 16 * 1024) { fail(new Error('WebSocket handshake headers exceed limit')); return; }
        const end = handshake.indexOf('\r\n\r\n'); if (end < 0) return;
        const header = handshake.subarray(0, end).toString('latin1'), rows = header.split('\r\n');
        const headers = new Map<string, string[]>();
        for (const line of rows.slice(1)) { const i = line.indexOf(':'); if (i <= 0) { fail(new Error('Malformed WebSocket handshake')); return; }
          const name = line.slice(0, i).trim().toLowerCase(), value = line.slice(i + 1).trim();
          headers.set(name, [...(headers.get(name) || []), value]); }
        const values = (name: string) => headers.get(name) || [];
        const status = /^HTTP\/1\.1 101(?:\s|$)/.test(rows[0]);
        const connection = values('connection').join(',').toLowerCase().split(',').map(s => s.trim());
        if (!status || values('upgrade').length !== 1 || values('upgrade')[0].toLowerCase() !== 'websocket' || !connection.includes('upgrade') ||
          values('sec-websocket-accept').length !== 1 || values('sec-websocket-accept')[0] !== expectedAccept ||
          headers.has('sec-websocket-extensions') || headers.has('sec-websocket-protocol')) { fail(new Error('WebSocket endpoint did not accept the exact secure handshake')); return; }
        upgraded = true; open = true; settled = true; resolve(api);
        const rest = handshake.subarray(end + 4); handshake = Buffer.alloc(0);
        if (rest.length) { buffer = Buffer.from(rest); parseFrames(); }
        heartbeat = setInterval(() => { if (Date.now() - lastPong > 45_000) { close(1001, 'heartbeat timeout'); return; } const ping = Buffer.allocUnsafe(8); ping.writeBigUInt64BE(BigInt(Date.now()), 0); rawWrite(9, ping); }, 15_000);
        return;
      }
      if (buffer.length + chunk.length > maxMessageBytes + 14) { close(1009, 'message too large'); return; }
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk); parseFrames();
    });
    socket.once('timeout', () => fail(new Error('WebSocket TLS connection timed out')));
    socket.once('error', error => fail(error));
    socket.once('close', () => { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } open = false; if (!settled) fail(new Error('WebSocket connection closed during handshake')); else notifyClose(); });
  });
}
