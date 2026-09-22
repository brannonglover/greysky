# Radar architecture

```
Observed MRMS  →  MRMS advection nowcast  →  rain-rate MRMS/HRRR transition  →  HRRR forecast
   -60 .. 0 min          0 .. ~15 min                ~15 .. 45 min                   45+ min
```

The client receives one chronological array of `RadarFrame` objects and never
learns which provider produced any of them. Swapping providers is a change to
`server/lib/radar/registry.ts` and nothing else.

## Components

| Piece | Location |
|---|---|
| Frame/provider contracts | `server/lib/radar/types.ts`, mirrored in `lib/radar/types.ts` |
| Provider composition | `server/lib/radar/service.ts` |
| Provider selection | `server/lib/radar/registry.ts` |
| Transition curve | `server/lib/radar/transition.ts` |
| Blended tile renderer | `server/lib/transitionTile.ts` |
| Reflectivity conversions | `server/lib/reflectivity.ts`, mirrored in `lib/radar/reflectivity.ts` |
| Map (native / web) | `components/RadarMap.tsx`, `components/RadarMap.web.tsx` |

Future providers declare a `leadRange` and return `FutureSample`s. They overlap
deliberately, and the service decides per frame how much each contributes — it
is not "first provider that returns frames wins".

## Blending

Blended frames interpolate in **rain-rate space** (Marshall-Palmer, `Z = 200 R^1.6`)
and are colorized exactly once. Never alpha-blend rendered radar images, and
never interpolate dBZ directly.

dBZ is logarithmic, so interpolating it is a geometric mean of the physical
quantity. Measured across four regions at 50/50, linear-dBZ kept only 12% of
observation cores and 7% of HRRR cores and produced fields weaker than *either*
input — storms visibly dissolved mid-transition and re-formed afterwards.
Linear-Z preserved 84%/53% but superimposed both fields. Rain rate keeps
73%/25%, stays inside the source intensity range, and gave the smallest
frame-to-frame change.

Missing data is kept distinct from no-echo. Where only one source covers a
pixel the other is used at full strength, so coverage boundaries do not
artificially weaken either field.

## Known limitation: the first ~15 minutes do not evolve

**The MRMS advection nowcast estimates precipitation motion only.** It does not
model growth, decay, initiation or dissipation. During the earliest future
frames, existing precipitation moves smoothly while largely retaining its
structure. This is intentional with the current implementation.

Do not mask this by blending HRRR in earlier. That was tested and rejected:

| Weight at +5 | Evolution at +6m | Echo delta | ≥35 cores (Carolina) |
|---|---|---|---|
| 0% (shipped) | 1.2% | — | 145 |
| 3% | 3.4% | +0.07 pp | 134 |
| 10% | 3.1% | +0.21 pp | 165 |
| 20% | 5.1% | +0.35 pp | 247 |

At 3% nothing measurable changes. Only near 20% does the animation visibly
evolve, and by then HRRR is inserting cells and cores the radar does not see at
+3 minutes. There is no usable weight in between, because rain-rate
interpolation is dominated by the stronger source — the property that removed
the washout also makes the response sharply nonlinear.

Short-range observational fidelity is worth more than a livelier animation.

## HRRR run selection

NCEP writes `wrfsubh` files progressively: `f01` covers forecast minutes 15–60,
`f02` covers 75–120, and so on, up to `f04` at +240. A run is normally
discovered ~55 minutes after its init hour.

Selecting a run because `f01` exists opened a window every hour where the
service held a run it could not forecast from — HRRR samples vanished, every
blend fell back to weight 0, and the manifest silently collapsed to
nowcast-only truncated at +45. `selectRun(now, horizon)` therefore requires the
file covering the far end of the horizon, and falls back an hour otherwise.

Note the ceiling: a run older than ~165 minutes cannot serve a 75-minute
horizon at all, because that needs forecast minute 240+.

## Motion estimation resolution

Motion is recovered by searching for the integer pixel shift that best aligns
two echo masks over CONUS, so a realistic storm must move more than one pixel
over the lookback window.

At 320×160 a CONUS pixel is ~20.5 km, so a 40 km/h storm covers ~1.3 px in 40
minutes — at the noise floor. Against live MRMS this returned exactly
`u=0, v=0`, and the nowcast degraded into a frozen copy of the last
observation while still looking plausible. At 640×320 (~10.3 km/px) the same
motion spans 2–3 px. `server/scripts/motion.test.ts` pins the requirement.

## Sampling

Advection samples bilinearly on dBZ (not on colour — interpolated colour lands
between palette entries and invents reflectivities). Per-frame advection is
well under a pixel at typical zooms, and nearest-neighbour rounding made edge
pixels flip between neighbouring samples, so precipitation shimmered instead of
translating. Bilinear reduced frame-to-frame change 25–29% and
motion-compensated residual 18–29% across four regions.

## Diagnostics

- `X-Radar-Tile`, `X-Radar-Sampling`, `X-Radar-Blend-Mode`, `X-Radar-Weight`
- `Server-Timing: grid;dur=…, render;dur=…, total;dur=…`
- Blend metadata on every blended frame (`mode`, weights, provider ids)
- `npm run test` / `smoke` / `verify` / `preview` / `bench-transition` in `server/`

Blended tile URLs carry `mode` explicitly. They are served `immutable`, so the
URL must fully determine the bytes — a mode resolved from a server-side default
would let a future change reinterpret entries already in the CDN.

---

# Future work: short-range precipitation evolution nowcasting

Investigate whether a dedicated radar-nowcasting approach can model, within the
first ~15–30 minutes:

- translation
- growth and decay
- initiation and dissipation where appropriate
- uncertainty increasing with lead time

pySTEPS is one candidate. **The architecture is not committed to it.** Any
candidate plugs in as a `FutureRadarProvider` and is evaluated against the
current MRMS advection baseline using the same quantitative and visual method
used here: per-frame and motion-compensated change, echo footprint, mean/max
dBZ, ≥35 and ≥45 core counts, non-coincident feature survival at 50/50, and
side-by-side animation review.

**Hard requirement:** a future solution must improve the first 15–30 minutes
*without* letting an older numerical weather model overwrite the freshest
observed radar state. Reproducing the observation more slowly, or manufacturing
evolution by importing model fields, does not count as an improvement.

Related but explicitly out of scope until this is settled: phase correction of
HRRR against MRMS (measured to recover only ~3% IoU, since the disagreement is
structural rather than translational), and any generalized blend exponent.
