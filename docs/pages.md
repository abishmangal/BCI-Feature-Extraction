# Pages

Every page is a pure function `layout(ctx)` in `frontend/src/layouts/pageN.ts` returning a target for
every piece and decor id (unused pieces get their default or page-specific parking). `ctx = {data,
paradigm, settings, ui, stageSize, backendResults, slots, page}`. Backend calls are made by
`frontend/src/store/effects.ts` (debounced 120 ms, 60 ms for the band filter, cancelled with
AbortController, cached by a hash of the request body).

| page | layout | piece groups used | stagger plan (entering) | backend calls | settings keys |
|---|---|---|---|---|---|
| 1 Load data | `page1.ts` (`p1Stack`) | ribbon (flat line when empty, trial stack when loaded), decor `droptext`, rail | load: by trial 8 ms (pour: fall, CSV: draw-on then soft, replace: lift then pour) | `/paradigms`, `/dataset/synthetic`, `/dataset/upload`, `/dataset/upload-npz`, `/dataset/interpret`, `/dataset/montage` | `paradigm`, `montage`, `timing` (CSV form) |
| 2 Time window | `page2.ts` (`p2Geo`) | ribbon (alpha 0.05 in the band), env, strip (4 px outside-window strips), dot (probe scatter), decor `axis cue zone frame minimap` | 1->2: by trial 8 ms | `/window` | `window`, `probe` |
| 3 Channels | `page3.ts` (`p3Geo`) | electrode (only the dataset's channels, tray chips for unpositioned), spark, decor `head nose ears cap mesh scalp heat links legend tray`; ribbons and strips park on their electrode | 2->3: by channel posterior to anterior 30 ms | `/channels` | `channels`, `map`, `showClasses` |
| 4 Frequency band | `page4.ts` (`p4Geo`) | sine (0.5 Hz bars), wave raw / filtered, decor `axes bands gate fill handles wavepanel prism`; sparks park at the prism entrance | 3->4: by channel 12 ms, sine +6 ms per bin | `/band` | `band`, `showClasses`, `baselineVisible`, `showAllBands`, `exampleTrial`, `exampleChannel` |
| 5 Choose features | `page5.ts` (`p5Geo`) | card (grid or basket chip), val (basket tiles), decor `basket odometer`; in-band sines park at card slots | 4->5: by card 60 ms (max 700) | `/features`, `/feature-preview`, `/autoencoder/*` | `features`, `featureSettings` |
| 6 Transform | `page6.ts` (`p6Geo`) | val (40-bin grain histogram of the inspected feature), decor `histaxis guides ghost meanticks` | 5->6: by feature 40 ms then trial 3 ms | `/features`, `/transform` | `transform`, `normalise`, `inspectFeature` |
| 7 Feature matrix | `page7.ts` (`p7Geo`) | val (matrix cells, or one dot per trial in scatter / PCA / t-SNE), wave filtered (hovered row), decor `rowstrip colheads brackets gauge race leak views` | 6->7: by trial 4 ms | `/features`, `/evaluate` | `classifier`, `cvFolds`, `leakageGuard`, `selectionSettings`, `view`, `xFeature`, `yFeature`, `showPreSelection` |
| 8 Export | `page8.ts` (`p8Geo`) | chip (left column, then into the code panel), decor `codepanel`; val pieces dissolve into chips | 7->8: by trial 3 ms (max 500) | `/evaluate`, `/export`, `/export/features.csv`, `/export/features.npz` | `exportMode` |

Ephemeral `ui` state (not hashed): `scrollY`, `categoryFilter`, `search`, `columnOffset`,
`exportPhase`, `reduceMotion`, `ambientPaused`, `focusChannel`, `hoverTrial`, `hoverRow`,
`draggingWindow`, `panelOpen`, `loadAnim`, `leakFlipped`, `focusFamily`.

The pipeline rail (`rail:1..8`) is laid out by `common.ts` on every page; its shapes for pages 2-4 are
computed from the data's own time vector so they update immediately; pages 5-7 use the backend shapes.
