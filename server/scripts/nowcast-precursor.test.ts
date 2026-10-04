/**
 * Initiation is new rain after alignment. A translated cell is not initiation.
 * One pair of specks is not a persistent region. Trace is not light rain.
 */
import { CELL_EMPTY, CELL_VALUE, emptyField, regionGeometry, type ObservationField } from '../lib/precipNowcast/field';
import { classifyOutcome, precursorFeatures, trajectoryMask, uniformMotion } from '../lib/precipNowcast/precursor';

function check(name: string, ok: boolean) {
  if (!ok) {
    console.error(`FAIL ${name}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${name}`);
}

function frame(validAt: string, paint: (field: ObservationField) => void): ObservationField {
  const geometry = regionGeometry(0, 0, 48 * 2000 / 111_320, 48, 48);
  const field = emptyField(validAt, geometry, { id: 'test', product: 'test' });
  field.state.fill(CELL_EMPTY);
  paint(field);
  return field;
}

function set(field: ObservationField, x: number, y: number, rate: number) {
  const index = y * field.geometry.width + x;
  field.state[index] = CELL_VALUE;
  field.rainRateMmHr[index] = rate;
}

const older = frame('2026-10-04T12:00:00.000Z', (field) => set(field, 20, 24, 2));
const grown = frame('2026-10-04T12:02:00.000Z', (field) => set(field, 20, 24, 6));
const born = frame('2026-10-04T12:02:00.000Z', (field) => set(field, 20, 24, 1));
const dry = frame('2026-10-04T12:00:00.000Z', () => undefined);
const still = uniformMotion(48, 48, 0, 0);
const grew = precursorFeatures([older, grown], still, 0, 0);
const started = precursorFeatures([dry, born], still, 0, 0);
check('existing rain that intensifies is growth, not initiation', (grew.existingGrowthFraction ?? 0) > 0 && (grew.circleInitiationFraction ?? 1) === 0);
check('rain appearing in a dry aligned field is initiation', (started.circleInitiationFraction ?? 0) > 0 && (started.existingGrowthFraction ?? 1) === 0);
check('one pair is not a persistent component', started.persistentComponents === 0);

const mpp = older.geometry.metersPerPixelX;
const shiftPx = 6;
const motion = uniformMotion(48, 48, (shiftPx * mpp) / 120, 0);
const translatedOld = frame('2026-10-04T12:00:00.000Z', (field) => set(field, 18, 24, 4));
const translatedNew = frame('2026-10-04T12:02:00.000Z', (field) => set(field, 18 + shiftPx, 24, 4));
const translated = precursorFeatures([translatedOld, translatedNew], motion, 0, 0);
check('a translated cell is not counted as initiation', (translated.circleInitiationFraction ?? 1) === 0);

const mask = trajectoryMask(older, uniformMotion(48, 48, 10, 0), 24, 24);
const west = 24 * older.geometry.width + (24 - 5);
const east = 24 * older.geometry.width + (24 + 5);
const north = (24 - 6) * older.geometry.width + 24;
check('upstream cell is in the corridor', mask.supported && mask.corridor[west] === 1 && mask.corridor[east] === 0);
check('cross-track cell outside the band is not in the corridor', mask.corridor[north] === 0);

check('trace is not meaningful rain', classifyOutcome(0, 0.05) === 'trace-only');
check('a jump from light rain is intensification', classifyOutcome(2, 9) === 'intensified');
check('dropping below light rain is weakening', classifyOutcome(2, 0.1) === 'weakened');

if (process.exitCode) process.exit(process.exitCode);
console.log('precursor tests passed');
