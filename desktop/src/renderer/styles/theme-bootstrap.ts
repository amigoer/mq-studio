const theme = localStorage.getItem('rocket-leaf-theme')
const dark =
  theme === 'dark' ||
  (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
document.documentElement.classList.toggle('dark', dark)
// Sync native window background as early as possible (preload bridge is already exposed).
void window.rocketLeaf?.window.setAppearance(dark).catch(() => {})
