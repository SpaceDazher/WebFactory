// v1.11: перерисовка окон без пересоздания DOM. Раньше окно целиком заменялось через innerHTML (раз в несколько кадров,
// когда менялись числа) — элемент под курсором пересоздавался, и обводка :hover ячейки и подсказка мигали, холст карты
// очищался, а прокрутка сбрасывалась. Теперь новое дерево сравнивается со старым по позициям: совпадающие элементы
// (тот же тег, id и data-key) остаются на месте — меняются только атрибуты и текст.
const tpl = typeof document !== 'undefined' ? document.createElement('template') : null;
function sameNode(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  const ea = a as Element, eb = b as Element;
  return ea.tagName === eb.tagName && ea.id === eb.id && ea.getAttribute('data-key') === eb.getAttribute('data-key');
}
function patchAttrs(a: Element, b: Element) {
  const ba = b.attributes;
  for (let i = a.attributes.length - 1; i >= 0; i--) { const n = a.attributes[i].name; if (!b.hasAttribute(n)) a.removeAttribute(n); }
  for (let i = 0; i < ba.length; i++) { const { name, value } = ba[i]; if (a.getAttribute(name) !== value) a.setAttribute(name, value); }
  if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') {
    const ia = a as HTMLInputElement, ib = b as HTMLInputElement;
    if (document.activeElement !== a) { if (a.tagName !== 'SELECT' && ia.value !== ib.value) ia.value = ib.value; if (ia.type === 'checkbox' || ia.type === 'radio') ia.checked = ib.checked; }
  }
}
function patchChildren(a: Node, b: Node) {
  let ca = a.firstChild, cb = b.firstChild;
  while (cb) {
    const nb = cb.nextSibling;
    if (!ca) { a.appendChild(cb); cb = nb; continue; }
    const na = ca.nextSibling;
    if (sameNode(ca, cb)) {
      if (ca.nodeType === 1) {
        patchAttrs(ca as Element, cb as Element);
        // холст сохраняет нарисованное; select — выбранное значение (его задаёт атрибут selected у option)
        if ((ca as Element).tagName !== 'CANVAS') patchChildren(ca, cb);
        if ((ca as Element).tagName === 'SELECT' && document.activeElement !== ca) { const v = (cb as HTMLSelectElement).value; if ((ca as HTMLSelectElement).value !== v) (ca as HTMLSelectElement).value = v; }
      } else if (ca.nodeValue !== cb.nodeValue) ca.nodeValue = cb.nodeValue;
      ca = na; cb = nb; continue;
    }
    a.replaceChild(cb, ca); ca = na; cb = nb;
  }
  while (ca) { const na = ca.nextSibling; a.removeChild(ca); ca = na; }
}
/** заменить содержимое el на html, сохранив совпадающие элементы */
export function morph(el: HTMLElement, html: string) {
  if (!tpl || !el.firstChild) { el.innerHTML = html; return; }
  tpl.innerHTML = html; patchChildren(el, tpl.content);
}
