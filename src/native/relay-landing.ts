import { createHash } from 'node:crypto';

/** Fixed same-origin landing page. User input never enters HTML or a provider URL. */
export const relayLanding = String.raw`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Завод7 · Совместная игра</title>
<style>
a.button{display:block;padding:12px;border:1px solid #edc67b;border-radius:6px;color:#edc67b;text-align:center;text-decoration:none}a.button:focus-visible{outline:3px solid #83cff6;outline-offset:3px}
:root{color-scheme:dark;font:17px/1.5 system-ui,sans-serif;background:#151a1e;color:#e5e9eb}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:min(100%,30rem);padding:32px;border:1px solid #485157;background:#222a30;border-radius:12px}h1{margin:0 0 8px;font-size:1.8rem;color:#f0ca7c}p{color:#b8c4cb}label{display:block;margin:24px 0 8px}input,button{width:100%;font:inherit;padding:12px;border-radius:6px}input{background:#11171c;color:#fff;border:1px solid #798990;font-family:ui-monospace,monospace}button{margin-top:16px;background:#ecc16e;color:#20262a;border:0;font-weight:700;cursor:pointer}button:disabled{opacity:.65;cursor:wait}input:focus-visible,button:focus-visible{outline:3px solid #83cff6;outline-offset:3px}#status{min-height:3em;color:#f2c57e}small{display:block;color:#a5b3bc}
</style></head><body><main><h1>Завод7</h1><p id="intro">Подключитесь к миру друга по коду приглашения.</p><form id="join"><label id="label" for="code">Код комнаты</label><input id="code" name="code" maxlength="512" autocomplete="off" autocapitalize="characters" spellcheck="false" required autofocus aria-describedby="status"><button id="go" type="submit">Войти в игру</button></form><p id="status" role="status" aria-live="polite"></p><small id="hint">Мир работает на компьютере владельца. Попросите у него действующий код.</small><!--NATIVE-INSTALLER--></main>
<script>
(() => {
 const ru = (navigator.language || '').toLowerCase().startsWith('ru');
 const input = document.getElementById('code'), button = document.getElementById('go'), status = document.getElementById('status');
 const text = ru ? { go:'Войти в игру', wait:'Проверяем приглашение…', bad:'Введите действующий код комнаты из 10 символов.', gone:'Комната недоступна. Попросите владельца проверить сервер и приглашение.', rate:'Слишком много попыток. Подождите минуту.', fail:'Не удалось связаться со службой. Проверьте соединение и повторите.' } : { go:'Join game', wait:'Checking invitation…', bad:'Enter a valid 10-character room code.', gone:'Room is unavailable. Ask the owner to check the server and invitation.', rate:'Too many attempts. Wait a minute.', fail:'Could not reach the service. Check your connection and try again.' };
 if (!ru) { document.documentElement.lang='en'; document.title='Zavod7 · Multiplayer'; document.getElementById('intro').textContent='Join your friend’s world with an invitation code.'; document.getElementById('label').textContent='Room code'; button.textContent=text.go; document.getElementById('hint').textContent='The world runs on its owner’s computer. Ask them for a current code.'; }
 const installer=document.getElementById('installer'); if (installer && !ru) installer.textContent='Download Windows server';
 document.getElementById('join').addEventListener('submit', async event => {
  event.preventDefault(); if (button.disabled) return;
  let code=input.value.trim(), suppliedToken='';
  if (/^https?:\/\//i.test(code)) { try { const u=new URL(code); const m=/^\/r\/([A-HJ-NP-Z2-9]{10})\/$/i.exec(u.pathname); if (u.origin!==location.origin || u.search || u.hash && !/^#server-invite=[A-Za-z0-9_-]{32,128}$/.test(u.hash) || u.username || u.password || !m) throw new Error(); suppliedToken=u.hash?u.hash.slice('#server-invite='.length):''; code=m[1]; } catch { status.textContent=text.bad; return; } }
  code=code.replace(/[\s-]/g,'').toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{10}$/.test(code)) { status.textContent=text.bad; return; }
  button.disabled=true; status.textContent=text.wait;
  const abort=new AbortController(), timer=setTimeout(() => abort.abort(),8000);
  try {
   const response=await fetch('/v1/rooms/'+code,{cache:'no-store',credentials:'omit',redirect:'error',signal:abort.signal});
   if (!response.ok) { status.textContent=response.status===429?text.rate:text.gone; return; }
   const invitation=await response.json();
   if (!invitation || typeof invitation.inviteToken!=='string' || !/^[A-Za-z0-9_-]{32,128}$/.test(invitation.inviteToken) || suppliedToken && suppliedToken!==invitation.inviteToken || !Number.isFinite(invitation.expiresAt) || invitation.expiresAt<=Date.now()) { status.textContent=text.gone; return; }
   // The destination is constructed locally; a response cannot redirect to another origin.
   location.assign('/r/'+code+'/#server-invite='+encodeURIComponent(invitation.inviteToken));
  } catch { status.textContent=text.fail; }
  finally { clearTimeout(timer); button.disabled=false; }
 });
})();
</script></body></html>`;
const sourceHash = (source: string) => `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
const script = relayLanding.match(/<script>([\s\S]*?)<\/script>/)![1];
const style = relayLanding.match(/<style>([\s\S]*?)<\/style>/)![1];
export const relayLandingCsp = `default-src 'none'; script-src ${sourceHash(script)}; style-src ${sourceHash(style)}; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
