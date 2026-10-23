const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { buildSite, readPosts, renderMarkdown } = require('../scripts/build');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhangkai-build-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'posts'));
  for (const file of ['index.html', 'blog.html']) fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
  return root;
}

function post(root, slug, { title = slug, date = '2025-01-01', updated, featured, content } = {}) {
  const meta = [`title: ${title}`, `date: ${date}`, 'category: 后端 & 数据', 'description: 示例 <内容> & 说明'];
  if (updated) meta.push(`updated: ${updated}`);
  if (featured) meta.push(`featured: ${featured}`);
  fs.writeFileSync(path.join(root, 'posts', slug + '.md'), `---\n${meta.join('\n')}\n---\n\n# ${title}\n\n${content || '正文。'}\n`);
}

function block(html, name) {
  return html.split(`<!-- posts:${name}:start -->`)[1].split(`<!-- posts:${name}:end -->`)[0];
}

function schema(html) {
  return JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
}

test('code fences preserve HTML, generics and entity text as literal code', () => {
  const html = renderMarkdown('```html\n<div title="x">List<T> & &lt;</div>\n```');
  assert.match(html, /&lt;div title=&quot;x&quot;&gt;List&lt;T&gt; &amp; &amp;lt;&lt;\/div&gt;/);
  assert.doesNotMatch(html, /<div|<T>/);
  const hostile = renderMarkdown('```x" onmouseover="alert(1)\n<script>alert(1)</script>\n```');
  assert.match(hostile, /class="language-x&quot;"/);
  assert.doesNotMatch(hostile, /<script| onmouseover=/);
});

test('one metadata source drives article, featured list, sorted archive and schema', t => {
  const root = fixture(t);
  post(root, 'older', { title: 'A & B', date: '2024-01-01', updated: '2026-10-23', featured: 1 });
  post(root, 'newer', { date: '2026-01-01', featured: 2 });
  buildSite(root);
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const blog = fs.readFileSync(path.join(root, 'blog.html'), 'utf8');
  assert.ok(block(index, 'featured').indexOf('older.html') < block(index, 'featured').indexOf('newer.html'));
  assert.ok(block(blog, 'archive').indexOf('newer.html') < block(blog, 'archive').indexOf('older.html'));
  assert.match(index, /A &amp; B/);
  assert.match(blog, /示例 &lt;内容&gt; &amp; 说明/);
  assert.deepEqual(schema(blog).blogPost.map(p => p.headline), ['newer', 'A & B']);
  const article = fs.readFileSync(path.join(root, 'posts/older.html'), 'utf8');
  assert.equal(schema(article).datePublished, '2024-01-01');
  assert.equal(schema(article).dateModified, '2026-10-23');
  assert.match(article, /更新于 <time datetime="2026-10-23">/);
  assert.match(article, /src="\.\.\/assets\/theme.js"/);
  post(root, 'older', { title: '修订标题', date: '2024-01-01', featured: 1 });
  buildSite(root);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /修订标题/);
  assert.equal(schema(fs.readFileSync(path.join(root, 'blog.html'), 'utf8')).blogPost[1].headline, '修订标题');
});

test('rebuilding is byte-stable and sitemap dates do not follow filesystem timestamps', t => {
  const root = fixture(t);
  post(root, 'one', { updated: '2026-10-23', featured: 1 });
  buildSite(root);
  const files = ['index.html', 'blog.html', 'posts/one.html', 'sitemap.xml', 'robots.txt'];
  const before = files.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
  for (const file of [...files, 'posts/one.md']) fs.utimesSync(path.join(root, file), new Date('2035-01-01'), new Date('2035-01-01'));
  buildSite(root);
  assert.deepEqual(files.map(file => fs.readFileSync(path.join(root, file), 'utf8')), before);
  assert.match(before[3], /<lastmod>2026-10-23<\/lastmod>/);
  assert.equal((before[3].match(/<lastmod>/g) || []).length, 1);
});

test('invalid dates, mismatched headings and duplicate metadata fail before generation', t => {
  const root = fixture(t);
  post(root, 'bad', { date: '2025-02-30' });
  assert.throws(() => buildSite(root), /invalid publication/);
  assert.equal(fs.existsSync(path.join(root, 'posts/bad.html')), false);
  post(root, 'bad', { date: '2025-01-01', updated: '2024-01-01' });
  assert.throws(() => readPosts(root), /invalid publication/);
  post(root, 'bad');
  const file = path.join(root, 'posts/bad.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('# bad', '# another'));
  assert.throws(() => readPosts(root), /single H1 matching title/);
  post(root, 'bad');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('title: bad', 'title: bad\ntitle: duplicate'));
  assert.throws(() => readPosts(root), /Invalid metadata/);
});

test('duplicate featured ranks and missing template markers are errors', t => {
  const root = fixture(t);
  post(root, 'a', { featured: 1 }); post(root, 'b', { featured: 1 });
  assert.throws(() => readPosts(root), /ranks must be unique/);
  post(root, 'b');
  fs.writeFileSync(path.join(root, 'index.html'), '<main>missing markers</main>');
  assert.throws(() => buildSite(root), /generated block: featured/);
  assert.equal(fs.existsSync(path.join(root, 'posts/a.html')), false);
});

test('a heading inside a fenced example is not treated as the article title', t => {
  const root = fixture(t);
  post(root, 'example', { content: '```python\n# a code comment, not an H1\nprint("hello")\n```' });
  assert.equal(readPosts(root).length, 1);
  buildSite(root);
  assert.match(fs.readFileSync(path.join(root, 'posts/example.html'), 'utf8'), /<code class="language-python"># a code comment/);
});
