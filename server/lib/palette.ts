/**
 * Reflectivity color ramp, sampled from NOAA GeoServer's rendering of
 * conus_cref_qcd so forecast tiles rendered here match the observed WMS tiles
 * the client loads directly from NOAA. Derived by correlating a GetMap response
 * against the decoded MRMS grid for the same timestamp, one entry per dBZ.
 *
 * If NOAA restyles the layer these drift and observed frames stop matching
 * forecast frames. Resample by rendering a GetMap over a region with a strong
 * core, decoding the MRMS GRIB2 for the same TIME, and bucketing the rendered
 * pixel colours by dBZ.
 */
const RAMP: Array<[number, number, number, number]> = [
  [5, 0x6c, 0x7f, 0xac], [6, 0x62, 0x77, 0xa9], [7, 0x57, 0x6e, 0xa6],
  [8, 0x51, 0x6a, 0xa4], [9, 0x4a, 0x68, 0xa4], [10, 0x4c, 0x72, 0xab],
  [11, 0x50, 0x82, 0xb4], [12, 0x55, 0x92, 0xbd], [13, 0x58, 0xa1, 0xc2],
  [14, 0x59, 0xb1, 0xc1], [15, 0x57, 0xba, 0xb9], [16, 0x55, 0xc3, 0xb0],
  [17, 0x50, 0xc9, 0xa4], [18, 0x4b, 0xce, 0x96], [19, 0x43, 0xd3, 0x84],
  [20, 0x39, 0xd4, 0x6e], [21, 0x2b, 0xd2, 0x51], [22, 0x22, 0xd0, 0x3d],
  [23, 0x17, 0xc9, 0x26], [24, 0x11, 0xc0, 0x19], [25, 0x0d, 0xb2, 0x13],
  [26, 0x0d, 0xa5, 0x11], [27, 0x0d, 0x98, 0x10], [28, 0x0f, 0x8f, 0x0f],
  [29, 0x10, 0x85, 0x0e], [30, 0x1b, 0x82, 0x0c], [31, 0x2b, 0x83, 0x0b],
  [32, 0x40, 0x87, 0x09], [33, 0x5d, 0x8f, 0x07], [34, 0x63, 0x8e, 0x06],
  [35, 0x6d, 0x8f, 0x05], [36, 0x7d, 0x98, 0x05], [37, 0x95, 0xa5, 0x04],
  [38, 0xb6, 0xb5, 0x03], [39, 0xd8, 0xc5, 0x01], [40, 0xf9, 0xd6, 0x00],
  [41, 0xff, 0xca, 0x00], [42, 0xff, 0xbd, 0x00], [43, 0xff, 0xb0, 0x00],
  [44, 0xff, 0xa2, 0x00], [45, 0xff, 0x91, 0x00], [46, 0xfe, 0x85, 0x00],
  [47, 0xff, 0x5d, 0x00], [48, 0xff, 0x3c, 0x00], [49, 0xfe, 0x1f, 0x00],
  [50, 0xf9, 0x04, 0x00], [51, 0xea, 0x00, 0x00], [52, 0xde, 0x00, 0x00],
  [53, 0xcb, 0x00, 0x00], [54, 0xbe, 0x06, 0x06], [55, 0xbb, 0x13, 0x13],
  [56, 0xc5, 0x3f, 0x3f], [57, 0xd1, 0x67, 0x67], [58, 0xdd, 0x91, 0x91],
  [59, 0xf5, 0xdb, 0xdd], [60, 0xfd, 0xf7, 0xf7],
];

export const MIN_DBZ = RAMP[0][0];
const MAX_DBZ = RAMP[RAMP.length - 1][0];

/**
 * HRRR encodes "no echo" as a large negative value that covers most of the
 * grid, so anything under MIN_DBZ must stay fully transparent or the overlay
 * washes out the basemap.
 */
export function colorForDbz(dbz: number): [number, number, number, number] | null {
  if (!(dbz >= MIN_DBZ)) return null;
  if (dbz >= MAX_DBZ) {
    const top = RAMP[RAMP.length - 1];
    return [top[1], top[2], top[3], 255];
  }
  const i = Math.min(RAMP.length - 2, Math.max(0, Math.floor(dbz) - MIN_DBZ));
  const lo = RAMP[i];
  const hi = RAMP[i + 1];
  const t = (dbz - lo[0]) / (hi[0] - lo[0]);
  return [
    Math.round(lo[1] + (hi[1] - lo[1]) * t),
    Math.round(lo[2] + (hi[2] - lo[2]) * t),
    Math.round(lo[3] + (hi[3] - lo[3]) * t),
    255,
  ];
}

/**
 * Nearest dBZ for a rendered colour, used to read observed intensity back out
 * of NOAA's styled WMS output. Returns null for fully transparent or
 * off-palette pixels so callers can distinguish "no echo" from "weak echo".
 */
export function dbzForColor(r: number, g: number, b: number, a: number): number | null {
  if (a < 24) return null;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [dbz, cr, cg, cb] of RAMP) {
    const distance = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = dbz;
    }
  }
  // Guard against basemap bleed or antialiased edges landing far from the ramp.
  return bestDistance > 4_000 ? null : best;
}

/** Legend stops for the client, coarse enough to render as a compact swatch strip. */
export function legendStops(): Array<{ dbz: number; color: string }> {
  return [5, 15, 25, 35, 45, 55].map((dbz) => {
    const c = colorForDbz(dbz)!;
    return { dbz, color: `#${[c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}` };
  });
}
