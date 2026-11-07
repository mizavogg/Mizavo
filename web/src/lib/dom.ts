/* Mizavo — small page helpers shared by every page. */

/** Find one element; throws if it's missing so a typo shows up right away. */
export function $<T extends HTMLElement = HTMLElement>(sel: string): T {
  const n = document.querySelector<T>(sel);
  if (!n) throw new Error('Missing element: ' + sel);
  return n;
}

/** Make an element. Text is always set as plain text, never as HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, text?: string | null): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export const show = (node: HTMLElement, on: boolean) => node.classList.toggle('hidden', !on);

/** localStorage that never throws (some browsers block it). */
export const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  remove(k: string): void { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const pad2 = (n: number) => String(n).padStart(2, '0');
export function shuffle<T>(a: readonly T[]): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
