/**
 * The regional clip keeps the northwest cell and drops the rest of the grid.
 */
import { clipFromRegular, sampleWindow } from '../lib/precipNowcast/mrmsSubset';

function check(name: string, ok: boolean) {
  if (!ok) {
    console.error(`FAIL ${name}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${name}`);
}

const rows = 5;
const cols = 5;
const values = Array.from({ length: rows * cols }, (_, index) => index);
values[1 * cols + 2] = 42;
const grid = clipFromRegular({
  values,
  rows,
  cols,
  lat0: 10,
  lon0: -10,
  dLat: -1,
  dLon: 1,
  bounds: { west: -9.5, east: -6.5, south: 7.5, north: 10.5 },
  validAt: '2026-10-04T12:00:00.000Z',
  product: 'test',
  units: '1',
});
check('clip keeps the northwest cell as row 0', grid.height === 3 && grid.width === 3 && grid.north === 10 && grid.west === -9);
check('a known cell survives the clip', sampleWindow(grid, 9, -8) === 42);
check('outside the window is missing', sampleWindow(grid, 0, 0) === null);

const southUp = clipFromRegular({
  values,
  rows,
  cols,
  lat0: 6,
  lon0: -10,
  dLat: 1,
  dLon: 1,
  bounds: { west: -10.5, east: -6.5, south: 6.5, north: 9.5 },
  validAt: '2026-10-04T12:00:00.000Z',
  product: 'test',
  units: '1',
});
check('a south-up grid is flipped so row 0 is north', southUp.north === 9 && sampleWindow(southUp, 9, -10) === 3 * cols);

if (process.exitCode) process.exit(process.exitCode);
console.log('structure clip tests passed');
