import { windowControls } from '@/api/platform'

// The chosen theme lives in the backend settings, which have not loaded yet, so
// the first paint follows the OS and useSettings corrects it once they arrive.
const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.classList.toggle('dark', dark)
// Sync native window background as early as possible, before the app renders.
void windowControls.setAppearance(dark).catch(() => {})
