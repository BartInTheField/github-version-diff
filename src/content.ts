import { detectPage } from './page';
import { mountPicker, type Picker } from './ui/picker';

/**
 * Entry point, on github.com and linear.app. Both are SPAs, so instead of mounting once we
 * keep checking whether the picker should exist and whether it is still attached.
 */

let picker: Picker | undefined;

function sync(): void {
  const page = detectPage(new URL(location.href), document);
  if (!page) {
    picker?.destroy();
    picker = undefined;
    return;
  }
  if (picker && picker.key === page.key && picker.host.isConnected) return;
  picker?.destroy();
  picker = mountPicker(page.pr, page.key, page.site === 'github' ? 'toolbar' : 'corner-left');
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

for (const ev of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate']) {
  document.addEventListener(ev, schedule);
  window.addEventListener(ev, schedule);
}
// React-rendered pages swap DOM without Turbo events; GitHub also re-renders the toolbar.
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
sync();
