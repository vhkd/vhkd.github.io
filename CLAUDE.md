# Repository guidance

## Project

Chinese personal homepage and technical blog for Zhang Kai, served at https://zhangkai.me via GitHub Pages. The site uses static HTML, a small Node.js build script and the locked `marked` dependency. Do not introduce a frontend framework for routine edits.

## Sources and generated files

- All six articles are authored in `posts/*.md`, with single-line frontmatter fields. Edit Markdown, then run `npm run build`; `posts/*.html` are generated and checked in.
- Frontmatter requires `title`, `date`, `category` and `description`. Optional `updated` records an actual content revision. Optional unique positive `featured` ranks select at most three homepage articles.
- `index.html` and `blog.html` contain editable page structure. Preserve `posts:*:start/end` markers; article cards and archive JSON-LD inside them are generated from frontmatter.
- `assets/site.css` and `assets/theme.js` are shared by every page. Keep the theme script before the stylesheet for early theme initialization.
- `sitemap.xml` and `robots.txt` are generated. Do not use filesystem timestamps as content modification dates.
- Remove both source Markdown and generated HTML when deleting an article, then rebuild.

## Development

From the existing repository checkout, use Node.js >=20 and Python 3:

```bash
npm ci
npm test
npm run build
python3 -m http.server 8000
```

Cloud tasks already provide isolated checkouts. Do not create Git worktrees unless the user explicitly requests one.

Use the lockfile. Do not push or deploy merely to preview a change. CI runs tests and builds, then commits generated pages when relevant files change.

## Content and design

Preserve the author's stated background and personal details. Do not invent project experience, logs, incidents or performance metrics. Distinguish illustrative scenarios from verified experience; specify technical assumptions and limits.

Retain the warm beige, terracotta and dark green palette, readable Chinese line heights, restrained article lists and clear primary reading link. Max widths are 860px for the homepage and 760px for archive/articles. Verify keyboard focus, mobile layout and both themes after visual changes.

See README.md for authoring and validation details.
