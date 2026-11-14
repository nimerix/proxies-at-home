# Bleed reconstruction review

Scope: upright, tightly cropped 63 × 88 mm card scans, square digital artwork,
and 69 × 94 mm MPC sources with supplied 3 mm bleed. Locating a card on a desk or
rectifying a photograph is outside the renderer's contract and explained in
the UI. Missing artwork is reconstructed, not recovered from ground truth.

## Resulting behavior

- A physical 2.5 mm rounded rectangle, eroded by the selected 0–1 mm shadow
  margin (default 0.25 mm), defines trusted scan artwork. Opaque scanner corners,
  shadows within that margin and alpha fringes cannot become source samples.
  The source corner radius can be set separately to 2.5–3.5 mm when an opaque
  source has a larger cutout. This controlled choice preserves legitimate
  uniform corner artwork that is indistinguishable from scanner-bed color.
- Repair happens in four native-resolution perimeter bands **before** resizing.
  Normal reflection continues nearby artwork through the excluded area. All
  bilinear donors must be originally opaque and geometrically trusted. Interior
  artwork retains its position and original rendering; only repair spans and
  their filter support are repainted. A soft curvature limit avoids corner
  magnification near the reflection center.
- The completed rectangle is reflected into bleed. Local border detection
  overrides synthesized bleed for black sections, including partial borders,
  and for white borders surrounding the entire card. A 0.2 mm outward transition
  matches the source's aged tone at the cut, then reaches canonical black/white.
  Original print dots and legitimate ink inside the trusted trim area remain.
- Black detection requires a continuous neutral band, not a single dark pixel.
  Fine white strokes veto black classification. Short corner runs need support
  from a neighboring border. Thin partial borders additionally need a nearly
  straight inner boundary; a full thin border can qualify by continuity along
  its entire edge. Accepted runs recover only the half-millimeter erosion from
  their confidence window, then taper over 1 mm outside the black region.
  Whole aged frames tolerate at most 3% missed windows and a 1.5 mm longest gap,
  so one tiny chip cannot disable black bleed on the whole card. Faded/warm
  partial borders need an ≥8 mm run and a stable inner color boundary, with
  0.2 mm of continuing artwork within the 3.5 mm search depth. Strict local
  color evidence remains conservative; repeated ink, sloping boundaries and
  short or deep dark artwork patches do not qualify through this added path.
  Near-black regions (maximum median channel 32 and chroma 15) qualify directly.
  Other strict dark runs need a bounded inner edge: either a straight 3.5 mm
  boundary, or at least half their neutral samples finding nearby artwork
  within the existing 4.5 mm native read band. The latter supports ragged legal
  text in faded footers while rejecting deep gray rock and navy skies.
  A neutral corner run from 2 to less than 8 mm within the measured straight
  profile can also use an independently accepted adjacent border of at least
  8 mm reaching the same corner. The profile excludes the first 3 mm at each
  corner; inference through that area, endpoint recovery and taper make the
  physical treatment longer than the measured run. Corner-only candidates
  cannot support one another or promote runs of 8 mm or more in that profile.
  Four edges with at least 90% strict neutral-black evidence can support their
  surviving runs through wear; that check does not fill actual damaged gaps.
  A median local color reference tolerates independent scan grain without
  treating blue, green or purple artwork as aged warm black. Colored full
  frames need consistent inner-frame evidence on all four edges.
  A failed confidence window spanning at most 1 mm can join a supported aged
  run only with continuous opaque warm/neutral evidence and matching inner
  depths. This avoids dropping a short border tail after one grain outlier.
- Front previews, custom backs and PDF export share source/margin/border settings.
  **Mirror all artwork** overrides automatic border detection. **Square artwork**
  preserves digital rectangular edges. Per-card overrides have a live preview;
  the preview follows the active front/back side and reports the detected edge
  treatments. Inherited choices show their current values. PDF deduplication
  includes every processing option. Settings persist, obsolete jobs are aborted
  and their results rejected, and canvases are released after use.
  A failed preview exposes its error and a retry action. When at least two matching
  borders corroborate outer shadows on the remaining edges, the card preview
  suggests a larger removal margin and offers an explicit apply button.
- MPC images skip scan repair and retain all supplied bleed; requests above
  3 mm extend only the additional ring. Regular zero-bleed output still repairs
  the scan perimeter. Original-image ZIPs keep original files.

## Fixtures and regression evidence

