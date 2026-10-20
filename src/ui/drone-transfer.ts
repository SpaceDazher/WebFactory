import type { Game } from '../sim/game';
import { tr } from '../core/i18n';

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
/** No client-provided drone state: the command carries only UID and recipient. */
export function droneTransferControls(g: Game, id: number): string {
  const options: string[] = [];
  for (let i = 0; i < g.nPlayers; i++) {
    const peer = g.peer(i);
    if (i !== g.pl && !g.peers[i]?.off && !peer.player.dead) options.push(`<option value="${i}">${esc(peer.name)}</option>`);
  }
  return options.length ? `<label class="small">${tr('Получатель')} <select id="drone-transfer-${id}" aria-label="${tr('Получатель')}">${options.join('')}</select></label><button data-act="drone-transfer" data-id="${id}">${tr('Передать')}</button>` : '';
}
