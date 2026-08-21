/**
 * NOAA reflectivity ramp, mirroring server/lib/palette.ts so the app can render
 * legends and swatches that match the radar tiles. The service is the source of
 * truth and ships the legend in its frames response; this is the offline
 * fallback.
 */
export const NOAA_REFLECTIVITY: readonly { dbz: number; color: string }[] = [
  { dbz: 5, color: '#6c7fac' },
  { dbz: 10, color: '#4c72ab' },
  { dbz: 15, color: '#57bab9' },
  { dbz: 20, color: '#39d46e' },
  { dbz: 25, color: '#0db213' },
  { dbz: 30, color: '#1b820c' },
  { dbz: 35, color: '#6d8f05' },
  { dbz: 40, color: '#f9d600' },
  { dbz: 45, color: '#ff9100' },
  { dbz: 50, color: '#f90400' },
  { dbz: 55, color: '#bb1313' },
  { dbz: 60, color: '#fdf7f7' },
];
