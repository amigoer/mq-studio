# MQ Studio

The theme of the MQ Studio website, for [Kite](https://github.com/kite-plus/kite).

It is [Vane](https://github.com/kite-plus/theme-vane) 1.0.1, the documentation
theme for Kite, under the Apache License 2.0 (`LICENSE`), changed as follows:

- Redrawn in MQ Studio's look: neutral surfaces mixed from the foreground,
  sans-serif headings, the brand red for small headings, and the Geist fonts
  (SIL Open Font License 1.1, `static/mq-studio/fonts/OFL.txt`). The paper,
  the grain, the serif and the kite in the sky are gone.
- A new home page: the download button that finds the reader's build, two
  windows of the app, the brokers, the features, a tour of screenshots, the
  latest releases, a download card per platform and the closing cards.
- Layouts for two kinds of content the site declares: `doc`, beside the docs
  tree, and `release`, beside the list of releases.
- A language switch and hreflang links for a site built twice, Chinese at the
  root and English under `/en/`.
- The words the pages say in `i18n/en.yaml` and `i18n/zh-CN.yaml`, through `T`.

It reads its data from `site.params`, which the site's build writes:
`release`, `releases`, `community`, `shot`, `root`, `origin` and `asset`.
