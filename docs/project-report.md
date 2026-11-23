# BCI Feature Extraction project report

This report covers the changes from the original project snapshot at `4ad8274` to the final application at `e564dfc`, tagged `final`. That range contains 30 commits. The project repository is [abishmangal/BCI-Feature-Extraction](https://github.com/abishmangal/BCI-Feature-Extraction).

## Starting point

The base code already had a Vite, React, and PixiJS frontend and a FastAPI backend. Its eight-page pipeline could load epoched EEG data, select a time window and electrodes, filter a frequency band, extract and transform features, evaluate a classifier, and export the result. The three bundled examples were Motor Imagery, P300/ERP, and SSVEP.

We initialized Git and saved the original project as a rollback point. The baseline included the source, dependency files, downloadable sample CSVs, and offline sample results. Installed dependencies, virtual environments, build output, test reports, caches, and local environment files were excluded through `.gitignore`.

## Changes by page

| Page | Changes from the baseline |
|---|---|
| **1 · Load data** | Added a dataset summary in the main area and made the waveform stack easier to identify with a title and time endpoints. Pages 2–8 now redirect to Load data when opened without a dataset. Loading a dataset enables navigation and lets the existing pipeline use its default features until the user makes a selection. |
| **2 · Time window** | Replaced the sidebar with a two-row workspace. The draggable waveform sits beside its time settings, and a larger separability plot sits beside three control blocks for class comparison, the X feature, and the Y feature. The probe controls appear when the chart enters, using the same fade as the rest of the app. |
| **3 · Channels** | Repositioned and resized the head map. Enlarged the controls and split them into four cards around it. Presets and regions now add electrodes cumulatively, and a second click on a fully selected region removes its members. Clear resets the selection. Hovering or focusing an electrode opens its waveform beside it, with actual time bounds and clickable class legend entries that affect the preview only. |
| **4 · Frequency band** | Placed Band-pass and Display beside the spectrum and a compact Example waveform card beside the raw and filtered traces. The cards and plots share layout coordinates so their edges align on desktop. Moved the power spectral density label to the left axis to clear the band handles and added waveform time endpoints. |
| **5 · Choose features** | Replaced the fixed oversized cards with a grid that fits the available space. The reference desktop view fits 12 cards in four columns and three rows. Sharpened card text and capped inline hover expansion at 150% width. Feature formulas and units now use readable mathematical notation. |
| **6 · Transform and normalize** | Replaced the sidebar with separate cards for Feature to inspect, Transform, Normalise, and Numbers. The cards occupy their own area beside the histogram or below it on narrow screens. Improved the histogram labels and rendered the signed-log equation as MathML. |
| **7 · Feature matrix** | Moved the controls into a horizontal row of cards beside a wrapped heading and description. Widened the matrix and gave the accuracy meter, Feature race, and leakage check a dedicated right column. Made the view tabs larger with a teal active state. Rendered the Fisher score as MathML. |
| **8 · Export** | Made the code viewport follow the export card when the window or sidebar changes size. The horizontal scrollbar now sits along the bottom of the card, and the exported script can be scrolled with the keyboard. |

Graph titles, axis labels, tick values, and legends were enlarged across the pipeline. Dense axes show fewer tick labels when the available width would otherwise cause them to overlap.

## Changes to the data flow

- **Class separability.** The Time window page now sends the selected class IDs to the backend. The backend validates that at least two distinct classes are selected and computes stratified, cross-validated LDA accuracy and the majority-class chance baseline on that subset. The plot filters the same classes. Trial-indexed coordinates are preserved so the frontend can still match points to their original trials.
- **Electrode preview timing.** The Channels response now includes the applied start and end times. The preview uses those bounds for the class-average traces. Its class legend changes which traces are drawn without changing the electrodes or classes used elsewhere in the pipeline.
- **Math rendering.** Equations are written as native MathML. The main calculations and export formats remain those of the original pipeline.

## Verification

| Check | Result |
|---|---|
| Frontend type checking and unit tests | Passed. The final application had **28 passing frontend unit tests**, including coverage for the navigation guard, card sizing, and MathML markup. |
| Backend evaluation and HTTP checks | **20 tests passed** in the evaluation and HTTP run after class filtering was added. The three HTTP smoke tests also passed after applied window times were added to the Channels endpoint. |
| Live class-comparison check | On SSVEP, comparing all four balanced classes gave a **25%** chance baseline. Selecting two classes gave **50%**. |
| Frontend production build | Passed. Vite reported a bundle-size warning, and the build produced the `dist` directory. |
| Browser end-to-end suite | Regression cases were added for navigation, electrode selection, formulas, and export resizing. A local Playwright run could not launch because its Chromium executable was missing, so this report records no complete browser-suite pass. |

## Packaging and deployment

The final application commit was pushed to `main` and tagged locally as `final`. It includes the three sample CSVs in `sample/` and their browser-download copies in `frontend/public/sample/`. The offline bundles in `frontend/public/fallback/` let the frontend demonstrate the built-in samples without a backend.

The deployment used **Vercel for the Vite frontend** and **Render for the FastAPI backend**. Vercel builds from the `frontend` directory and serves `dist`. During deployment, a leading tab in the Output Directory setting caused Vercel to look for a different directory even though Vite had built successfully. Entering `dist` without whitespace resolved that configuration issue.

The deployment setup discussed for live computation uses `VITE_API_BASE=/api` and a Vercel rewrite from `/api/:path*` to the Render service. The tagged application has no checked-in `vercel.json`, so its Git history does not capture the live Vercel routing settings.

Render started FastAPI from `backend` with one Uvicorn worker. Keeping one backend instance and worker lets successive requests access the same in-memory dataset registry. The backend exposes a health endpoint at `/health`. Its root path `/` has no handler, so the root requests shown in the deployment log returned 404 after successful startup. The project owner reported that the deployment was working. [Render health endpoint](https://bci-feature-extraction.onrender.com/health)

For local setup and data format details, see the [project README](../README.md). The pinned backend dependencies require **Python 3.12 or newer**. Use **Node 22.12 or newer** for the frontend and its tests.
