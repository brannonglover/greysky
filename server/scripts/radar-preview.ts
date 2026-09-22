/**
 * Serves the Grey Sky radar in a real browser against the live service, so the
 * MapLibre layer wiring, the vector basemap and the WMS/XYZ transport union can
 * be checked without a device build.
 *
 *   npm run preview   ->  http://localhost:8099
 *                         /timeline  for the tick geometry
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';

import { greySkyBasemap, RADAR_INSERT_BEFORE } from '../../lib/radar/basemap';
import { createRadarService } from '../lib/radar/registry';

/**
 * Unset: build the manifest in-process, so the preview exercises the local
 * providers before anything is deployed. Set RADAR_API to hit a deployment.
 */
const SERVICE = process.env.RADAR_API;
const PORT = 8099;
/**
 * maplibre-gl v6 ships ESM only — there is no UMD bundle and no global, so the
 * page imports the module and the server hands out the real dist files from
 * node_modules. That also pins the preview to the exact version the app uses.
 */
const DIST = require.resolve('maplibre-gl/dist/maplibre-gl.mjs', {
  paths: [join(__dirname, '..', '..')],
});
const DIST_DIR = dirname(DIST);

type Frame = {
  id: string;
  timestamp: number;
  kind: 'observed' | 'nowcast' | 'forecast';
  providerId: string;
  leadMinutes?: number;
  blend?: {
    nowcastWeight: number;
    forecastWeight: number;
    nowcastProvider: string;
    forecastProvider: string;
  };
  source:
    | { kind: 'xyz'; urlTemplate: string }
    | { kind: 'wms'; url: string; params: Record<string, string> };
};

type Manifest = {
  frames: Frame[];
  observedThrough: number | null;
  attribution: string[];
};

/** Mirrors lib/radar/tileSource.ts; kept tiny so the preview has no app deps. */
function tilesFor(frame: Frame): string[] {
  if (frame.source.kind === 'xyz') return [frame.source.urlTemplate];
  const params: Record<string, string> = {
    service: 'WMS',
    request: 'GetMap',
    version: '1.3.0',
    transparent: 'true',
    format: 'image/png',
    ...frame.source.params,
    crs: 'EPSG:3857',
    width: '256',
    height: '256',
  };
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return [`${frame.source.url}?${query}&bbox={bbox-epsg-3857}`];
}

