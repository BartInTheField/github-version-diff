import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

export function doc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}
