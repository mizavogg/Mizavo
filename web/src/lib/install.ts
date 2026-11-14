/* Mizavo — "Get the app" (Nov 14, 2026).
   Phones only, and never inside the home-screen app itself.
   Android (Chrome, Samsung Internet, Edge): the browser offers a one-tap install; we keep its offer and show
   "Get the app" in the nav bar. Tapping it opens the browser's own install box.
   iPhone/iPad, or an Android browser without one-tap install: "Get the app" opens a short sheet with the steps. */
let deferred: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;

export const isStandalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);

/** Should the nav bar show "Get the app"? */
export function canOfferApp(): boolean {
  if (isStandalone()) return false;
  return isIOS() || isAndroid();
}

export function initInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();   // keep the browser's offer for our own button instead of its banner
    deferred = e as typeof deferred;
    window.dispatchEvent(new Event('mz-install'));
  });
  window.addEventListener('appinstalled', () => { deferred = null; window.dispatchEvent(new Event('mz-install')); });
}

export async function openInstall(): Promise<void> {
  if (deferred) {
    const d = deferred; deferred = null;
    await d.prompt().catch(() => {});
    await d.userChoice.catch(() => null);
    window.dispatchEvent(new Event('mz-install'));
    return;
  }
  showSheet();
}

const SHARE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
const PLUS_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

function showSheet(): void {
  let dlg = document.getElementById('appSheet') as HTMLDialogElement | null;
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'appSheet'; dlg.className = 'appSheet';
    const steps = isIOS()
      ? [`Tap the <b>Share</b> button ${SHARE_ICON} <small>(Safari: bottom bar · Chrome: top right)</small>`,
         `Scroll down and tap <b>Add to Home Screen</b> ${PLUS_ICON}`,
         'Tap <b>Add</b>. Mizavo opens full screen from your Home Screen.']
      : ['Open your browser menu <b>⋮</b> <small>(top right, or ≡ at the bottom in Samsung Internet)</small>',
         'Tap <b>Install app</b> or <b>Add to Home screen</b>',
         'Tap <b>Install</b>. Mizavo opens full screen from your Home Screen.'];
    dlg.innerHTML = '<h3>Get the Mizavo app</h3><p class="sub">Free, no app store. It\'s the same game, full screen, one tap away.</p>'
      + '<ol>' + steps.map((s) => `<li>${s}</li>`).join('') + '</ol>'
      + '<button class="btn primary" type="button" value="close">Got it</button>';
    dlg.querySelector('button')!.addEventListener('click', () => dlg!.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg!.close(); });   // tap outside to close
    document.body.append(dlg);
  }
  dlg.showModal();
}
