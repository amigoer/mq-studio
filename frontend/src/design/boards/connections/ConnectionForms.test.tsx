import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The RocketMQ connection form, rendered.
 *
 * connectionDraft.test.ts covers the translation between the draft and what
 * ConnectionService stores, which is where the credentials rules live. What it
 * cannot see is whether a field is drawn at all: the advanced block held a
 * disabled placeholder for the namespace for as long as the driver had nowhere
 * to put one, and a disabled control reads exactly like a live one to every
 * test that only looks at the draft.
 *
 * Nothing here initialises i18n, so labels come back as their keys. That is
 * what is asserted on - whether the bundle resolves them is i18nCoverage's job.
 *
 * The import is dynamic because the component barrel reaches the Wails runtime
 * at module load, which wants a `window` this environment has to install first.
 */

const KEY = "page.connections.form.rocketmq";

let renderRocketMQForm: (namespace: string) => string;

beforeAll(async () => {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  vi.stubGlobal("window", {
    _wails: { environment: { OS: "darwin" } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: storage,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("localStorage", storage);

  const [{ renderToStaticMarkup }, forms] = await Promise.all([
    import("react-dom/server"),
    import("./ConnectionForms"),
  ]);

  renderRocketMQForm = (namespace: string) =>
    renderToStaticMarkup(
      <forms.RocketMQForm
        value={{ ...forms.emptyRocketMQDraft(), namespace }}
        onChange={() => {}}
      />,
    );
});

/** The markup of one field, from its hint to the end of that field's block. */
function fieldAfter(html: string, hintKey: string): string {
  const rest = html.split(hintKey)[1] ?? "";
  return rest.slice(0, rest.indexOf("</div>"));
}

describe("the RocketMQ connection form", () => {
  it("draws the namespace as a live field, not the placeholder it replaced", () => {
    const html = renderRocketMQForm("MQ_INST_1");

    const namespace = fieldAfter(html, `${KEY}.namespaceHint`);
    expect(namespace).toContain('value="MQ_INST_1"');
    // The attribute, not the substring: Tailwind's disabled: variants put the
    // word in every input's class list.
    expect(namespace).not.toContain('disabled=""');

    // The control this replaced, and proof the check above can tell the
    // difference: the two fields beside it are still placeholders.
    expect(html).not.toContain("instanceId");
    expect(fieldAfter(html, `${KEY}.traceTopic`)).toContain('disabled=""');
  });

  it("opens the advanced block by itself when a namespace is set", () => {
    // Otherwise editing a scoped connection would hide the very thing that
    // decides which topics it can see.
    expect(renderRocketMQForm("MQ_INST_1")).toContain(`${KEY}.namespace`);
    expect(renderRocketMQForm("")).not.toContain(`${KEY}.namespace`);
  });
});
