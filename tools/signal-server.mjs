#!/usr/bin/env node
// ЗАВОД-7 v1.12: сервер сигналинга для совместной игры. Без зависимостей (Node 18+): HTTP + WebSocket вручную.
// Хост получает код комнаты ZVD-XXXX, друзья входят по коду; сервер пересылает предложения/ответы WebRTC
// и — если прямое соединение не удалось — сами данные игры (ретрансляция). Игра на сервере не считается.
// Запуск: node tools/signal-server.mjs [--port 8787]   (или PORT=8787)
import http from 'node:http';
import crypto from 'node:crypto';

const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
const PORT = +(arg('port') || process.env.PORT || 8787);
const QUIET = process.argv.includes('--quiet');
const log = (...a) => { if (!QUIET) console.log(new Date().toISOString().slice(11, 19), ...a); };
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без 0/O и 1/I
const rooms = new Map(); // code → { host: sock, peers: Map<id, sock>, next }
let socks = 0;

// ---------- WebSocket (RFC 6455): только текстовые кадры, ping/pong, close ----------
function frame(op, payload) {
  const n = payload.length; let head;
  if (n < 126) head = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, payload]);
}
function wsSock(s) {
  const o = { s, id: ++socks, room: null, pid: null, buf: Buffer.alloc(0), parts: [], alive: true, onText: () => {}, onClose: () => {} };
  o.send = m => { if (!s.destroyed) s.write(frame(1, Buffer.from(typeof m === 'string' ? m : JSON.stringify(m)))); };
  o.close = () => { if (!s.destroyed) { s.write(frame(8, Buffer.alloc(0))); s.end(); } };
  s.on('data', d => {
    o.buf = Buffer.concat([o.buf, d]);
    for (;;) {
      const b = o.buf; if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80; let n = b[1] & 0x7f, off = 2;
      if (n === 126) { if (b.length < 4) return; n = b.readUInt16BE(2); off = 4; } else if (n === 127) { if (b.length < 10) return; n = Number(b.readBigUInt64BE(2)); off = 10; }
      if (n > 64 * 1024 * 1024) { s.destroy(); return; }
      const mk = masked ? b.subarray(off, off + 4) : null; if (masked) off += 4; if (b.length < off + n) return;
      const p = Buffer.from(b.subarray(off, off + n)); if (mk) for (let i = 0; i < p.length; i++) p[i] ^= mk[i & 3];
      o.buf = b.subarray(off + n);
      if (op === 8) { o.close(); return; }
      if (op === 9) { s.write(frame(10, p)); continue; }
      if (op === 10) { o.alive = true; continue; }
      if (op === 1 || op === 0) { o.parts.push(p); if (fin) { const t = Buffer.concat(o.parts).toString('utf8'); o.parts = []; o.onText(t); } }
    }
  });
  s.on('close', () => o.onClose()); s.on('error', () => s.destroy());
  return o;
}
// ---------- комнаты ----------
function newCode() { for (;;) { let c = 'ZVD-'; for (let i = 0; i < 4; i++) c += ABC[crypto.randomInt(ABC.length)]; if (!rooms.has(c)) return c; } }
function onMsg(o, m) {
  switch (m.k) {
    case 'host': { const code = newCode(); rooms.set(code, { host: o, peers: new Map(), next: 1 }); o.room = code; o.pid = 'host'; o.send({ k: 'room', code }); log('комната', code); break; }
    case 'join': {
      const code = String(m.code || '').toUpperCase().trim().replace(/^ZVD-?/, 'ZVD-'); const r = rooms.get(code);
      if (!r) { o.send({ k: 'error', why: 'Нет игры с кодом ' + code }); break; }
      const id = r.next++; r.peers.set(id, o); o.room = code; o.pid = id; o.send({ k: 'joined', code, id }); r.host.send({ k: 'peer', id }); log(code, 'вход', id); break;
    }
    case 'sig': case 'relay': { // хост → игрок id; игрок → хост
      const r = rooms.get(o.room); if (!r) break;
      const to = o.pid === 'host' ? r.peers.get(+m.to) : r.host; if (!to) break;
      to.send(m.k === 'sig' ? { k: 'sig', from: o.pid, data: m.data } : { k: 'relay', from: o.pid, d: m.d }); break;
    }
    case 'ping': o.send({ k: 'pong', t: m.t }); break;
  }
}
function onClose(o) {
  const r = rooms.get(o.room); if (!r) return;
  if (o.pid === 'host') { for (const p of r.peers.values()) p.send({ k: 'gone' }); rooms.delete(o.room); log('комната закрыта', o.room); }
  else { r.peers.delete(o.pid); r.host.send({ k: 'left', id: o.pid }); }
}
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' }); res.end(`ЗАВОД-7: сервер сигналинга. Комнат: ${rooms.size}\n`); });
server.on('upgrade', (req, s) => {
  const key = req.headers['sec-websocket-key']; if (!key) { s.destroy(); return; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  s.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  s.setNoDelay(true);
  const o = wsSock(s); o.onText = t => { let m; try { m = JSON.parse(t); } catch { return; } onMsg(o, m); }; o.onClose = () => onClose(o);
});
// раз в 30 с — ping, молчащие соединения закрываются
setInterval(() => { for (const r of rooms.values()) for (const o of [r.host, ...r.peers.values()]) { if (!o.alive) { o.s.destroy(); continue; } o.alive = false; if (!o.s.destroyed) o.s.write(frame(9, Buffer.alloc(0))); } }, 30000).unref();
server.listen(PORT, () => log(`сервер сигналинга ЗАВОД-7: ws://localhost:${PORT}`));
