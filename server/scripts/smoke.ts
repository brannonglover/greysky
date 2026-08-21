import { writeFileSync } from 'node:fs';

import { forecastFrames, latestRun, loadGrid, resolveFrame } from '../lib/hrrr';
import { observedColorAt, observedTimes, selectObserved, wmsConfig } from '../lib/mrms';
import { dbzForColor } from '../lib/palette';
import { renderTile, sampleGridAt } from '../lib/render';

async function main() {
  const now = new Date();
  console.log('now                :', now.toISOString());

  const run = await latestRun(now);
  console.log('latest HRRR run    :', run.toISOString());

  const forecast = await forecastFrames(60, now);
  console.log('forecast frames    :', forecast.length);
  for (const frame of forecast) {
    const lead = ((frame.time * 1000 - now.getTime()) / 60_000).toFixed(0);
    const kb = ((frame.byteEnd - frame.byteStart) / 1024).toFixed(0);
    console.log(
      `  +${lead.padStart(3)}min  valid ${new Date(frame.time * 1000).toISOString()}  f${String(frame.forecastMinute).padStart(3)}  ${kb}KB`,
    );
  }

  const times = await observedTimes();
  const observed = selectObserved(times, 60, 5, now.getTime());
  console.log('observed advertised:', times.length, '-> selected', observed.length);
  for (const frame of observed) {
    const lead = ((frame.time * 1000 - now.getTime()) / 60_000).toFixed(0);
    console.log(`  ${lead.padStart(4)}min  ${frame.isoTime}`);
  }

  // Verify the observed WMS actually serves an image for the newest selection.
  const newest = observed[observed.length - 1];
  if (newest) {
    const cfg = wmsConfig(newest.isoTime);
    const query = new URLSearchParams({
      service: 'WMS',
      request: 'GetMap',
      ...cfg.params,
      crs: 'EPSG:4326',
      bbox: '30,-105,45,-85',
      width: '256',
      height: '256',
    });
    const res = await fetch(`${cfg.url}?${query.toString()}`);
    console.log('observed WMS probe :', res.status, res.headers.get('content-type'));

    // Point query over a storm core, exercising the palette inversion.
    const color = await observedColorAt(newest.isoTime, 50.585, -96.605);
    console.log('observed point     :', color, '->', color ? dbzForColor(color.r, color.g, color.b, color.a) : null, 'dBZ');
  }

  if (forecast.length === 0) throw new Error('No forecast frames resolved');

  const t0 = Date.now();
  const grid = await loadGrid(await resolveFrame(forecast[0].run, forecast[0].forecastMinute));
  console.log(`grid decode        : ${Date.now() - t0}ms  ${grid.cols}x${grid.rows}`);

  // z=5 over the mid-Mississippi valley, where there is reliably something to see.
  const t1 = Date.now();
  const png = renderTile(grid, 5, 7, 12);
  console.log(`tile render        : ${Date.now() - t1}ms  ${png.length} bytes`);
  writeFileSync('/tmp/tile_z5.png', png);

  const t2 = Date.now();
  const zoomed = renderTile(grid, 7, 33, 48);
  console.log(`tile render (z7)   : ${Date.now() - t2}ms  ${zoomed.length} bytes`);
  writeFileSync('/tmp/tile_z7.png', zoomed);

  console.log('forecast point     :', sampleGridAt(grid, 50.585, -96.605)?.toFixed(1), 'dBZ');

  console.log('OK');
}

main().catch((error) => {
  console.error('FAILED:', error);
  process.exit(1);
});
