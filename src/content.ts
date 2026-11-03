import { detectPage } from './page';
import { extensionAlive } from './runtime';
import { mountPicker, type Picker } from './ui/picker';

/**
 * Entry point, on github.com and linear.app. Both are SPAs, so instead of mounting once we
 * keep checking whether the picker should exist and whether it is still attached.
 */

let picker: Picker | undefined;

function sync(): void {
  if (!extensionAlive()) {
    shutdown();
    return;
  }
  const page = detectPage(new URL(location.href), document);
  if (!page) {
    picker?.destroy();
    picker = undefined;
    return;
  }
  if (picker && picker.key === page.key && picker.host.isConnected) return;
  picker?.destroy();
  picker = mountPicker(page.pr, page.key, page.site, page.site === 'github' ? 'toolbar' : 'corner-left');
}

let scheduled = false;
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    sync();
  }, 250);
}

const NAV_EVENTS = ['turbo:load', 'turbo:render', 'pjax:end', 'popstate'];
// React-rendered pages swap DOM without Turbo events; GitHub also re-renders the toolbar.
const observer = new MutationObserver(schedule);

/** This copy of the script was orphaned by an extension reload or update: remove everything. */
function shutdown(): void {
  observer.disconnect();
  for (const ev of NAV_EVENTS) {
    document.removeEventListener(ev, schedule);
    window.removeEventListener(ev, schedule);
  }
  picker?.destroy();
  picker = undefined;
}

for (const ev of NAV_EVENTS) {
  document.addEventListener(ev, schedule);
  window.addEventListener(ev, schedule);
}
observer.observe(document.body, { childList: true, subtree: true });
sync();
