/**
 * Renders the app's radar WebView HTML against the live service and serves it,
 * so the Leaflet layer wiring can be checked in a real browser.
 */
import { createServer } from 'node:http';

import { buildRadarHtml } from '../../lib/radarHtml';

const SERVICE = process.env.RADAR_API ?? 'https://grey-sky-radar.vercel.app';
const PORT = 8099;

/**
 * Mirrors RadarTimeline's layout math in plain HTML so the tick and Now-marker
 * geometry can be eyeballed without booting the app.
 */
function timelinePage(frames: Array<{ time: number; kind: string }>): string {
  const nowSec = Date.now() / 1000;
  const start = nowSec - 3600;
  const end = nowSec + 3600;
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - start) / (end - start)) * 100));
  const index = frames.map((f) => f.kind).lastIndexOf('observed');

  const ticks = frames
    .map((f, i) => {
      const filled = i <= index ? ' filled' : '';
      return `<div class="tick${filled}" style="left:${pct(f.time)}%" title="${f.kind} ${((f.time - nowSec) / 60).toFixed(0)}min"></div>`;
    })
    .join('');

  const rows = frames
    .map(
      (f, i) =>
        `<tr><td>${i}</td><td>${f.kind}</td><td>${((f.time - nowSec) / 60).toFixed(1)}</td><td>${pct(f.time).toFixed(2)}%</td></tr>`,
    )
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { background:#101317; color:#e8eef2; font:13px ui-monospace,monospace; padding:40px; }
    .wrap { width:900px; zoom:1.6; }
    .track { height:36px; display:flex; align-items:center; position:relative; }
    .axis { height:12px; position:relative; width:100%; }
    .rail { height:4px; border-radius:2px; background:rgba(255,255,255,0.14); position:absolute; top:4px; width:100%; }
    .railPlayed { position:absolute; top:4px; left:0; height:4px; border-radius:2px; background:#5AC8FA; width:${pct(frames[index]?.time ?? nowSec)}%; }
    .tick { position:absolute; top:1px; width:6px; height:10px; margin-left:-3px; border-radius:3px; background:rgba(255,255,255,0.28); }
    .tick.filled { background:#5AC8FA; }
    .nowLine { position:absolute; top:-4px; width:2px; height:20px; margin-left:-1px; border-radius:1px; background:#fff; left:${pct(nowSec)}%; }
    .thumb { position:absolute; top:50%; width:16px; height:16px; margin-top:-8px; margin-left:-8px; border-radius:8px; background:#fff; left:${pct(frames[index]?.time ?? nowSec)}%; }
    .labels { height:14px; margin-top:2px; position:relative; }
    .label { position:absolute; top:0; color:#8a9299; font-size:10px; }
    .nowLabel { position:absolute; top:0; width:28px; margin-left:-14px; text-align:center; font-size:10px; text-transform:uppercase; left:${pct(nowSec)}%; }
    .guide { position:absolute; top:0; bottom:0; width:1px; background:#ff00aa; left:50%; }
    table { margin-top:32px; border-collapse:collapse; } td,th { padding:2px 12px 2px 0; text-align:left; }
  </style></head><body>
  <div class="wrap">
    <div class="track">
      <div class="guide"></div>
      <div class="axis">
        <div class="rail"></div><div class="railPlayed"></div>
        ${ticks}
        <div class="nowLine"></div>
      </div>
      <div class="thumb"></div>
    </div>
    <div class="labels">
      <div class="label" style="left:0">-1h</div>
      <div class="nowLabel">Now</div>
      <div class="label" style="right:0">+1h</div>
    </div>
  </div>
  <p>magenta guide = exact 50% of track. Now line should sit exactly on it.</p>
  <p>Now line computed at <b>${pct(nowSec).toFixed(4)}%</b></p>
  <table><tr><th>i</th><th>kind</th><th>min</th><th>left</th></tr>${rows}</table>
  </body></html>`;
}

createServer(async (req, res) => {
  const manifest = await fetch(`${SERVICE}/api/radar/frames`).then((r) => r.json());

  if (req.url?.startsWith('/timeline')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(timelinePage(manifest.frames));
    return;
  }
  const startAt = req.url?.includes('forecast')
    ? manifest.frames.findIndex((f: { kind: string }) => f.kind === 'forecast')
    : manifest.frames.map((f: { kind: string }) => f.kind).lastIndexOf('observed');

  const html = buildRadarHtml({
    lat: 35.4,
    lng: -96.3,
    zoom: 6,
    frames: manifest.frames,
    playing: false,
    index: Math.max(0, startAt),
    intervalMs: 700,
    interactive: true,
  });
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}).listen(PORT, () => console.log(`radar preview on http://localhost:${PORT}/ (add ?forecast for HRRR)`));
