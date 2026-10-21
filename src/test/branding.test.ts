import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

const asset = '/branding/admin_transparent.png';
it('uses the exact approved transparent role asset', () => {
  const bytes = readFileSync(new URL('../../public' + asset, import.meta.url));
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(bytes.readUInt32BE(16)).toBe(1254);
  expect(bytes.readUInt32BE(20)).toBe(1254);
  expect(bytes[25]).toBe(6); // RGBA PNG; alpha pixels checked in source validation.
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    '1463d46c1d8a5d20c7aadc4875d376ce8aa8387ac8fa56245ecbe6e0855863cc',
  );
});
it.each(['App.tsx', 'Login.tsx', 'Shell.tsx'])(
  '%s uses approved branding without obsolete logo URLs',
  (file) => {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    expect(source).toContain(asset);
    expect(source).not.toContain('/images/logo.png');
  },
);
it('loads the approved favicon from an existing public asset', () => {
  const html = readFileSync(process.cwd() + '/index.html', 'utf8');
  expect(html).toContain('rel="icon"');
  expect(html).toContain(asset);
});
