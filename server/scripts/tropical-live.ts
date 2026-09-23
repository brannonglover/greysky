/**
 * Live format check against NHC. Informational, not a test — it confirms the
 * real upstream still matches what the parser expects. Out of season there are
 * no storms to read, which is reported and exits clean.
 *
 * Regression coverage lives in tropical.test.ts, against fixtures.
 */

import { fetchTropicalStorms } from '../lib/tropical';

function clock(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

async function main() {
  const storms = await fetchTropicalStorms();

  if (storms.length === 0) {
    console.log('\nNo active tropical cyclones. Nothing to verify — this is normal out of season.\n');
    return;
  }

  console.log(`\n${storms.length} active system(s)\n`);

  let missingTracks = 0;
  for (const storm of storms) {
    console.log(
      `${storm.name} (${storm.classification}) ${storm.id}  ` +
        `${storm.maxWindKt} kt  ${storm.pressureMb ?? '—'} mb  ` +
        `${storm.latitude.toFixed(1)}, ${storm.longitude.toFixed(1)}  adv ${storm.advisoryNumber ?? '—'}`,
    );

    if (!storm.trackAvailable) {
      missingTracks += 1;
      console.log('  forecast track unavailable\n');
      continue;
    }

    for (const point of storm.track) {
      const radii = [
        point.radii64 ? '64' : null,
        point.radii50 ? '50' : null,
        point.radii34 ? '34' : null,
      ].filter(Boolean);
      console.log(
        `  ${point.outlook ? 'outlook ' : 'forecast'} ${clock(point.time)}  ` +
          `${point.latitude.toFixed(1)}, ${point.longitude.toFixed(1)}  ` +
          `${String(point.maxWindKt).padStart(3)} kt g${String(point.gustKt).padStart(3)}  ` +
          `radii: ${radii.length ? radii.join('/') : 'none'}`,
      );
    }

    const ordered = storm.track.every((p, i) => i === 0 || p.time > storm.track[i - 1].time);
    if (!ordered) console.error('  WARNING: forecast times are not strictly increasing');
    console.log('');
  }

  if (missingTracks > 0) {
    console.log(`${missingTracks} of ${storms.length} system(s) had no parseable forecast track.`);
    console.log('That is expected for a newly-formed system; persistent failures mean the');
    console.log('advisory format has shifted and server/lib/tropical.ts needs updating.\n');
  }
}

main().catch((error) => {
  console.error('\nLive check failed:', error instanceof Error ? error.message : error, '\n');
  process.exit(1);
});
