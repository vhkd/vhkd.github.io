# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Static HTML personal homepage and blog for Zhang Kai (张凯), a Chinese backend engineer. Hosted on GitHub Pages at **zhangkai.me**. All content is in Chinese (zh-CN).

## Architecture

This is a zero-dependency, framework-free static site. There is **no build system, no package manager, no tests, no linter**.

- `index.html` — Landing page (hero, about, blog previews, contact)
- `blog.html` — Blog archive listing
- `posts/*.html` — Individual blog posts

Every page is fully self-contained with **inline CSS and inline JS** (no shared stylesheets or scripts). The theme toggle JS and CSS custom properties are copy-pasted across all files — this is intentional, not an oversight.

## Theme System

All pages share the same CSS custom property design system (`--bg`, `--paper`, `--ink`, `--muted`, `--accent`, etc.) with light/dark variants controlled by a `data-theme` attribute on `<html>`. The theme toggle persists to `localStorage`.

## Design Tokens

- Max-width: `860px` (homepage) / `760px` (blog/posts)
- Mobile breakpoint: `720px`
- Accent: terracotta/burnt orange (`#9b5a3c` light / `#d39a7b` dark)
- Background: warm beige (`#f6f1e8` light / `#111614` dark)
- Border-radius: 22–24px (pill-shaped cards/buttons)

## Working with This Repo

- **Preview:** Open `index.html` directly in a browser, or `python3 -m http.server`
- **Deploy:** Push to `main` — GitHub Pages serves automatically via `CNAME`
- **Adding a post:** Create a new `posts/<slug>.html` following the existing post structure, then add a card to both `index.html` (blog section) and `blog.html`
- **No generated/bundled output** — edit HTML directly
