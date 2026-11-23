// Exact page titles and captions (section 4).
export const PAGE_TITLES = [
  'Load data',
  'Time window',
  'Channels',
  'Frequency band',
  'Choose features',
  'Transform and normalize',
  'Feature matrix',
  'Export',
];
export const CAPTIONS = [
  'Load your EEG recording: trials x channels x samples.',
  "Choose the time window where the brain's response lives.",
  'Choose which electrodes to keep. Different tasks live at different scalp sites.',
  'Keep only the frequency band that carries the effect.',
  'Pick how to turn each trial into numbers a classifier can use.',
  'Reshape the numbers so features are comparable and well-behaved.',
  'The final table the classifier sees: one row per trial, one column per feature.',
  'Your whole pipeline as a script you can run.',
];
