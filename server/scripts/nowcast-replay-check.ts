/**
 * Replay one stored case with the frozen predictor.
 * This checks that the case format still loads. It does not retune anything.
 */
import { replayBundle } from '../lib/precipNowcast/archive';
import { listBundleDirs, readCase } from '../lib/precipNowcast/caseFile';
import { POINT_PREDICTOR_VERSION } from '../lib/precipNowcast/point';

const dirs = listBundleDirs();
if (!dirs.length) {
  console.log('no archived cases to replay');
  process.exit(0);
}
const dir = dirs[0];
const bundle = readCase(dir);
const pointId = bundle.points[0]?.id;
if (!pointId) {
  console.error(`no point in ${dir}`);
  process.exit(1);
}
if (bundle.predictorVersion !== POINT_PREDICTOR_VERSION) {
  console.error(`stored predictor ${bundle.predictorVersion}`);
  process.exit(1);
}
const result = replayBundle(dir, pointId, POINT_PREDICTOR_VERSION);
if (result.predictorVersion !== POINT_PREDICTOR_VERSION) {
  console.error(`replay returned ${result.predictorVersion}`);
  process.exit(1);
}
console.log(`replay ${result.predictorVersion} ${pointId} @ ${bundle.observationTime}`);
