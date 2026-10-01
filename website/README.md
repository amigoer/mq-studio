# The website

<https://mq-studio.amigoer.com>, built with [Kite](https://github.com/kite-plus/kite):
Chinese at `/`, English under `/en/`.

Kite builds one language per site, so there are two, and `scripts/build.mjs`
merges them. Nothing a reader sees is copied into this folder: the docs pages
are the repo's own `docs/*.md`, the changelog is `CHANGELOG.md` and
`CHANGELOG.zh-CN.md` split into a page per release, and the screenshots are
`docs/images/readme/*.png`.

| Path | What it holds |
| --- | --- |
| `sites/zh/kite.yaml`, `sites/en/kite.yaml` | Each language's site: its address, menus, docs tree and every line of the home page |
| `themes/mq-studio/` | The theme, after [Vane](https://github.com/kite-plus/theme-vane) 1.0.1 |
| `static/` | Files published at the root: icons, `robots.txt`, `_headers`, `_redirects` |
| `data/` | The release and community data, refreshed by `../scripts/fetch-*.mjs` |
| `scripts/` | The build, the dev server and the checks, with the content conversion in `lib/` |

## Commands

```bash
npm run dev         # build, serve http://localhost:4321, rebuild on change
npm run build       # refresh the release and community data, then build
npm run build:fast  # build from the committed data
npm run verify      # check website/dist
npm test
```

The build downloads the Kite release pinned in `scripts/lib/kite.mjs` and checks
it against that release's `checksums.txt`. `KITE_BIN` names a binary to use
instead. It writes `website/dist`, which Cloudflare serves as it is
(`wrangler.jsonc`).
