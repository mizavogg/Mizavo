/* Mizavo — tap selectors for Rounds and Seconds (Nov 15, 2026: replaces the two dropdowns).
   The original <select> stays in the page, hidden, and is still what the game reads and saves,
   so nothing else changes. This file draws a row of buttons from the select's options and keeps the two in step.
   Tapping slides a raised pill to the new number (the tap sound plays for every button; Android also buzzes). */
import { buzz } from '../lib/sound';

const segs: Array<() => void> = [];

function build(select: HTMLSelectElement, unit: string): void {
  const opts = [...select.options];
  const box = document.createElement('div');
  box.className = 'seg';
  box.setAttribute('role', 'radiogroup');
  box.setAttribute('aria-labelledby', select.id + 'Lbl');
  box.style.setProperty('--n', String(opts.length));
  const thumb = document.createElement('span');
  thumb.className = 'thumb';
  thumb.setAttribute('aria-hidden', 'true');
  box.appendChild(thumb);
  const btns = opts.map((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.textContent = o.value;
    b.setAttribute('aria-label', o.value + ' ' + unit);
    b.onclick = () => choose(o.value, true);
    box.appendChild(b);
    return b;
  });
  /** Show the select's current value on the buttons. */
  const sync = (): void => {
    const i = Math.max(0, opts.findIndex((o) => o.value === select.value));
    thumb.style.transform = `translateX(${i * 100}%)`;
    btns.forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-checked', String(j === i)); b.tabIndex = j === i ? 0 : -1; });
  };
  const choose = (v: string, tapped: boolean): void => {
    if (select.value === v) return;
    select.value = v;
    select.dispatchEvent(new Event('change', { bubbles: true }));   // the topic note etc. still listen for this
    sync();
    if (tapped) buzz();
  };
  // arrow keys move between numbers, like a normal radio group
  box.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = Math.min(opts.length - 1, Math.max(0, opts.findIndex((o) => o.value === select.value) + d));
    choose(opts[i].value, false);
    btns[i].focus();
  });
  select.addEventListener('change', sync);
  select.closest('label')!.after(box);
  segs.push(sync);
  sync();
}

/** Call after the saved settings are loaded into the selects. */
export function syncSegs(): void { segs.forEach((s) => s()); }

export function initSegs(): void {
  build(document.querySelector<HTMLSelectElement>('#rounds')!, 'rounds');
  build(document.querySelector<HTMLSelectElement>('#secs')!, 'seconds per round');
}
