import { windowControls } from '@/api/platform'

const theme = localStorage.getItem('rocket-leaf-theme')
const dark =
  theme === 'dark' ||
  (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
document.documentElement.classList.toggle('dark', dark)
// Sync native window background as early as possible, before the app renders.
void windowControls.setAppearance(dark).catch(() => {})
