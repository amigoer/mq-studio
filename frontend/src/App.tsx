import type { JSX } from "react";
import { DesignApp } from "@/design/DesignApp";

/**
 * The frontend is the design canvas (mq-studio-design.dc.html) rebuilt one to
 * one. The control plane and every RocketMQ page read Go; the boards for the
 * five families without a driver still draw the canvas's own figures, and are
 * unreachable because those protocols cannot be selected.
 */
function App(): JSX.Element {
  return <DesignApp />;
}

export default App;
