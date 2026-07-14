const theme = localStorage.getItem('rocket-leaf-theme')
const dark =
  theme === 'dark' ||
  (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
document.documentElement.classList.toggle('dark', dark)