User inputs: Arasta of the Endless Web (MAR 32), Hit It! (TRK 476), Elas il-Kor
(SLD 2733), and Beta Fireball (LEB 150). A Revised Lightning Bolt (3ED 162) scan
adds a real white border; provenance is in tests/fixtures/README.md.

bleedArtwork.test.ts establishes independent circle geometry, poison-color
invariance, opacity, exact trusted-pixel preservation, rotation symmetry,
determinism, smooth gradients, native band equivalence and transparent fringes
inside the nominal arc. bleedBorders.test.ts covers aged/cream borders,
scratches, thin complete and partial borders, fine white ink, isolated dark
artwork, endpoint coverage, physical scale and all three cleanup margins.
Grain regressions cover nine warm/faded/neutral combinations at standard
deviations 3–6 across eight seeds, full warm/faded frames at deviation 6 and
near-neutral artwork consistency. An independent 900-case probe across
100 seeds passes; prior failing seeds remain explicit regressions. Negative
tests cover deep gray rock, navy skies, colored bands and uncorroborated shadows.

tests/bleed-rendering.spec.ts exercises the actual bundled renderer in Chromium
and WebKit. It covers odd dimensions, arbitrary aspect ratios, all four seams,
six synthetic artwork styles, source-mode behavior, real scans at 200/254/1200
DPI with margins 0/0.25/0.5 mm, and 0/2/5 mm bleed. Actual border checks require
black = 0 / white = 255 beyond the transition. Elas's top and side art to 80 mm
and Hit It's side art from 11–48 mm exactly match the Mirror rendering. Hit It's
upper side-border endpoints and a straight 0.8 mm partial border are explicit
regressions. Mixed black/art corner joins have zero channel discontinuity.
Additional adversarial tests cover speckled, faded and warm-cast full and partial
borders, full-depth scratches and chips, repeated/long ink vetoes,
opaque white/black 3.175 mm cutouts with the selected 3.2 mm source radius, and
0.8 mm shadows with 1 mm removal. An actual MPC Autofill Simple Lotus fixture
retains its complete supplied 3 mm image pixel for pixel when extended to 5 mm.
Real-fixture variants also raise dark pixels by 15/25/35 levels on Arasta,
Hit It and Elas; their black footers stay black along the bottom, both side
edges at 82–85 mm and every bottom-corner pixel beyond the 0.2 mm blend, while
protected exposed art remains identical to Mirror. Fireball variants combine 1/2 mm chips, two chip
tones and brightness lifts of 4/8/15: surviving black edges remain black.
The actual chip is not silently painted over. Confirmation samples can extend
beyond a 3.5 mm aged boundary, so frames at 3.3 and 3.5 mm have explicit tests.

Arasta's trusted interior at 1200 DPI is identical to a direct source rendering
in both engines. At 300 DPI WebKit is identical; Chromium differs in isolated
samples by at most 2/255 (mean channel error approximately 0.000011). All four
rectangular bleed seams have zero channel discontinuity. These comparisons
exclude the configured repair footprint and its resampling support.

tests/workspace.spec.ts checks actual preview and embedded PDF pixels for every
real fixture, front/custom-back shadow controls, Auto/Mirror invalidation and
persistence, active-back per-card preview updates, inherited values and detected
edge feedback, regular output at 600/900/1200 DPI, and MPC output at 0/1/2/3/3.5/5 mm.
Real Arasta/Fireball artwork with adversarial opaque noise substituted only in
the excluded rim/corners produces exactly the same output as the source scan.
The supplied PNGs contain transparent or partial-alpha outer corners and real
scan rims. Opaque scanner-bed evidence comes from controlled adversarial
variants, not an independently captured opaque-bed scan. This establishes
exclusion inside the selected geometric mask, not automatic discovery of an
unknown physical card outline.

tests/bleed-worker.spec.ts compares every pixel of all six real fixtures at
200 and 1200 DPI between the worker and original canvas renderer: **zero changed
channels in both browsers**. It also verifies one source decode, no worker
source decode, release of the original URL before dispatch, transferred bitmap
and canvas cleanup before replies, concurrent request isolation, active/queued
cancellation, idle expiry, timeout/error recovery, invalid inputs and capability
fallbacks that reuse the fetched source. SVG inputs use native band rasters
without needing image-crop support. For a 6000 × 8381 input, each band is below 10% of native pixel
area and their sum is below one third; preparation canvases stay below
16,777,216 pixels.

