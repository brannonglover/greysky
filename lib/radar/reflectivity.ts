/**
 * Reflectivity unit conversions, mirroring server/lib/reflectivity.ts.
 *
 * The service is the source of truth. These constants exist here because the
 * app and the service are separate deploy units, the same way palette.ts and
 * radarPalette.ts are mirrored. Change both together.
 */

/** Z = A * R^b, the standard Marshall-Palmer coefficients. */
export const ZR_A = 200;
export const ZR_B = 1.6;

export function dbzToZ(dbz: number): number {
  return 10 ** (dbz / 10);
}

export function zToDbz(z: number): number {
  return z <= 0 ? 0 : 10 * Math.log10(z);
}

/** dBZ -> rain rate (mm/hr). */
export function dbzToRainRate(dbz: number): number {
  return (dbzToZ(dbz) / ZR_A) ** (1 / ZR_B);
}

export function rainRateToDbz(rate: number): number {
  return rate <= 0 ? 0 : zToDbz(ZR_A * rate ** ZR_B);
}
