"""Text helpers: Arabic detection, right-to-left paragraphs, installed fonts and text measurement (no Office)."""
import os
import re

ARABIC = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]")
FONTS_DIR = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "Fonts")
_index = None


def is_arabic(text):
    return bool(ARABIC.search(str(text or "")))


def installed_fonts():
    """Family/style name -> font file, read once from the Windows fonts folder."""
    global _index
    if _index is None:
        _index = {}
        try:
            from PIL import ImageFont
        except Exception:
            return _index
        for name in sorted(os.listdir(FONTS_DIR)) if os.path.isdir(FONTS_DIR) else []:
            if not name.lower().endswith((".ttf", ".otf", ".ttc")):
                continue
            try:
                family, style = ImageFont.truetype(os.path.join(FONTS_DIR, name), 12).getname()
            except Exception:
                continue
            path = os.path.join(FONTS_DIR, name)
            _index.setdefault(family.lower(), path)
            _index.setdefault((family + " " + style).lower(), path)
            if style.lower() in ("regular", "normal"):
                _index[family.lower()] = path
    return _index


def font_installed(family):
    return bool(family) and family.lower() in installed_fonts()


def font_file(family, bold=False):
    index = installed_fonts()
    family = (family or "Segoe UI").lower()
    if bold:
        for candidate in (family + " bold", family.replace(" semibold", "") + " bold"):
            if candidate in index:
                return index[candidate]
    return index.get(family) or index.get("segoe ui") or index.get("arial")


def _measurer(family, size_pt, bold):
    try:
        from PIL import ImageFont
        font = ImageFont.truetype(font_file(family, bold), max(1, int(round(size_pt * 4))))
        return lambda value: font.getlength(value) * 0.25
    except Exception:
        return lambda value: len(value) * size_pt * 0.55


def measure_width(text, family, size_pt, bold=False):
    """Width of the widest line when the text does not wrap."""
    measure = _measurer(family, size_pt, bold)
    return max((measure(line) for line in str(text or "").split("\n")), default=0)


def measure_lines(text, family, size_pt, width_pt, bold=False):
    """Lines a paragraph needs at this width (word wrap), from the real font's advance widths."""
    measure = _measurer(family, size_pt, bold)
    lines = 0
    for paragraph in str(text or "").split("\n"):
        words, current = paragraph.split(" "), ""
        lines += 1
        for word in words:
            trial = (current + " " + word).strip()
            if current and measure(trial) > width_pt:
                lines += 1
                current = word
            else:
                current = trial
            # A word wider than the box wraps by characters, as PowerPoint does, also when it starts the paragraph (a
            # long URL or unspaced text) (M3-I026).
            while measure(current) > width_pt and len(current) > 1:
                cut = max(1, int(len(current) * width_pt / max(measure(current), 1)))
                lines += 1
                current = current[cut:]
    return lines


def set_rtl(paragraph, rtl=True):
    """Right-to-left direction and right alignment on a python-pptx paragraph."""
    from pptx.enum.text import PP_ALIGN
    p_pr = paragraph._p.get_or_add_pPr()
    p_pr.set("rtl", "1" if rtl else "0")
    paragraph.alignment = PP_ALIGN.RIGHT if rtl else paragraph.alignment


def set_run_font(run, family, size_pt=None, bold=None, color=None, arabic=False):
    """Latin and complex-script typefaces (so Arabic uses the chosen font too) and the language tag."""
    from pptx.util import Pt
    from pptx.dml.color import RGBColor
    font = run.font
    font.name = family
    if size_pt:
        font.size = Pt(size_pt)
    if bold is not None:
        font.bold = bold
    if color:
        font.color.rgb = RGBColor.from_string(color)
    r_pr = run._r.get_or_add_rPr()
    # Schema order inside a:rPr is latin, ea, cs.
    for tag in ("ea", "cs"):
        element = r_pr.find("{http://schemas.openxmlformats.org/drawingml/2006/main}" + tag)
        if element is None:
            element = r_pr.makeelement("{http://schemas.openxmlformats.org/drawingml/2006/main}" + tag, {})
            r_pr.append(element)
        element.set("typeface", family)
    if arabic:
        r_pr.set("lang", "ar-SA")
        r_pr.set("altLang", "en-US")
