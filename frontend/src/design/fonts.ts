// Self-hosted fonts through @fontsource (no CDN), so the app works offline.
import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

export async function fontsReady(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load('10px "JetBrains Mono"'),
      document.fonts.load('15px "Inter"'),
      document.fonts.load('28px "Fraunces"'),
    ]);
  } catch {
    /* fall back to system fonts */
  }
}
