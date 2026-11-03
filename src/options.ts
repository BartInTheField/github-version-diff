import { getOptions, setOptions } from './storage';

const input = document.getElementById('pat') as HTMLInputElement;
const status = document.getElementById('status') as HTMLElement;
const form = document.getElementById('form') as HTMLFormElement;
const clear = document.getElementById('clear') as HTMLButtonElement;

function show(msg: string, ok = true): void {
  status.textContent = msg;
  status.className = ok ? 'ok' : 'err';
}

async function verify(token: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub rejected the token (${res.status})`);
  return (await res.json()).login;
}

getOptions().then((o) => {
  input.value = o.pat ?? '';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pat = input.value.trim();
  if (!pat) {
    await setOptions({});
    show('Token removed. Version lists come from github.com pages.');
    return;
  }
  show('Checking token…');
  try {
    const login = await verify(pat);
    await setOptions({ pat });
    show(`Saved. Token works for @${login}. Reload the PR page to use it.`);
  } catch (err) {
    show((err as Error).message, false);
  }
});

clear.addEventListener('click', async () => {
  input.value = '';
  await setOptions({});
  show('Token removed.');
});
