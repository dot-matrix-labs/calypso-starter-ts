import { describe, expect, it } from 'vitest';
import { createProxy } from './vite.config';

describe('vite proxy configuration', () => {
  it('proxies api routes to the Bun server', () => {
    const proxy = createProxy();
    expect(proxy['/api']).toBeDefined();
  });

  it('uses PORT when set', () => {
    const proxy = createProxy({
      ...process.env,
      PORT: '32100',
    });
    expect(proxy['/api']).toEqual(
      expect.objectContaining({
        target: 'http://localhost:32100',
      }),
    );
  });
});
