# Transitions (as implemented)

Source: `frontend/src/engine/transitions.ts` (per-kind rules), `stagger.ts` (plans), `core.ts`
(application). Flavors (stiffness, damping): standard (170, 22), soft (110, 19), snappy (260, 29),
fall (55, 7), reveal (90, critical). Alpha, colour and reveal are always critically damped. Final
poses come from the destination layout (including meaningful parking). "Start" poses are applied
only to pieces that are currently invisible, so nothing visibly jumps. Via poses switch to the final
pose at 70 % of the distance or after `viaMaxMs` (default 260 ms), and are dropped on interruption.

Delay of a piece = min(group rank x rate, max total) + kind offset (+ per-piece extra).

## 1 -> 2 "fan out and line up" (by trial, 8 ms)
| kind | flavor | offset (ms) | via / start |
|---|---|---|---|
| ribbon | soft | 0 | via: same stack position, rotation (rank - median) x 0.1 deg, clamped +-5 deg |
| env | standard | 180 | start: in its band, scaleY 0, alpha 0 |
| strip | standard | 150 | start: at the band edge, alpha 0 |
| dot | standard | 400 + 3 per trial (no trial stagger) | start: bottom-right corner, scale 0 |
| decor axis / cue / zone / frame / minimap | reveal / reveal / reveal / standard / reveal | 0 / 200 / 250 / 300 / 350 | axis, cue start reveal 0; frame start scaleY 0, alpha 0 (handles fade in with the frame) |
| decor droptext | snappy | 0 | - |

## 2 -> 3 "peel off and land on the head" (by channel, posterior to anterior, 30 ms)
| kind | flavor | offset | via / start |
|---|---|---|---|
| page-2 decor, dot, env | snappy | 0, no stagger | dots park at the mini-plot corner |
| ribbon | soft | 0 | via: up 16 px, alpha 0.5; final: electrode position, scale 0, alpha 0 |
| strip | soft | 0 | final: electrode position, alpha 0 |
| electrode | standard | 220 | start: final position, scale 0 |
| spark | standard | 300 | start: scaleX 0, alpha 0 (anchored left) |
| head / scalp / cap / nose, ears / mesh / heat / links, legend / tray | reveal (nose, ears standard) | 150 / 300 / 400 / 450 / 520 / 600 / 700 / 450 | head and cap drawn clockwise from the top |

## 3 -> 4 "merge, prism, split into sines" (by channel 12 ms)
| kind | flavor | offset | via / start |
|---|---|---|---|
| electrode, page-3 decor | snappy | 0 | - |
| spark (included) | soft | 0 | via: 60 % stage width, rows 14 px apart (compressed to fit), alpha 1; final: prism entrance, alpha 0 |
| prism | reveal | 260 | via: reveal 1, alpha 1, `viaMinHoldMs` 400; final alpha 0 |
| sine | soft (scale props: standard) | 520 + 6 per bin, no channel stagger | start: prism exit, scaleY 0 |
| axes / bands / fill / gate, handles, wavepanel | reveal | 600 / 750 / 850 / 900 | axes start reveal 0 |
| wave raw, filtered | standard | 950 | start: scaleY 0 |

## 4 -> 5 "the raised band splits into the cards" (by card, 60 ms, max 700)
| kind | flavor | offset | via / start |
|---|---|---|---|
| sine outside the band | snappy | 0 | final: flatten in place |
| sine inside the band | soft | 0 | via: up 36 px, alpha 1; final: card slot (bar i -> visible card i mod n), scale 0 |
| page-4 decor, waves | snappy | 0 | - |
| card | soft | 120 + rank x 60 | start: centre of the lifted band, scale 0.3, alpha 0 |
| basket / odometer | standard / reveal | 400 / 600 | basket starts 80 px to the right, alpha 0 |

