export type RadarHtmlFrame = {
  time: number;
  urlTemplate: string;
};

export type RadarHtmlConfig = {
  lat: number;
  lng: number;
  zoom: number;
  frames: RadarHtmlFrame[];
  playing: boolean;
  index: number;
  intervalMs: number;
  interactive: boolean;
};

export type RadarCommand =
  | { type: 'init'; frames: RadarHtmlFrame[]; playing: boolean; index: number; intervalMs?: number }
  | { type: 'setFrames'; frames: RadarHtmlFrame[]; index?: number }
  | { type: 'setPlaying'; playing: boolean }
  | { type: 'seek'; index: number };

export type RadarMessage = {
  type: 'ready' | 'index';
  index?: number;
  time?: number;
};

const BOOTSTRAP = `
(function () {
  var state = window.__RADAR_INIT__ || {};
  var map = L.map('map', {
    center: [state.lat, state.lng],
    zoom: state.zoom,
    minZoom: 3,
    maxZoom: 7,
    zoomControl: false,
    attributionControl: true,
    dragging: !!state.interactive,
    scrollWheelZoom: !!state.interactive,
    doubleClickZoom: !!state.interactive,
    boxZoom: !!state.interactive,
    keyboard: !!state.interactive,
    touchZoom: !!state.interactive
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 7
  }).addTo(map);

  var pin = L.divIcon({
    className: 'ds-pin-wrap',
    html: '<div class="ds-pin"></div>',
    iconSize: [22, 30],
    iconAnchor: [11, 28]
  });
  L.marker([state.lat, state.lng], { icon: pin, interactive: false, keyboard: false }).addTo(map);

  var layers = [];
  var frames = [];
  var currentIndex = typeof state.index === 'number' ? state.index : 0;
  var playing = !!state.playing;
  var timer = null;
  var intervalMs = state.intervalMs || 700;

  function post(msg) {
    var payload = JSON.stringify(msg);
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(payload);
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, '*');
    }
  }

  function show(i) {
    if (!layers.length) return;
    currentIndex = ((i % layers.length) + layers.length) % layers.length;
    for (var n = 0; n < layers.length; n++) {
      layers[n].setOpacity(n === currentIndex ? 0.78 : 0);
    }
    var frame = frames[currentIndex];
    post({ type: 'index', index: currentIndex, time: frame ? frame.time : undefined });
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function startTimer() {
    stopTimer();
    if (!playing || layers.length < 2) return;
    timer = setInterval(function () {
      show(currentIndex + 1);
    }, intervalMs);
  }

  function setFrames(next, startIndex) {
    for (var i = 0; i < layers.length; i++) {
      map.removeLayer(layers[i]);
    }
    layers = [];
    frames = next || [];
    for (var j = 0; j < frames.length; j++) {
      var layer = L.tileLayer(frames[j].urlTemplate, {
        opacity: 0,
        maxZoom: 7,
        maxNativeZoom: 7,
        tileSize: 256,
        zIndex: 2
      });
      layer.addTo(map);
      layers.push(layer);
    }
    if (layers.length) {
      var idx = typeof startIndex === 'number' ? startIndex : currentIndex;
      show(idx);
    }
    if (playing) startTimer();
    else stopTimer();
  }

  window.applyRadarCommand = function (cmd) {
    if (!cmd || typeof cmd !== 'object') return;
    if (cmd.type === 'setFrames') {
      setFrames(cmd.frames || [], cmd.index);
    } else if (cmd.type === 'setPlaying') {
      playing = !!cmd.playing;
      if (playing) startTimer();
      else stopTimer();
    } else if (cmd.type === 'seek') {
      show(cmd.index);
    } else if (cmd.type === 'init') {
      if (typeof cmd.intervalMs === 'number') intervalMs = cmd.intervalMs;
      if (typeof cmd.playing === 'boolean') playing = cmd.playing;
      setFrames(cmd.frames || [], cmd.index);
    }
  };

  function onMessage(event) {
    var data = event && event.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (err) { return; }
    }
    if (data && data.type) window.applyRadarCommand(data);
  }
  document.addEventListener('message', onMessage);
  window.addEventListener('message', onMessage);

  setFrames(state.frames || [], state.index);
  if (playing) startTimer();
  post({ type: 'ready' });
})();
`;

export function buildRadarHtml(config: RadarHtmlConfig): string {
  const init = JSON.stringify(config);
  const mapBg = '#e8eef2';
  const pinFill = '#111111';
  const pinBorder = '#ffffff';
  const attribBg = 'rgba(255,255,255,0.72)';
  const attribColor = '#333333';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; background: ${mapBg}; }
    .ds-pin-wrap { background: transparent !important; border: none !important; }
    .ds-pin {
      width: 16px;
      height: 16px;
      margin: 2px auto 0;
      background: ${pinFill};
      border: 2px solid ${pinBorder};
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      box-shadow: 0 1px 4px rgba(0,0,0,0.35);
    }
    .leaflet-control-attribution {
      font-size: 9px;
      background: ${attribBg} !important;
      color: ${attribColor} !important;
    }
    .leaflet-control-attribution a { color: ${attribColor} !important; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>window.__RADAR_INIT__=${init};</script>
  <script>${BOOTSTRAP}</script>
</body>
</html>`;
}

export function parseRadarMessage(raw: string): RadarMessage | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const type = (data as { type?: unknown }).type;
    if (type !== 'ready' && type !== 'index') return null;
    const index = (data as { index?: unknown }).index;
    const time = (data as { time?: unknown }).time;
    return {
      type,
      index: typeof index === 'number' ? index : undefined,
      time: typeof time === 'number' ? time : undefined,
    };
  } catch {
    return null;
  }
}
