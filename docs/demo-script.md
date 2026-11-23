# Demo script

## Motor imagery, 3 minutes

1. **Page 1 (0:00).** Leave "Sample: Motor imagery" selected and click **Pour sample data**. The flat
   line lifts and the ribbons fall into the stack; the badge reads `100 x 22 x 750`. Hover a band:
   "Trial 12, left hand". Hover **About this paradigm (i)** to read the one physiological fact.
2. **Page 2 (0:20).** Click rail node 2 (or press 2). Ribbons fan out and line up by class. Point at
   the dashed "cue" line and the "typical imagery zone". The probe plot (C3 vs C4 mu power) shows two
   clouds; separability is about 88 %. Click **Before cue -0.5 to 0 s (control)**: the outside
   samples compress, the badge becomes `100 x 22 x 125`, and separability falls to near chance.
   Click **Imagery 0 to 2 s (default)** again. Drag the frame edges to show the live crop.
3. **Page 3 (0:50).** The ribbons peel off channel by channel, back of the head first, and land on
   the electrodes. The effect map (band-power change vs baseline, left hand) is hottest at C4.
   Switch **Map for** to "right hand": now C3. Click electrodes to include / exclude them, drag a
   marquee across the scalp, then click **Central ring** (13 channels) under "For Motor imagery".
4. **Page 4 (1:20).** The waveforms merge into the prism and split into spectrum bars. The class
   curves dip below the grey baseline curve in mu and beta (the gap is filled). Drag the band
   handles; the example filtered waveform morphs live. Click **Mu + beta 8-30 (default)**.
5. **Page 5 (1:45).** The raised band lifts off and becomes the cards. Click **CSP (spatial
   filters)**: it flies into the basket, the odometer rolls to the feature count and the note
   "fit inside cross-validation to avoid leakage" appears. In the drawer set components to 8.
6. **Page 6 (2:05).** The tiles tumble into a histogram of the top CSP feature. Click **z-score**:
   the pile slides to mean 0 with guides at -1, 0, +1; the ghost shows the before shape.
7. **Page 7 (2:20).** The piles collapse into the matrix. Read the gauge (about 68 % with Central
   ring and 8 components). Flip **Learned steps fitted on** to "all data (leaky)": both bars appear
   and the bracket reads "leaky fit changed accuracy by +19 points" (measured, not drawn). Flip it
   back. Click **Scatter (2 features)** to pull each row into one dot with the LDA boundary.
8. **Page 8 (2:45).** Rows dissolve into the eight settings chips, which fly into the code panel and
   the script types itself. Click **Download .py** and **Download feature matrix CSV**.

## P300, 1 minute

Page 1: choose "P300 (ERP)" and pour (`200 x 8 x 250`). Page 2: the "typical P300 zone"
(0.25-0.6 s); try **Early 0 to 0.25 s (control)** and watch separability drop. Page 3: set the map
metric to "Class separability of mean amplitude": it peaks at Pz / Cz. Page 5: the default feature
is "Windowed means" (recommended); open its drawer to see 50 ms bins with baseline correction.
Page 7: the gauge shows about 78 % (chance 50 %).

## SSVEP, 1 minute

Page 1: choose "SSVEP" and pour (`160 x 8 x 500`, four classes). Page 3: the SNR map for "8 Hz"
peaks at Oz. Page 4: ticks mark 8, 10, 12, 15 Hz and their second harmonics. Page 7: about 89 %
accuracy with chance at 25 %; open **PCA 2-D** to see four clouds, then **Scatter (2 features)**
for the 40 x 40 decision-region shading.
