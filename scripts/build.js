const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const SITE = {
  origin: 'https://zhangkai.me',
  name: 'Zhang Kai',
  author: 'Zhang Kai',
  language: 'zh-CN',
  locale: 'zh_CN',
  github: 'https://github.com/vhkd'
};

// --- YAML frontmatter parser (simple key-value) ---
function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: text };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+)\s*:\s*"?(.*?)"?\s*$/);
    if (m) meta[m[1]] = m[2];
  }
  return { meta, content: match[2] };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toSiteUrl(pagePath) {
  const normalized = pagePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const urlPath = normalized === 'index.html' ? '/' : `/${normalized}`;
  return `${SITE.origin}${urlPath}`;
}

function jsonLd(data) {
  return JSON.stringify(data, null, 2).replace(/<\/script/gi, '<\\/script');
}

function seoTags(page) {
  const fullTitle = `${page.title} | ${SITE.name}`;
  const url = toSiteUrl(page.path);
  const description = page.description || page.title;
  const type = page.type === 'blog' ? 'article' : 'website';
  const tags = [
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta name="author" content="${escapeHtml(SITE.author)}">`,
    '<meta name="robots" content="index,follow">',
    `<meta property="og:site_name" content="${escapeHtml(SITE.name)}">`,
    `<meta property="og:locale" content="${escapeHtml(SITE.locale)}">`,
    `<meta property="og:title" content="${escapeHtml(fullTitle)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${escapeHtml(fullTitle)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`
  ];

  if (page.type === 'blog') {
    if (page.date) {
      tags.push(`<meta property="article:published_time" content="${escapeHtml(page.date)}">`);
    }
    if (page.category) {
      tags.push(`<meta property="article:section" content="${escapeHtml(page.category)}">`);
    }
  }

  return tags.join('\n  ');
}

function structuredData(page) {
  const url = toSiteUrl(page.path);
  const base = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    description: page.description || page.title,
    url,
    inLanguage: SITE.language,
    isPartOf: {
      '@type': 'WebSite',
      name: SITE.name,
      url: SITE.origin
    }
  };

  if (page.type === 'blog') {
    return {
      ...base,
      '@type': 'BlogPosting',
      headline: page.title,
      datePublished: page.date,
      dateModified: page.date,
      articleSection: page.category,
      author: {
        '@type': 'Person',
        name: SITE.author,
        url: SITE.origin,
        sameAs: [SITE.github]
      },
      mainEntityOfPage: url
    };
  }

  return base;
}