Final integrated checks on the current implementation: **146 client tests,
8 server tests, 132 Chromium/WebKit tests, ESLint, TypeScript and both builds
pass**. `git diff --check` passes. Local logs and source/test SHA-256 hashes are
in .artifacts/bleed/final-verification.json and the adjacent *-final.log files.

## Performance and limits

Four native bands avoid a giant full-resolution working canvas. A 6000 × 8381
input renders and JPEG-encodes at 1200 DPI under an enforced 16,777,216-pixel
per-canvas limit in both engines. Tests abort during repair and verify that every
created canvas is released. Scan loops yield in approximately 8 ms slices; image
decoding is awaited before drawing.
All preview and PDF render jobs share a queue before decoding, while downloads
remain concurrent. A three-upload test with 24.6-megapixel images confirms one
active render at a time, UI timer progress and reuse of one worker. A healthy
worker expires after 30 seconds idle; aborts, errors and timeouts discard it.

Preview and PDF processing use the same worker path. Only original-image
resizing stays on the UI thread: ImageBitmap resizing uses a different browser
filter, so this preparation step preserves pixel identity. Four cropped native
perimeter bitmaps and the resized interior go to the worker for repair, border
analysis, bleed painting and encoding. The original image and its object URL
are released before dispatch. The worker never decodes a second full source.
Each band is rasterized on a small canvas before bitmap creation, avoiding
browsers that snapshot the full source for each image crop. Preparation yields
between bands so input and cancellation can progress.
MPC images at or below 3 mm bleed and Square/Mirror inputs need no bands.
Unsupported or blocked workers use the cooperative canvas fallback and reuse
the fetched blob. Transferred bitmaps and canvas backing stores are released
before the worker replies; queued cancellation removes a job before decoding.

.artifacts/bleed/performance-worker.json records three local samples per browser,
source width (744/4000/6000), and output DPI (200/600/1200), including JPEG encoding,
UI timer gaps and worker canvas allocations. Its provenance file records source
hashes and measurement time. The earlier performance.json describes the canvas
fallback before the final worker implementation and is historical evidence.

Median of three local samples, including encoding (ms). Timer gap is the largest
UI timer interval within each sample, then median across the samples:

| Browser / input | 200 DPI total / UI gap | 600 DPI total / UI gap | 1200 DPI total / UI gap |
| --- | ---: | ---: | ---: |
| Chromium / 744 px | 29.9 / 5.2 | 50.5 / 10.8 | 127.8 / 32.1 |
| WebKit / 744 px | 35 / 9 | 44 / 10 | 82 / 12 |
| Chromium / 6000 px | 287.7 / 66.5 | 308.3 / 78.2 | 385.9 / 102.8 |
| WebKit / 6000 px | 489 / 103 | 477 / 104 | 527 / 103 |

An intermediate direct-image-crop transport had 190–261 ms UI gaps for the
largest input. Small canvas bands plus a yield between copies reduced them to
67–104 ms while keeping one source decode. Worker canvas backing peaks near
20 MiB for large-input previews and 123 MiB at 1200 DPI, excluding transferred
bitmaps and browser allocations.

Canvas accounting is **not** total process/GPU memory. A decoded 6000 × 8381
source alone may use about 192 MiB, plus cropped bands, resized interior pixels,
readback, encoder and browser overhead. The largest output is 15.96 megapixels. Decoding
and the original-image resize may still pause the UI briefly; workers do not
make those browser operations interruptible. Timings depend on browser,
hardware, decode cache and load.
Physical printer registration, color and cutting have not been validated.
Firefox was installed and attempted, but its process exits before loading a
page with "Could not find profile folder" even with an existing explicit
profile. It is an optional `TEST_FIREFOX=1` project, not claimed coverage.
WebKit automation does not establish physical iOS memory behavior.

The scan mask assumes the stated physical geometry and tight crop. Shadows
deeper than the selected margin need a larger margin or better input. Automatic
border detection is a heuristic with an artwork-preserving override; it cannot
prove whether an arbitrary dark design is a printed border. Reflections may
repeat text/texture in missing areas. These are explicit limits, not claims of
perfect reconstruction for every possible image.
In particular, a short neutral-gray artwork patch beside a confirmed black
corner can receive black bleed. The reviewers reproduced this outside trim;
it does not repaint the original card face. Use Mirror for artwork with this
ambiguity. Corner run lengths refer to the measured straight profile, not the
complete physical extent including corner inference and endpoint taper.
A plain faded footer deeper than 4.5 mm, without text or other inner-edge
evidence, can remain mirrored. Reflection is continuous for that uniform area;
automatic black treatment requires the documented supporting border evidence.

