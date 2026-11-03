import { describe, expect, it } from 'vitest';
import { findMountTarget } from '../src/ui/mount-targets';
import { doc, fixture } from './helpers';

describe('findMountTarget', () => {
  it('finds the classic Files tab toolbar (recorded page)', () => {
    expect(findMountTarget(doc(fixture('pr14768-files-classic.html')))?.target.name).toBe('classic-diffbar');
  });

  it('returns nothing on an unknown layout (the picker then floats)', () => {
    expect(findMountTarget(doc('<main><div class="something-else"></div></main>'))).toBeUndefined();
  });
});
