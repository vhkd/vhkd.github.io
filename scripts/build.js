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
    const m = line.match(/^(\w+)\s*:\s*(.*?)\s*$/);
    if (!m || Object.hasOwn(meta, m[1])) throw new Error(`Invalid metadata: ${line}`);
    meta[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return { meta, content: match[2] };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
      tags.push(`<meta property="article:modified_time" content="${escapeHtml(page.updated || page.date)}">`);
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
      dateModified: page.updated || page.date,
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
    const language = (lang || '').split(/\s+/)[0];
    const className = language ? ` class="language-${escapeHtml(language)}"` : '';
    return `<pre><code${className}>${escapeHtml(text)}</code></pre>\n`;
  }
};

marked.use({ renderer });

function renderMarkdown(content) {
  return marked.parse(processContainers(content));
}

// --- HTML template ---
function htmlTemplate(page) {
  const fullTitle = `${page.title} | ${SITE.name}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${seoTags(page)}
  <meta name="theme-color" content="#f6f1e8">
  <title>${escapeHtml(fullTitle)}</title>
  <script type="application/ld+json">
${jsonLd(structuredData(page))}
  </script>

  <script src="../assets/theme.js"></script>
  <link rel="stylesheet" href="../assets/site.css">
</head>
<body class="site-post">
  <a class="skip-link" href="#main">跳转到正文</a>
  <header class="shell topbar">
    ${page.navLinks}
  </header>

  <main id="main" class="shell" tabindex="-1">
    <article>
${page.body}
    </article>
  </main>

  <footer class="shell">
    <span>Zhang Kai</span>
  </footer>

</body>
</html>`;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function readPosts(root) {
  const postsDir = path.join(root, 'posts');
  const posts = fs.readdirSync(postsDir).filter(file => file.endsWith('.md')).map(file => {
    const { meta, content } = parseFrontmatter(fs.readFileSync(path.join(postsDir, file), 'utf8'));
    for (const key of ['title', 'date', 'category', 'description']) {
      if (!meta[key]) throw new Error(`${file}: missing ${key}`);
    }
    if (!validDate(meta.date) || (meta.updated && (!validDate(meta.updated) || meta.updated < meta.date))) {
      throw new Error(`${file}: invalid publication/update date`);
    }
    if (meta.featured && !/^[1-9]\d*$/.test(meta.featured)) throw new Error(`${file}: invalid featured rank`);
    const headings = marked.lexer(content).filter(token => token.type === 'heading' && token.depth === 1);
    if (headings.length !== 1 || headings[0].text !== meta.title) {
      throw new Error(`${file}: expected a single H1 matching title`);
    }
    return { ...meta, content, path: `posts/${file.slice(0, -3)}.html`, type: 'blog' };
  });
  const ranks = posts.filter(post => post.featured).map(post => post.featured);
  if (new Set(ranks).size !== ranks.length) throw new Error('Featured ranks must be unique');
  return posts.sort((a, b) => b.date.localeCompare(a.date) || a.path.localeCompare(b.path));
}

function buildPost(post, root) {
  const published = `<time datetime="${post.date}">${post.date}</time>`;
  const updated = post.updated && post.updated !== post.date
    ? ` · 更新于 <time datetime="${post.updated}">${post.updated}</time>` : '';
  const body = `<p class="meta">${published} · ${escapeHtml(post.category)}${updated}</p>\n${renderMarkdown(post.content)}`;
  const navLinks = `<a href="../blog.html">全部文章</a>
    <div class="topbar-links">
      <a href="../">主页</a>
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="主题：自动" title="主题：自动">◐</button>
    </div>`;
  fs.writeFileSync(path.join(root, post.path), htmlTemplate({ ...post, body, navLinks }), 'utf8');
  console.log(`  ${post.path}`);
}

function renderCard(post, home) {
  const heading = home ? 'h3' : 'h2';
  return `        <a class="${home ? 'post-card' : 'post'}" href="${escapeHtml(post.path)}">
          <p class="${home ? 'post-meta' : 'meta'}"><time datetime="${post.date}">${post.date}</time> · ${escapeHtml(post.category)}</p>
          <${heading}>${escapeHtml(post.title)}</${heading}>
          <p>${escapeHtml(post.description)}</p>
        </a>`;
}

function replaceBlock(html, name, content) {
  const start = `<!-- posts:${name}:start -->`;
  const end = `<!-- posts:${name}:end -->`;
  const left = html.indexOf(start);
  const right = html.indexOf(end);
  if (left === -1 || right < left || html.indexOf(start, left + 1) !== -1 || html.indexOf(end, right + 1) !== -1) {
    throw new Error(`Missing or duplicate generated block: ${name}`);
  }
  const indent = name === 'featured' ? '        ' : name === 'archive' ? '      ' : '  ';
  return html.slice(0, left + start.length) + '\n' + content + '\n' + indent + html.slice(right);
}

function landingPages(root, posts) {
  const featured = posts.filter(post => post.featured)
    .sort((a, b) => Number(a.featured) - Number(b.featured)).slice(0, 3);
  const index = replaceBlock(fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
    'featured', featured.map(post => renderCard(post, true)).join('\n'));
  let blog = replaceBlock(fs.readFileSync(path.join(root, 'blog.html'), 'utf8'),
    'archive', posts.map(post => renderCard(post, false)).join('\n'));
  const data = {
    '@context': 'https://schema.org', '@type': 'Blog', name: `${SITE.name} 技术博客`,
    description: '张凯的全部技术文章，按发表时间排列。主题包括后端开发、事务与数据链路。',
    url: toSiteUrl('blog.html'), inLanguage: SITE.language,
    author: { '@type': 'Person', name: SITE.author, url: SITE.origin, sameAs: [SITE.github] },
    blogPost: posts.map(post => ({
      '@type': 'BlogPosting', headline: post.title, url: toSiteUrl(post.path),
      datePublished: post.date, dateModified: post.updated || post.date
    }))
  };
  blog = replaceBlock(blog, 'structured-data', `  <script type="application/ld+json">\n${jsonLd(data)}\n  </script>`);
  return { 'index.html': index, 'blog.html': blog };
}

function collectHtmlFiles(dir, root, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) collectHtmlFiles(fullPath, root, files);
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(path.relative(root, fullPath));
  }
  return files;
}