## Review iterations

Two independently delegated **Claude Opus 5.5** reviewers and one **Astra** reviewer
evaluate each full round. Scores are reviewer judgments against this scope, not
empirical success percentages. Every factor must reach 95; averages do not pass.

| Pass | Opus geometry minimum | Opus product minimum | Astra minimum | Main changes prompted |
| --- | ---: | ---: | ---: | --- |
| Baseline | 5 | 5 | 12 | Opaque shadows, wrong corner colors, global black guess, supplied bleed loss |
| First reconstruction | 70 | 66 | 85 | Repair before resizing, alpha fringes, exact interior preservation, native bands and cancellation |
| Expanded border fixtures | 70 | 70 | 82 | Partial/aged black and full white borders, monochrome protection, override, real PDF tests |
| Adversarial recheck | 78 | 92 | 95 | Identified aged/speckled frames, source-radius controls, per-card settings, memory and evidence gaps |
| Further edge cases | 89 | — | 92 | Chipped/faded partial borders, active-back preview, worker responsiveness, detection feedback and sample predicates |
| Noise and colored-art recheck | 89 | 90 | — | Scan-grain tolerance, colored-art preservation, shadow suggestions, preview retry and worker memory |
| Broader grain recheck | 94 | 93 | 94 | Isolated grain windows splitting border tails, deep gray/navy art, two-edge shadow hints and code organization |
| Real scan brightness recheck | 91 | 93 | 95 | Faded ragged footers, worn Beta frame support and full 3.5 mm boundary confirmation |
| Footer corner recheck | 95 | 94 | 94 | Lifted Arasta/Elas footer sides need independent adjacent-border support and corner-square assertions |
| Final recheck | 95 | 95 | 95 | All prior fixes plus both footer sides and complete outer corner bleed |

The final recheck independently reviewed the completed code. Earlier approvals
were superseded by later concrete reproductions and are not counted as final
consensus. Both exact Claude Opus 5.5 reviewers, Astra and the parent now score
every factor at least 95. Final factor scores:

| Factor | Opus geometry | Opus product | Astra | Parent |
| --- | ---: | ---: | ---: | ---: |
| Shadow/background exclusion | 96 | 96 | 96 | 97 |
| Artwork preservation | 95 | 95 | 97 | 98 |
| Corner/edge seamlessness | 96 | 96 | 96 | 96 |
| Bleed coverage/print geometry | 96 | 96 | 97 | 99 |
| Diverse visual quality | 95 | 95 | 96 | 96 |
| Performance/memory | 95 | 95 | 95 | 95 |
| UX/control clarity | 95 | 95 | 96 | 96 |
| Robustness/source compatibility | 95 | 95 | 95 | 96 |
| Test/evidence strength | 95 | 95 | 97 | 97 |
| Maintainability | 95 | 95 | 95 | 95 |

The geometry reviewer confirmed that the last correction changes only the
intended right-side bleed and corner regions on lifted Arasta/Elas, with the
original face and other edges unchanged. The product reviewer independently
reproduced closure on 15 real-image variants and checked fine ink, navy art,
unsupported corners and short runs. Both noted the disclosed neutral-gray
corner ambiguity and accepted it with the Mirror override.

Astra independently ran 121 focused tests, 30 grain cases, 56 artwork/ink/
opacity/depth cases and 15 real-image variants, then checked both browsers'
side/corner pixels and all 93 provenance hashes. The parent ran the full
146-client, 8-server and 132-browser suites, the 900-case grain matrix and the
fresh performance benchmark, and inspected the supplied-card outputs. All
reviewers found no remaining must-fix defect within the documented scope.

Full local written reports are in .artifacts/bleed/opus-round9-1.md,
opus-round9-2.md, astra-round9.md and parent-round9.md. These scores express
readiness within the supported workflow; they are not statistical guarantees
or evidence of physical printer, iOS or Firefox validation.

Local visual evidence includes .artifacts/bleed/arasta-corners.png,
{name}-5mm-{chromium,webkit}.png for the four border fixtures,
diversity-{chromium,webkit}.png, border-metrics-*.json, and preservation-*.json.
Tests recreate these ignored artifacts; regression fixtures and assertions
are tracked with the source.