// --- Custom syntax: :::left / :::right ---
// Line-by-line parser to avoid regex eating newlines between blocks
function processContainers(text) {
  const lines = text.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].match(/^:::left\s*$/)) {
      // Collect left block content
      const leftLines = [];
      i++;
      while (i < lines.length && !lines[i].match(/^:::\s*$/)) {
        leftLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing :::

      // Expect :::right block next (skip blank lines)
      while (i < lines.length && lines[i].trim() === '') i++;

      if (i < lines.length && lines[i].match(/^:::right\s*$/)) {
        const rightLines = [];
        i++;
        while (i <lines.length && !lines[i].match(/^:::\s*$/)) {
          rightLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // skip closing :::

        const leftContent = marked.parseInline(leftLines.join('\n').trim());
        const rightContent = marked.parseInline(rightLines.join('\n').trim());
        result.push(`<div class="entry-row"><div class="entry-left">${leftContent}</div><div class="entry-right">${rightContent}</div></div>`);
      } else {
        // Only left block, no right follows
        const leftContent = marked.parseInline(leftLines.join('\n').trim());
        result.push(`<div class="entry-left">${leftContent}</div>`);
      }
    } else if (lines[i].match(/^:::right\s*$/)) {
      // Standalone right block
      const rightLines = [];
      i++;
      while (i < lines.length && !lines[i].match(/^:::\s*$/)) {
        rightLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const rightContent = marked.parseInline(rightLines.join('\n').trim());
      result.push(`<div class="entry-right">${rightContent}</div>`);
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join('\n');
}

// --- Custom marked renderer ---
const renderer = {
  heading({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    const slug = text.replace(/<[^>]+>/g, '').replace(/\s+/g, '-').replace(/[^\w一-鿿-]/g, '').toLowerCase();
    return `<h${depth} id="${slug}">${text}</h${depth}>`;
  },
  code({ text, lang }) {
    return `<pre><code class="language-${lang || ''}">${text}</code></pre>`;
  }
};

marked.use({ renderer });

// --- HTML template ---
function htmlTemplate(page) {
  const fullTitle = `${page.title} | ${SITE.name}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${seoTags(page)}
  <meta name="theme-color" media="(prefers-color-scheme: light)" content="#fbf8f2">
  <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#111614">
  <title>${escapeHtml(fullTitle)}</title>
  <script type="application/ld+json">
${jsonLd(structuredData(page))}
  </script>
  <script>
    (function () {
      var savedTheme = localStorage.getItem("theme-preference");
      if (savedTheme === "light" || savedTheme === "dark") {
        document.documentElement.setAttribute("data-theme", savedTheme);
      }
    })();
  </script>
  <style>
    :root {
      --bg: #fbf8f2;
      --paper: rgba(255, 252, 246, 0.84);
      --ink: #182018;
      --muted: #667065;
      --line: rgba(24, 32, 24, 0.12);
      --accent: #9b5a3c;
      --display: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
      --body: "Aptos", "Trebuchet MS", "PingFang SC", "Hiragino Sans GB", sans-serif;
      --mono: "IBM Plex Mono", "Courier New", monospace;
      --shadow: 0 18px 40px rgba(24, 32, 24, 0.08);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111614;
        --paper: rgba(26, 33, 29, 0.84);
        --ink: #e8ece5;
        --muted: #9ca79e;
        --line: rgba(232, 236, 229, 0.12);
        --accent: #d39a7b;
        --shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
      }
    }
    html[data-theme="light"] {
      --bg: #fbf8f2;
      --paper: rgba(255, 252, 246, 0.84);
      --ink: #182018;
      --muted: #667065;
      --line: rgba(24, 32, 24, 0.12);
      --accent: #9b5a3c;
      --shadow: 0 18px 40px rgba(24, 32, 24, 0.08);
    }
    html[data-theme="dark"] {
      --bg: #111614;
      --paper: rgba(26, 33, 29, 0.84);
      --ink: #e8ece5;
      --muted: #9ca79e;
      --line: rgba(232, 236, 229, 0.12);
      --accent: #d39a7b;
      --shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at 12% 8%, rgba(155, 90, 60, 0.1), transparent 20rem),
        linear-gradient(180deg, color-mix(in srgb, var(--bg) 75%, white), var(--bg));
      font-family: var(--body);
      line-height: 1.8;
    }
    a { color: inherit; text-decoration: none; }
    a:hover { color: var(--accent); }
    .shell { width: min(760px, calc(100% - 32px)); margin: 0 auto; }
    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 20px 0;
      font-family: var(--mono);
      font-size: 0.76rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .topbar a {
      padding: 0.65rem 0.85rem;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: color-mix(in srgb, var(--paper) 84%, transparent);
    }
    .theme-toggle {
      cursor: pointer;
      color: inherit;
      display: inline-grid;
      place-items: center;
      width: 40px;
      height: 40px;
      padding: 0;
      border: 1px solid var(--line);
      border-radius: 50%;
      background: color-mix(in srgb, var(--paper) 84%, transparent);
      font-size: 1rem;
      line-height: 1;
    }
    article { padding: 28px 0 64px; }
    .meta {
      margin-bottom: 1rem;
      color: var(--accent);
      font-family: var(--mono);
      font-size: 0.76rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    h1, h2, h3, p { margin-top: 0; }
    h1 {
      margin-bottom: 1rem;
      font-family: var(--display);
      font-size: clamp(2.8rem, 9vw, 5.4rem);
      line-height: 0.92;
      letter-spacing: -0.06em;
    }
    .lead {
      margin-bottom: 2rem;
      color: var(--muted);
      font-size: 1.12rem;
    }
    h2 {
      margin-top: 2.2rem;
      margin-bottom: 0.75rem;
      font-size: 1.6rem;
      line-height: 1.15;
    }
    h3 {
      margin-top: 1.6rem;
      margin-bottom: 0.5rem;
      font-size: 1.2rem;
    }
    pre {
      padding: 1rem 1.2rem;
      border-radius: 12px;
      background: var(--paper);
      border: 1px solid var(--line);
      overflow-x: auto;
      font-family: var(--mono);
      font-size: 0.88rem;
      line-height: 1.6;
    }
    code {
      font-family: var(--mono);
      font-size: 0.9em;
      padding: 0.15em 0.4em;
      border-radius: 4px;
      background: rgba(155, 90, 60, 0.08);
    }
    pre code {
      padding: 0;
      background: none;
      border-radius: 0;
    }
    blockquote {
      margin: 1.5rem 0;
      padding: 1rem 1.4rem;
      border-left: 3px solid var(--accent);
      border-radius: 0 12px 12px 0;
      background: color-mix(in srgb, var(--paper) 60%, transparent);
      color: var(--muted);
    }
    ul, ol {
      padding-left: 1.5rem;
    }
    li {
      margin-bottom: 0.4rem;
    }
    strong {
      color: var(--ink);
      font-weight: 700;
    }
    /* Entry layout styles */
    .entry-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 1rem;
      margin-bottom: 0.3rem;
    }
    .entry-left {
      flex: 1;
      font-weight: 700;
    }
    .entry-right {
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.88rem;
      white-space: nowrap;
    }
    footer {
      padding: 12px 0 40px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.76rem;
    }
    @media (max-width: 720px) {
      .topbar {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.6rem;
      }
      h1 {
        font-size: clamp(2rem, 8vw, 3.2rem);
      }
      article {
        padding: 32px 0 48px;
      }
      .entry-row {
        flex-direction: column;
        gap: 0;
      }
      .entry-right {
        white-space: normal;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        scroll-behavior: auto !important;
        transition-duration: 1ms !important;
      }
    }
    @media print {
      .topbar { display: none; }
      body { background: #fff; color: #000; }
      .shell { width: 100%; max-width: none; }
    }
  </style>
</head>
<body>
  <header class="shell topbar">
    ${page.navLinks}
  </header>

  <main class="shell">
    <article>
${page.body}
    </article>
  </main>

  <footer class="shell">
    <span>Zhang Kai</span>
  </footer>
  <script>
    (function () {
      var key = "theme-preference";
      var button = document.getElementById("theme-toggle");
      if (!button) return;
      var labels = {
        system: "主题：自动",
        dark: "主题：夜间",
        light: "主题：日间"
      };
      var icons = {
        system: "◐",
        dark: "☾",
        light: "☼"
      };
      var order = ["system", "dark", "light"];
      var current = localStorage.getItem(key) || "system";

      function apply(theme) {
        if (theme === "light" || theme === "dark") {
          document.documentElement.setAttribute("data-theme", theme);
        } else {
          document.documentElement.removeAttribute("data-theme");
        }
        button.textContent = icons[theme];
        button.setAttribute("aria-label", labels[theme]);
        button.setAttribute("title", labels[theme]);
      }

      button.addEventListener("click", function () {
        var index = order.indexOf(current);
        current = order[(index + 1) % order.length];
        if (current === "system") {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, current);
        }
        apply(current);
      });

      apply(current);
    })();
  </script>
</body>
</html>`;
}

// --- Build a single markdown file ---
function buildFile(mdPath, type) {
  const raw = fs.readFileSync(mdPath, 'utf8');
  const { meta, content } = parseFrontmatter(raw);

  // Process custom containers before markdown parsing
  let processed = processContainers(content);

  // Convert markdown to HTML
  const body = marked.parse(processed);

  const basename = path.basename(mdPath, '.md');
  const title = meta.title || basename;
  const description = meta.description || title;

  const navLinks = `<a href="../blog.html">返回博客</a>
    <div style="display: flex; gap: 0.7rem; flex-wrap: wrap; justify-content: flex-end;">
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="主题：自动" title="主题：自动">◐</button>
      <a href="../">返回主页</a>
    </div>`;
  const outPath = path.join(path.dirname(mdPath), basename + '.html');

  // Add meta line for blog posts
  let fullBody = body;
  if (type === 'blog' && meta.date) {
    const category = meta.category ? ` · ${meta.category}` : '';
    fullBody = `<p class="meta">${meta.date}${category}</p>\n${body}`;
  }

  const html = htmlTemplate({
    title,
    description,
    body: fullBody,
    navLinks,
    path: path.relative(path.resolve(__dirname, '..'), outPath),
    type,
    date: meta.date,
    category: meta.category
  });
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`  ${path.relative(process.cwd(), mdPath)} → ${path.relative(process.cwd(), outPath)}`);
}

function collectHtmlFiles(dir, root, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectHtmlFiles(fullPath, root, files);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(path.relative(root, fullPath));
    }
  }
  return files;
}

function sitemapPriority(pagePath) {
  if (pagePath === 'index.html') return '1.0';
  if (pagePath === 'blog.html') return '0.8';
  if (pagePath.startsWith('posts/')) return '0.7';
  return '0.5';
}

function buildSitemap(root) {
  const urls = collectHtmlFiles(root, root)
    .sort((a, b) => {
      const score = (file) => (file === 'index.html' ? 0 : file === 'blog.html' ? 1 : file.startsWith('posts/') ? 2 : 3);
      return score(a) - score(b) || a.localeCompare(b);
    })
    .map((file) => {
      const stat = fs.statSync(path.join(root, file));
      return `  <url>
    <loc>${escapeXml(toSiteUrl(file))}</loc>
    <lastmod>${stat.mtime.toISOString().slice(0, 10)}</lastmod>
    <priority>${sitemapPriority(file)}</priority>
  </url>`;
    });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(root, 'sitemap.xml'), xml, 'utf8');
  console.log('  sitemap.xml');
}

function buildRobots(root) {
  const robots = `User-agent: *
Allow: /

Sitemap: ${SITE.origin}/sitemap.xml
`;
  fs.writeFileSync(path.join(root, 'robots.txt'), robots, 'utf8');
  console.log('  robots.txt');
}

// --- Main ---
function main() {
  const root = path.resolve(__dirname, '..');

  // Build blog posts
  const postsDir = path.join(root, 'posts');
  if (fs.existsSync(postsDir)) {
    const postFiles = fs.readdirSync(postsDir).filter(f => f.endsWith('.md')).sort();
    for (const f of postFiles) {
      buildFile(path.join(postsDir, f), 'blog');
    }
  }

  buildSitemap(root);
  buildRobots(root);
  console.log('Done.');
}

main();