function buildSitemap(root, posts) {
  const dates = new Map(posts.map(post => [post.path, post.updated || post.date]));
  const score = file => file === 'index.html' ? 0 : file === 'blog.html' ? 1 : 2;
  const urls = collectHtmlFiles(root, root)
    .sort((a, b) => score(a) - score(b) || a.localeCompare(b))
    .map(file => {
      // A checkout/build timestamp is not evidence of a content edit.
      const lastmod = dates.has(file) ? `\n    <lastmod>${dates.get(file)}</lastmod>` : '';
      const priority = file === 'index.html' ? '1.0' : file === 'blog.html' ? '0.8' : '0.7';
      return `  <url>\n    <loc>${escapeXml(toSiteUrl(file))}</loc>${lastmod}\n    <priority>${priority}</priority>\n  </url>`;
    });
  fs.writeFileSync(path.join(root, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`, 'utf8');
}

function buildSite(root = path.resolve(__dirname, '..')) {
  const posts = readPosts(root);
  // Validate source metadata and landing-page markers before writing outputs.
  const pages = landingPages(root, posts);
  for (const post of posts) buildPost(post, root);
  for (const [file, html] of Object.entries(pages)) fs.writeFileSync(path.join(root, file), html, 'utf8');
  buildSitemap(root, posts);
  fs.writeFileSync(path.join(root, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE.origin}/sitemap.xml\n`, 'utf8');
  console.log(`Done: ${posts.length} posts, homepage, archive and sitemap.`);
}

if (require.main === module) buildSite();
module.exports = { buildSite, readPosts, renderMarkdown };
