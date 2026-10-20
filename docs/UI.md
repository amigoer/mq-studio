# UI principles

How MQ Studio's interface is built and how it should look. Read this before
adding a page, a dialog or a component. [中文](UI.zh-CN.md)

## One library per concern

| Concern | Use | Where |
| --- | --- | --- |
| Components | [shadcn/ui](https://ui.shadcn.com), style **Nova** (`radix-nova`) | `frontend/src/components/ui` |
| Icons | [Lucide](https://lucide.dev) (`lucide-react`) | everywhere |
| Animation | [Motion](https://motion.dev) (`motion/react`) | enter, exit and layout changes |
| Resizable layout | [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) via shadcn `Resizable` | split views, the assistant dock |
| Drag and drop | [dnd-kit](https://dndkit.com) | anything the user reorders by dragging |
| Shared state | [Zustand](https://zustand.docs.pmnd.rs) | state that outlives a component and is not a provider's |
| Charts | Recharts via shadcn `Chart` | time series, distributions |
| Toasts / command palette | sonner / cmdk, both through shadcn | — |

**Never build your own version of what one of these already expresses
correctly.** A dropdown, a tooltip, a resizable split, an exit animation or a
sortable list written by hand costs more to keep working than it saved. Write
your own only when no listed library can express the need, and say why in a
comment where you do.

Exceptions, each for a reason:

- **Brand marks** (protocol logos, GitHub, OS logos) come from `react-icons`
  (Simple Icons, Font Awesome brands): Lucide ships no brand icons.
- **The detail sheet** (`DetailPanel`) is not the shadcn `Sheet`: it is
  non-modal and docked beside the list, so clicking another row retargets it.
  It still animates through Motion.
- **The message body editor** is a textarea over a highlighted copy; no
  listed library edits text.

### Adding a shadcn component

Run `npx shadcn@latest add <name>` from `frontend/`. The CLI resolves the
`cn` helper to an npm package called `cn`; revert that change to
`package.json` and import `cn` from `@/lib/utils`. Keep the export list to
what the app uses (`tsc` runs with `noUnusedLocals`). Tune a primitive in
place; put anything app-specific in a composite under
`frontend/src/components`.

## Visual language

**Layers.** The title bar and sidebar sit on the chrome (`--c-chrome`); the
page is one white sheet laid on it (`.mqs-content`), with an 8px gutter and a
10px radius. Navigation lives on the chrome, content on the sheet.

**Colour.** A warm stone neutral scale drawn from the brand mark's paper and
ink, and one action colour, cobalt (`--c-primary`), for primary buttons, the
current page, the selected row, ticks, switches, links and the first chart
series. State colours (`--c-ok`, `--c-warn`, `--c-err`) mean state and nothing
else. Icon tiles take a hue from the `--c-tone-*` set, which avoids the state
hues. The brand red is the logo's alone. Every colour is a token in
`design/tokens.css` and has a dark value; never write a literal that only
works on one ground.

**Type.** The system UI face at a 13px root: body and tables 12.5px
(`text-sm`), labels and meta 11-11.5px, card titles 13px semibold, page titles
16px semibold. Figures are `tabular-nums`. Monospace is for identifiers only
(addresses, message ids, offsets, payloads); names of topics, groups and
queues are set in the UI face and stay selectable.

**Density.** A desktop tool: controls are 26-29px tall, table rows about 34px,
cards 16px inside. Group with space and one hairline, not with boxes inside
boxes.

## Page patterns

- **Header and filter row.** `PageHeader` (title, subtitle, actions) followed
  by `Toolbar`; the rule sits under the toolbar, not between the two.
- **List with a detail sheet.** `ListArea` > `ListPane` + `DetailPanel`. The
  sheet sits beside the rows and the list gives up its width, so no column is
  hidden; on a narrow page it overlays instead.
- **Overview.** One ruled KPI card (`.mqs-kpis` + `StatTile` with an icon and
  tone), a chart with its legend in the card header, then the ranking tables
  side by side, each linking to its full page.
- **Collections of objects** a person recognises by name (connections) are a
  card grid with a list view beside it; a collection of rows to scan and
  compare (topics, groups, messages) is a table.
- **Dialogs** stack each label above a full-width control and share one left
  and right edge with the title and the footer buttons.
- **Destructive actions** use `variant="destructive"`, Nova's soft red, both
  on the button that asks and on the one that confirms; the confirmation
  dialog is the safeguard, not a louder colour.

## Motion

Use Motion for anything that enters, leaves or changes layout:
`AnimatePresence` for exits, `motion.*` for enters, `layout` for reflow. Keep
it short (120-280ms, the `--mo-*` durations) and decelerating on the way in.
CSS transitions are fine for a colour or a border under the cursor. The
"界面过渡动画" setting turns every animation off through `MotionConfig`.