function mapPage(manifest: Manifest): string {
  const frames = manifest.frames.map((frame) => ({
    id: frame.id,
    timestamp: frame.timestamp,
    kind: frame.kind,
    providerId: frame.providerId,
    leadMinutes: frame.leadMinutes ?? null,
    blend: frame.blend ?? null,
    tiles: tilesFor(frame),
  }));

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="/maplibre-gl.css" rel="stylesheet" />
<style>
  html,body{margin:0;height:100%;background:#0B1120;color:#EEF2F8;
    font:13px ui-monospace,SFMono-Regular,Menlo,monospace;}
  #map{position:absolute;inset:0;}
  #hud{position:absolute;left:16px;bottom:16px;right:16px;z-index:2;
    background:rgba(10,14,24,.82);border:1px solid rgba(255,255,255,.12);
    border-radius:16px;padding:14px 16px;display:flex;gap:14px;align-items:center;}
  #scrub{flex:1;}
  #stamp{min-width:280px;text-align:right;}
  .mix{color:#8295B4;}
  .obs{color:#4FC3E8;} .fut{color:#FF9166;}
  button{background:rgba(255,255,255,.16);border:0;color:inherit;border-radius:18px;
    width:44px;height:36px;font:inherit;cursor:pointer;}
</style></head><body>
<div id="map"></div>
<div id="hud">
  <button id="play">&#9654;</button>
  <input id="scrub" type="range" min="0" max="${Math.max(0, frames.length - 1)}" value="0" />
  <div id="stamp"></div>
</div>
<script type="module">
import { Map as MaplibreMap } from '/maplibre-gl.mjs';
const FRAMES = ${JSON.stringify(frames)};
const STYLE = ${JSON.stringify(greySkyBasemap())};
const BEFORE = ${JSON.stringify(RADAR_INSERT_BEFORE)};

const map = new MaplibreMap({
  container: 'map', style: STYLE, center: [-84.4, 33.8], zoom: 6, maxZoom: 16,
});
// Debug hook so the preview can be inspected from the console.
window.__map = map; window.__frames = FRAMES;

let index = 0, playing = false, timer = null;

// Mount lazily around the playhead. Mounting all frames at once means every
// blended tile in the loop renders cold simultaneously, which saturates the
// service and stalls the style.
var RING = 1;
function ensure(i) {
  var frame = FRAMES[i];
  if (!frame || map.getSource(frame.id)) return;
  map.addSource(frame.id, { type: 'raster', tiles: frame.tiles, tileSize: 256, maxzoom: 9 });
  map.addLayer({
    id: frame.id + '-layer', type: 'raster', source: frame.id,
    paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 },
  }, map.getLayer(BEFORE) ? BEFORE : undefined);
}

map.on('load', () => {
  show(FRAMES.findIndex((f) => f.kind !== 'observed') - 1);
});

function show(next) {
  index = Math.max(0, Math.min(FRAMES.length - 1, next));
  for (var k = index - RING; k <= index + RING; k++) ensure(k);
  FRAMES.forEach((frame, i) => {
    if (!map.getLayer(frame.id + '-layer')) return;
    map.setPaintProperty(frame.id + '-layer', 'raster-opacity', i === index ? 0.82 : 0);
  });
  const frame = FRAMES[index];
  const mins = Math.round((frame.timestamp - Date.now() / 1000) / 60);
  document.getElementById('scrub').value = String(index);
  var mix = frame.blend
    ? ' <span class="mix">' + Math.round(frame.blend.nowcastWeight * 100) + '% nowcast / ' +
      Math.round(frame.blend.forecastWeight * 100) + '% hrrr</span>'
    : ' <span class="mix">100% ' + frame.providerId + '</span>';
  document.getElementById('stamp').innerHTML =
    '<span class="' + (frame.kind === 'observed' ? 'obs' : 'fut') + '">' +
    frame.kind + '</span> &middot; ' + (mins >= 0 ? '+' : '') + mins + 'm &middot;' + mix;
}

document.getElementById('scrub').addEventListener('input', (e) => {
  stop(); show(Number(e.target.value));
});
document.getElementById('play').addEventListener('click', () => {
  if (playing) return stop();
  playing = true;
  document.getElementById('play').innerHTML = '&#10073;&#10073;';
  timer = setInterval(() => show((index + 1) % FRAMES.length), 450);
});
function stop() {
  playing = false; clearInterval(timer);
  document.getElementById('play').innerHTML = '&#9654;';
}
map.on('error', (e) => console.error('maplibre:', e && e.error && e.error.message));
map.on('data', (e) => { if (e.sourceId && e.sourceId.startsWith('radar-') && e.isSourceLoaded)
  console.log('radar source loaded:', e.sourceId); });
</script></body></html>`;
}

/** Tick and Now-marker geometry, checkable without booting the app. */
function timelinePage(manifest: Manifest): string {
  const nowSec = Date.now() / 1000;
  const start = nowSec - 3600;
  const end = nowSec + 3600;
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - start) / (end - start)) * 100));
  const boundary = manifest.observedThrough ?? nowSec;

  const ticks = manifest.frames
    .map(
      (f) =>
        `<div class="tick ${f.kind}" style="left:${pct(f.timestamp)}%" title="${f.kind} ${f.providerId}"></div>`,
    )
    .join('');
  const rows = manifest.frames
    .map(
      (f, i) =>
        `<tr><td>${i}</td><td>${f.kind}</td><td>${f.providerId}</td><td>${((f.timestamp - nowSec) / 60).toFixed(1)}</td></tr>`,
    )
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{background:#0B1120;color:#EEF2F8;font:13px ui-monospace,monospace;padding:40px;}
    .wrap{width:900px;}
    .axis{height:14px;position:relative;width:100%;margin-top:30px;}
    .rail{height:4px;border-radius:2px;background:rgba(255,255,255,.14);position:absolute;top:5px;width:100%;}
    .tick{position:absolute;top:2px;width:6px;height:10px;margin-left:-3px;border-radius:3px;background:#4FC3E8;}
    .tick.forecast,.tick.nowcast{background:transparent;border:1px solid rgba(255,255,255,.45);}
    .now{position:absolute;top:-3px;width:2px;height:20px;margin-left:-1px;background:#fff;left:${pct(nowSec)}%;}
    .bound{position:absolute;top:-1px;width:1px;height:16px;background:#FF9166;left:${pct(boundary)}%;}
    table{margin-top:36px;border-collapse:collapse;} td,th{padding:2px 14px 2px 0;text-align:left;}
    .k{color:#8295B4;}
  </style></head><body><div class="wrap">
    <div class="axis"><div class="rail"></div>${ticks}<div class="now"></div><div class="bound"></div></div>
    <p class="k">white = now &middot; orange = last observation (${((boundary - nowSec) / 60).toFixed(1)} min old)</p>
    <p class="k">${manifest.attribution.join(' &middot; ')}</p>
    <table><tr><th>i</th><th>kind</th><th>provider</th><th>min</th></tr>${rows}</table>
  </div></body></html>`;
}

async function loadManifest(): Promise<Manifest> {
  if (SERVICE) {
    return fetch(`${SERVICE}/api/v2/radar/frames`).then((r) => r.json()) as Promise<Manifest>;
  }
  const now = Math.round(Date.now() / 1000);
  return createRadarService('default').getManifest({
    now,
    origin: 'https://grey-sky-radar.vercel.app',
    pastMin: 60,
    futureMin: 60,
    observedCadenceSec: 300,
    futureCadenceSec: 300,
  }) as unknown as Promise<Manifest>;
}

const ASSETS: Record<string, string> = {
  '/maplibre-gl.mjs': 'application/javascript',
  '/maplibre-gl-shared.mjs': 'application/javascript',
  '/maplibre-gl-worker.mjs': 'application/javascript',
  '/maplibre-gl.css': 'text/css',
};

createServer(async (req, res) => {
  try {
    const path = (req.url ?? '/').split('?')[0];
    const contentType = ASSETS[path];
    if (contentType) {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(readFileSync(join(DIST_DIR, path.slice(1))));
      return;
    }
    // Serve the real v2 manifest too, so a dev build of the app can point
    // EXPO_PUBLIC_RADAR_API here before the endpoint is deployed.
    if (path === '/api/v2/radar/frames') {
      const manifest = await loadManifest();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(manifest));
      return;
    }

    const manifest = await loadManifest();
    const html = path.startsWith('/timeline') ? timelinePage(manifest) : mapPage(manifest);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(error instanceof Error ? error.message : 'preview failed');
  }
}).listen(PORT, () =>
  console.log(`radar preview on http://localhost:${PORT}/ (/timeline for geometry)`),
);
