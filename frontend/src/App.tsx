import type { JSX } from "react";
import { DesignApp } from "@/design/DesignApp";

/**
 * The frontend is the design canvas (mq-studio-design.dc.html) rebuilt one to
 * one. The control plane -- settings, window chrome, update checks -- is wired
 * to Go; the figures on the MQ pages still come from `@/design/data`, waiting
 * to be wired back page by page.
 */
function App(): JSX.Element {
  return <DesignApp />;
}

export default App;
