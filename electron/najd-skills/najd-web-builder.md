---
name: najd-web-builder
description: Build polished, responsive websites and web apps with code (landing pages, company and portfolio sites, dashboards, small web apps) - design plan, Vite + React + TypeScript + Tailwind or plain HTML, Arabic RTL, checking the design by eye with page previews, and production builds.
---

# Building websites in NAJD

Use this guide whenever the user wants a website, landing page, web app, dashboard or any page that runs in a browser.
Work like a product studio: a clear plan, real content, a distinctive design, and a result you have looked at yourself.

## What you have

- Node, npm and npx are always available in commands, even when the user never installed Node (NAJD ships its own).
- `najd_terminal_run` for short commands (60 s limit). Use `najd_process_start` for anything longer: `npm create`,
  `npm install`, `npm run dev`, `npm run build`. Read progress with `najd_process_output`; stop servers with
  `najd_process_stop` when you are done.
- `najd_files_write` / `najd_files_edit` for source files, in the NAJD workspace unless the user names a folder.
- `najd_web_preview` renders a page and shows you a picture: a dev server (`http://localhost:5173/`), an HTML file or
  folder, or a public https page, at a width you choose (1440 desktop, 390 phone), optionally the full page height.
  It also reports console errors and whether the page scrolls sideways.
- `najd_image_generate` for original images (hero art, illustrations, an Open Graph image); the user approves each one.
- Web search and page reading for real facts, references and inspiration.

## Workflow

1. **Brief.** Purpose, audience, the one action a visitor should take, the content (use what the user gave; write
   real copy otherwise), language and direction. Arabic sites are RTL first. Ask only about what changes the
   result; otherwise decide and say what you chose.
2. **Design plan, before code.** A short token system: 4-6 named hex colours, typefaces and their roles, a type
   scale, spacing, and a one-line layout idea per section. Choose from the subject itself, not a template: avoid the
   generic cream-and-terracotta, black-with-one-neon-accent and identical-rounded-cards looks, all-caps eyebrow
   labels, and numbered markers on content that is not a sequence. Arabic type: IBM Plex Sans Arabic, Noto Kufi
   Arabic, Tajawal, Cairo or Readex Pro (Google Fonts), with generous line height. Spend boldness in one place.
3. **Pick the simplest stack that fits.**
   - One page with little interaction: a single `index.html` with CSS and a little JavaScript. No build step.
   - Anything larger: Vite + React + TypeScript + Tailwind CSS:
     `npm create vite@latest SITE -- --template react-ts`, then in SITE `npm install` and
     `npm install tailwindcss @tailwindcss/vite`; add `tailwindcss()` to `plugins` in `vite.config.ts`, set
     `base: './'` there (the build then also opens as a file), and replace `src/index.css` with
     `@import "tailwindcss";` plus your design tokens in `@theme`.
4. **Build section by section** with semantic HTML, real text, `lang` and `dir` on `<html>`, logical spacing
   (`ms-`/`me-`, `start`/`end`) so RTL and LTR both work, visible keyboard focus, alt text, and
   `prefers-reduced-motion` respected. Motion only where it means something.
5. **Run it.** `najd_process_start` with `npm run dev -- --port 5173 --strictPort`; wait for "ready" in its output.
6. **Look at it - every time something visible changes.** `najd_web_preview` at 1440 with `fullPage: true`, then
   at 390. Fix overflow, cramped or uneven spacing, weak contrast, broken RTL, text over busy images, console errors
   and anything that looks generic. Repeat until it looks finished. Never call a site done without having seen it.
7. **Production build.** `npm run build`, then preview `dist/index.html` the same way. Add `<title>`, a meta
   description, Open Graph tags, a favicon and a 1200x630 share image.
8. **Give the owner a link that still works.** A `localhost` address stops working when the dev server stops, so never hand it over as the result.
   Link the finished page as a file link in a Markdown link, for example `[Open the site](file:///C:/Users/NAME/Documents/NAJD/site/index.html)`
   (forward slashes, the real path of a file inside the NAJD workspace). Clicking it opens the page in the default browser.
   For a Vite app, run `npm run build` and link `dist/index.html` (set `base: './'` so it works from a file).
9. **Deliver.** Tell the user where the project is, how to open it (`npm run dev`, or open the HTML file), what you
   built and checked, with what is not verified. Offer hosting steps for Cloudflare Pages, Netlify, Vercel or GitHub
   Pages; publishing uses the user's own account and they sign in themselves - never ask for passwords or tokens.

## Quality bar

- Works from 360 px to 1920 px with no sideways scrolling; tap targets at least 44 px on phones.
- Text contrast meets WCAG AA in light and dark themes; dark mode when it suits the brand.
- Images sized for the web (WebP or AVIF where possible); nothing hot-linked from other sites without permission.
- No placeholder text, broken links, console errors or unused template files left behind.
