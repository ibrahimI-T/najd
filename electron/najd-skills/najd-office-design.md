---
name: najd-office-design
description: Professional Word, Excel and PowerPoint work with the NAJD Office kit - planning, building editable decks with native diagrams, charts and real animation, Arabic and mixed layouts, reviewing rendered slides and fixing what the review finds.
---

# Professional Office and design work in NAJD

Use this guide for presentations, reports, workbooks, charts and slide graphics. It needs the Office and design pack
(Settings > Plugins); NAJD installs it automatically when it is missing. If it is still installing, tell the user it will
be ready in a minute or two and offer to continue then; never ask them to install Python, python-pptx or Office.

Microsoft Office is never required to build an excellent file (R-056). The kit, the user's skills and connected MCP
tools build and check the file on their own (lint and inspect). When Office is installed, najd_office_review adds
rendered previews, animation playback and recalculation; when it is not, do the same quality of work, rely on lint and
inspect, and say which Office-rendered checks could not run.

## 1. Understand before building

- Keep the user's request, references and attachments as the source of truth. Read attachments (library tools) before
  planning. Note language (Arabic, English or mixed), audience, length, required logos or colours, and deadline-type
  constraints. Ask one short question only when a missing answer would change the whole deliverable.
- Plan in a few lines before code: the narrative (what each slide must make the audience understand), the visual
  direction (theme, one accent colour for emphasis, imagery or none), and which slides need diagrams, charts, tables
  or motion. Ten slides means ten distinct jobs, not ten bullet lists.

## 2. Build with the NAJD Office kit

```python
from najd_office import Deck, Doc, lint, inspect, report
deck = Deck(theme="midnight")          # midnight, slate, sand, forest; direction="rtl" for Arabic-first decks
s = deck.title_slide("العنوان", "Subtitle", kicker="2026")
s.animate("title", "fade").animate("subtitle", "fly", "after", 0, 500, "bottom")
d = deck.diagram("How it works", [("Collect", "sensors"), ("Decide", "controller"), ("Act", "pump")], kind="flow")
deck.reveal(d, ["node1", "link1", "node2", "link2", "node3"], effect="fade")
deck.chart("Output by month", ["Jan", "Feb", "Mar"], {"kWh": [120, 180, 210]}, kind="column").transition("push")
deck.save("deck.pptx"); report(lint("deck.pptx"))
```

- Layouts: title_slide, section, bullets (with optional image), columns (2-4 comparison cards), kpis, timeline,
  diagram (flow, cycle, hierarchy - native shapes with glued connectors), chart (column, bar, line, pie, doughnut,
  stacked - native and editable), table, image_slide, quote, closing; deck.text/box/connector/picture for custom
  slides. Every element stays an editable PowerPoint object; never paste a slide as one picture.
- Shapes are named (title, subtitle, node1, link1, chart, table, point1 ...) so they can be animated.
- Keep text short: at most 6 bullets, about 12 words each; split slides instead of shrinking type below 16 pt.
- Images: generate charts or illustrations locally (matplotlib, Pillow) or use files the user provided. Paid image
  generation needs the user's connected account and their approval each time.

## 3. Motion that explains

- Offered effects: appear, fade, fly (top/right/bottom/left), wipe (top/right/bottom/left), zoom; emphasis grow.
  Triggers: click (presenter advances), with (together with the previous), after (when the previous ends).
  Transitions: fade, push, wipe, cut. Other effects are refused; do not promise them.
- Use motion to stage an explanation (reveal a diagram step by step, build a chart point by point), not to decorate.
  Keep durations 300-700 ms. Do not animate every element.
- The kit writes PowerPoint's own animation format. Whether it plays is verified only by najd_office_review with
  playback: true on a computer with Microsoft PowerPoint. Report "declared" motion as declared, not as played.

## 4. Arabic and mixed language

- The kit sets right-to-left paragraphs, Arabic language tags and complex-script fonts for Arabic text automatically;
  use direction="rtl" for Arabic-first decks so layouts (diagram order, timelines, columns, tables) read right to left.
- Fonts: Segoe UI and Arial exist on every Windows computer; another font only if installed, and say that other
  computers may substitute it. Numbers and Latin terms can stay inside Arabic sentences.

## 5. Review and repair (always)

1. Run lint on a deck, inspect on a document or workbook (in Python), or najd_office_review on any of them. Fix every text overflow, overlap, off-slide shape, low
   contrast, missing font, left-to-right Arabic paragraph and dangling animation it reports.
2. With Office installed, look at every rendered slide image the review returns: alignment, crowding, cropping,
   hierarchy, contrast, font substitution, Arabic layout. Fix and review again.
3. For animated decks run najd_office_review with playback: true and check each effect is verified and in order.
4. Return the editable file name, what was checked (lint, previews, playback) and anything not verified, honestly.

## Word and Excel

- Word: Doc() for headings, paragraphs, bullets, tables and images with right-to-left Arabic handled; review renders
  pages with Office (PDF export) when available.
- Excel: XlsxWriter for new formatted workbooks with charts; openpyxl to read or edit existing ones. Formulas are
  written as text: openpyxl and XlsxWriter do not calculate them. A result is known only after Excel recalculates;
  najd_office_review recalculates a private copy and reports errors such as #DIV/0!.
- Never claim a formula's value, a rendering or a playback you did not verify.
