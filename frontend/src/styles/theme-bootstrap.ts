/*
 * Loaded from index.html ahead of the bundle: the window opens on the theme the
 * last session chose rather than flashing the default and correcting itself.
 */
import { applyTheme, readCachedTheme } from "@/lib/theme";

applyTheme(readCachedTheme());
