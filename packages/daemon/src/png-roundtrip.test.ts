import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

describe('pngjs', () => {
  it('decodes and re-encodes a PNG without throwing', () => {
    const png = new PNG({ width: 2, height: 2 });

    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const idx = (y * png.width + x) * 4;
        png.data[idx] = x * 10;
        png.data[idx + 1] = y * 10;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 255;
      }
    }

    const encoded = PNG.sync.write(png);
    const decoded = PNG.sync.read(encoded);
    const reencoded = PNG.sync.write(decoded);

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(reencoded.byteLength).toBeGreaterThan(0);
  });
});