## 5 -> 6 "the list slides away, the basket tips out" (by feature 40 ms, then trial 3 ms)
| kind | flavor | offset | via / start |
|---|---|---|---|
| card not in basket | soft | card rank x 40 | final: slid off the left edge in formation |
| card in basket (chip) | snappy | 150, no stagger | shrinks inside the basket |
| basket | standard | 80 | via: scale 1.22 (swells), held 520 ms; final alpha 0 |
| odometer | snappy | 0 | - |
| val | fall | 380 | via: drop 10 px inside the basket, alpha 0.9, scale 0.5; final: histogram grain (inspected feature) or baseline, scale 0 |
| histaxis / guides / meanticks / ghost | reveal | 450 / 650 / 800 / 0 | histaxis start reveal 0 |

## 6 -> 7 "piles collapse into rows" (by trial 4 ms)
| kind | flavor | offset | via / start |
|---|---|---|---|
| val of the inspected feature | soft | 0 | colour springs to the heat value |
| val of other features | standard | 150 + 6 per column | start: own cell, scale 0 |
| page-6 decor | snappy | 0 | - |
| rowstrip / colheads / brackets | reveal | 300 / 350 / 500 | rowstrip, brackets start reveal 0 |
| gauge / race / leak / views | standard | 450 / 550 / 650 / 450 | start 24 px to the right, alpha 0 |

## 7 -> 8 "rows dissolve into the chips" (by trial 3 ms, max 500)
| kind | flavor | offset | via / start |
|---|---|---|---|
| val | soft | 0 | via: row centre, scaleX 0.1, alpha 0.8; final: chip (trial rank mod 8), scale 0 |
| page-7 decor | snappy | 0 | - |
| chip | standard | 260 + 70 x page index | start: matrix centre, scale 0.2, alpha 0 |
| codepanel | reveal | 700 | start reveal 0 |
| phase `chips-in-panel` (400 ms after the chips settle) | soft | 120 x page index | chips fly into the code panel; typing starts when the last arrives |

## Backward and non-adjacent
Backward (B < A) uses the definition of (B, A): stagger order reversed, kind offsets mirrored
(max offset - offset), flavor soft for every piece, no via and no start poses, camera tilt reversed.
Non-adjacent: flavor soft, class-then-trial stagger 4 ms (max 500), leaving pieces snappy at 0,
entering decor at 300 ms. In-page changes: snappy, no stagger, no via, no camera. Reduced motion:
stiffness 400 / damping 40, no delays, no via, no camera, no ambient drift.

## Measured settle times
Motor-imagery sample, Chromium (headless, 1440 x 900), ambient motion paused. *Visual* = every visible
piece within 1 px of its layout target and the camera within 0.3 % of rest; *full* = every spring settled
(velocity < 0.01 for 10 substeps, including the slow k = 40 camera spring).

| transition | visual (ms) | full settle (ms) |
|---|---|---|
| 1->2 | 1116 | 2407 |
| 2->3 | 1139 | 2427 |
| 3->4 | 1221 | 2475 |
| 4->5 | 1372 | 2486 |
| 5->6 | 1266 | 2345 |
| 6->7 | 1252 | 2287 |
| 7->8 | 1147 | 3884 |
| 8->7 | 1050 | 2314 |
| 7->6 | 1357 | 2439 |
| 6->5 | 1244 | 2476 |
| 5->4 | 1123 | 2412 |
| 4->3 | 1103 | 2313 |
| 3->2 | 1446 | 2721 |
| 2->1 | 2388 | 2407 |
| 1->6 | 1227 | 2134 |
| 6->2 | 1070 | 2131 |

7 -> 8 full settle includes the `chips-in-panel` phase (400 ms wait plus the chip flight). Backward 2 -> 1
is the one move above the ~1.8 s budget (the reversed trial stagger of the 100-trial stack is clamped at
700 ms; mirrored kind offsets are already halved). Frame rate on the default dataset with ambient motion on:
60 fps (requestAnimationFrame rate), so the 40-trial fallback is not triggered.

