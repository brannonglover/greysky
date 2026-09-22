/**
 * Base URL for the radar service. Shared by the manifest client and the point
 * sampler so there is exactly one place the service lives.
 */
export const RADAR_API =
  process.env.EXPO_PUBLIC_RADAR_API?.replace(/\/$/, '') ?? 'https://grey-sky-radar.vercel.app';
