import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PROTOCOLS, PROTOCOL_ORDER, type ProtocolId } from "@/design/data/protocols";
import { ConnectionsEmpty, foldProtocols } from "./ConnectionsEmpty";

/*
 * The welcome page's family grid.
 *
 * It drew every family in one row, which outgrew the page's column well before
 * fifteen and wrapped each long name onto lines of its own. The grid is capped
 * now, so the one thing that can go wrong as drivers ship is a family silently
 * falling off it: each has to be drawn by name or counted in the last cell.
 */

const families = (n: number): ProtocolId[] =>
  Array.from({ length: n }, (_, i) => PROTOCOL_ORDER[i % PROTOCOL_ORDER.length]!);

describe("folding the family grid", () => {
  it("draws every family while they fit", () => {
    expect(foldProtocols(families(15), 15)).toEqual({ shown: families(15), folded: 0 });
    expect(foldProtocols(families(3), 15)).toEqual({ shown: families(3), folded: 0 });
  });

  it("gives up the last cell to the count once they do not", () => {
    // The count takes a cell of its own, so the first family over the cap
    // folds two.
    const { shown, folded } = foldProtocols(families(16), 15);
    expect(shown).toHaveLength(14);
    expect(folded).toBe(2);
  });

  it("keeps the grid the same size however many there are", () => {
    for (const n of [16, 30, 100]) {
      const { shown, folded } = foldProtocols(families(n), 15);
      expect(shown.length + 1).toBe(15);
      expect(shown.length + folded).toBe(n);
    }
  });
});

describe("the welcome page", () => {
  it("accounts for every family there is, by name or in the count", () => {
    const html = renderToStaticMarkup(<ConnectionsEmpty />);
    const named = PROTOCOL_ORDER.filter((p) => html.includes(`title="${PROTOCOLS[p].name}"`));
    const folded = Number(/>\+(\d+)</.exec(html)?.[1] ?? 0);
    expect(named.length + folded).toBe(PROTOCOL_ORDER.length);
  });
});
