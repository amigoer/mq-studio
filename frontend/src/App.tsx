import type { JSX } from "react";
import { DesignApp } from "@/design/DesignApp";

/**
 * The frontend is the design canvas (mq-studio-design.dc.html) rebuilt one to
 * one. It is presentational: every figure comes from `@/design/data`, and the
 * Wails hooks under `@/hooks` and `@/api` are untouched, waiting to be wired
 * back page by page.
 */
function App(): JSX.Element {
  return <DesignApp />;
}

export default App;
