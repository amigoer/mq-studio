/*
 * The design canvas is light-only, so the first paint is pinned to light
 * instead of following the OS. When dark mode comes back this reads the
 * setting again and re-enables `windowControls.setAppearance`.
 */
document.documentElement.classList.remove("dark");
