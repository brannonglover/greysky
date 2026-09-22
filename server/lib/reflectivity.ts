/**
 * Reflectivity unit conversions.
 *
 * Source of truth for the Marshall-Palmer Z-R relation used anywhere in the
 * project. lib/radar/reflectivity.ts in the app mirrors these constants;
 * Vercel deploys the server directory in isolation, so the two cannot share a
 * module, but they must not drift.
 *
 * Why this matters for blending: dBZ is a LOGARITHM. Interpolating dBZ
 * linearly is a geometric mean of the physical quantity, which collapses any
 * echo present in only one of the two sources. Blending in Z or in rain rate
 * interpolates a linear quantity instead.
 */

/** Z = A * R^b, the standard Marshall-Palmer coefficients. */
export const ZR_A = 200;
export const ZR_B = 1.6;

/** dBZ -> linear reflectivity factor Z (mm^6 m^-3). */
export function dbzToZ(dbz: number): number {
  return 10 ** (dbz / 10);
}

/** Linear reflectivity factor Z -> dBZ. Z <= 0 has no logarithm. */
export function zToDbz(z: number): number {
  return z <= 0 ? 0 : 10 * Math.log10(z);
}

/** dBZ -> rain rate (mm/hr). */
export function dbzToRainRate(dbz: number): number {
  return (dbzToZ(dbz) / ZR_A) ** (1 / ZR_B);
}

/** Rain rate (mm/hr) -> dBZ. */
export function rainRateToDbz(rate: number): number {
  return rate <= 0 ? 0 : zToDbz(ZR_A * rate ** ZR_B);
}
