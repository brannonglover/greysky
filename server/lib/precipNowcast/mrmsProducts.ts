/**
 * Native MRMS products that might show initiation sooner than the styled
 * composite. Inventory only. Nothing here is decoded into the nowcast.
 *
 * Public S3 objects are full-CONUS GRIB, gzipped. There is no spatial subset,
 * so a frame has to be downloaded whole before it can be read.
 */
export type MrMsCandidate = {
  id: string;
  folder: string;
  cadence: string;
  grid: string;
  mightAdd: string;
};

export const MRMS_CANDIDATES: readonly MrMsCandidate[] = [
  {
    id: 'PrecipRate',
    folder: 'CONUS/PrecipRate_00.00',
    cadence: 'about 2 min',
    grid: '7000×3500, about 1 km',
    mightAdd: 'A rate that is not passed through the styled palette and Marshall-Palmer.',
  },
  {
    id: 'MergedReflectivityQCComposite',
    folder: 'CONUS/MergedReflectivityQCComposite_00.50',
    cadence: 'about 2 min',
    grid: '3500×1750 or 7000×3500',
    mightAdd: 'The same composite the map uses, as dBZ instead of a painted PNG.',
  },
  {
    id: 'MergedReflectivityQComposite',
    folder: 'CONUS/MergedReflectivityQComposite_00.50',
    cadence: 'about 2 min',
    grid: 'about 1 km',
    mightAdd: 'Another full-column composite. Not a verified low-level scan.',
  },
  {
    id: 'MergedReflectivityAtLowestAltitude',
    folder: 'CONUS/MergedReflectivityAtLowestAltitude_00.50',
    cadence: 'about 2 min',
    grid: 'about 1 km',
    mightAdd: 'Reflectivity near the ground. A weak boundary can exist there before a composite core.',
  },
  {
    id: 'EchoTop',
    folder: 'CONUS/EchoTop_18_00.50',
    cadence: 'about 2 min',
    grid: 'about 1 km',
    mightAdd: '18 dBZ echo top. Rising tops are a growth sign the surface rate does not show.',
  },
  {
    id: 'VIL',
    folder: 'CONUS/VIL_00.50',
    cadence: 'about 2 min',
    grid: 'about 1 km',
    mightAdd: 'Vertically integrated liquid. Column water increasing before a heavy surface rate.',
  },
  {
    id: 'RadarQualityIndex',
    folder: 'CONUS/RadarQualityIndex_00.00',
    cadence: 'about 2 min',
    grid: 'about 1 km',
    mightAdd: 'Where the radar is too poor to trust a dry sample. Not an initiation signal itself.',
  },
];

const BUCKET = 'https://noaa-mrms-pds.s3.amazonaws.com';

export type MrMsProbe = MrMsCandidate & {
  listed: boolean;
  bytes: number | null;
  sampleKey: string | null;
  note: string;
};

async function listOne(prefix: string): Promise<string | null> {
  const url = `${BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const text = await res.text();
  const match = text.match(/<Key>([^<]+)<\/Key>/);
  return match?.[1] ?? null;
}

export async function probeMrmsProducts(day = '20261004'): Promise<MrMsProbe[]> {
  const probes: MrMsProbe[] = [];
  for (const candidate of MRMS_CANDIDATES) {
    const key = await listOne(`${candidate.folder}/${day}/`).catch(() => null);
    if (!key) {
      probes.push({ ...candidate, listed: false, bytes: null, sampleKey: null, note: 'No object listed for this day.' });
      continue;
    }
    const head = await fetch(`${BUCKET}/${key}`, { method: 'HEAD' }).catch(() => null);
    const bytes = head?.ok ? Number(head.headers.get('content-length')) : null;
    probes.push({
      ...candidate,
      listed: true,
      bytes: Number.isFinite(bytes) ? bytes : null,
      sampleKey: key,
      note: 'Full CONUS gzip. No regional subset on this bucket.',
    });
  }
  return probes;
}
