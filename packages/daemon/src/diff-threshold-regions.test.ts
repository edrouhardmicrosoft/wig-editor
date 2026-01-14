import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

function makeSolidPng(r: number, g: number, b: number): PNG {
  const png = new PNG({ width: 4, height: 4 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (y * png.width + x) * 4;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return png;
}

describe('pixelmatch threshold + regions sanity', () => {
  it('higher threshold can reduce mismatches for small changes', () => {
    const baseline = makeSolidPng(0, 0, 0);
    const current = makeSolidPng(5, 5, 5);

    const diffA = new PNG({ width: baseline.width, height: baseline.height });
    const mismatchLow = pixelmatch(
      baseline.data,
      current.data,
      diffA.data,
      baseline.width,
      baseline.height,
      { threshold: 0.1 }
    );

    const diffB = new PNG({ width: baseline.width, height: baseline.height });
    const mismatchHigh = pixelmatch(
      baseline.data,
      current.data,
      diffB.data,
      baseline.width,
      baseline.height,
      { threshold: 0.9 }
    );

    expect(mismatchHigh).toBeLessThanOrEqual(mismatchLow);
  });

  it('changed pixels produce a non-empty bounding box when scanning alpha>0', () => {
    const baseline = makeSolidPng(0, 0, 0);
    const current = makeSolidPng(0, 0, 0);

    const idx = (2 * baseline.width + 1) * 4;
    current.data[idx] = 255;
    current.data[idx + 3] = 255;

    const diff = new PNG({ width: baseline.width, height: baseline.height });
    const mismatched = pixelmatch(
      baseline.data,
      current.data,
      diff.data,
      baseline.width,
      baseline.height,
      { threshold: 0.1 }
    );

    expect(mismatched).toBeGreaterThan(0);

    let minX = diff.width;
    let minY = diff.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < diff.height; y++) {
      for (let x = 0; x < diff.width; x++) {
        const p = (y * diff.width + x) * 4;
        const a = diff.data[p + 3];
        if ((a ?? 0) > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    expect(maxX).toBeGreaterThanOrEqual(minX);
    expect(maxY).toBeGreaterThanOrEqual(minY);
  });
});
