"""NAJD presentation benchmark (docs/AGENT-PLATFORM-M3-PLAN.md, M3-10): a ten-slide, mixed Arabic/English, animated and
editable deck from a new brief, built only with the NAJD Office kit and locally generated images.
Brief: smart water management for date-palm farms in Qassim (subject differs from the owner's reference deck).
Usage: python -I -B office-benchmark-deck.py <pack site-packages> <kit parent folder> <output folder>"""
import os
import site
import sys

site.addsitedir(sys.argv[1])
sys.path.append(sys.argv[2])
out = sys.argv[3]

import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from najd_office import Deck, lint, report  # noqa: E402

# Locally generated imagery: a calm dune-and-palm silhouette for the title, no external assets.
def landscape(path):
    fig = plt.figure(figsize=(13.333, 7.5), dpi=120)
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_axis_off()
    x = np.linspace(0, 1, 600)
    sky = np.linspace(0, 1, 256).reshape(-1, 1)
    ax.imshow(sky, extent=[0, 1, 0, 1], cmap=matplotlib.colors.LinearSegmentedColormap.from_list("s", ["#0B1F3A", "#1F4E79", "#E8B65A"]), aspect="auto")
    for level, colour, amp in ((0.32, "#13294B", 0.05), (0.22, "#0F2238", 0.04), (0.12, "#0B1A2C", 0.03)):
        ax.fill_between(x, 0, level + amp * np.sin(x * 9 + level * 20), color=colour)
    for px in (0.70, 0.78, 0.86):
        ax.plot([px, px + 0.005], [0.18, 0.42], color="#0B1A2C", lw=5)
        for angle in np.linspace(0.2, 2.9, 7):
            ax.plot([px + 0.005, px + 0.005 + 0.06 * np.cos(angle)], [0.42, 0.42 + 0.05 * np.sin(angle) - 0.02], color="#0B1A2C", lw=3)
    ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    fig.savefig(path); plt.close(fig)


def field(path):
    fig = plt.figure(figsize=(6, 6), dpi=120)
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_axis_off()
    ax.set_facecolor("#13294B"); fig.patch.set_facecolor("#13294B")
    rows = np.arange(0.1, 1.0, 0.11)
    for y in rows:
        for x in np.arange(0.08, 1.0, 0.12):
            ax.add_patch(matplotlib.patches.Circle((x, y), 0.028, color="#4CD97B", alpha=0.85))
        ax.plot([0.02, 0.98], [y - 0.045, y - 0.045], color="#22C3E6", lw=1.5, alpha=0.7)
    ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    fig.savefig(path); plt.close(fig)


landscape(os.path.join(out, "title.png"))
field(os.path.join(out, "field.png"))

deck = Deck(theme="midnight", direction="rtl")
# 1. Title over a local image.
s = deck.title_slide("إدارة المياه الذكية لمزارع النخيل", "Smart irrigation for date-palm farms in Qassim", kicker="مبادرة 2026", image=os.path.join(out, "title.png"))
s.animate("kicker", "fade", "with", 200, 500).animate("title", "fly", "after", 0, 600, "bottom").animate("subtitle", "fade", "after", 100, 500)

# 2. The problem, with an illustration.
s = deck.bullets("لماذا الآن؟", ["الري التقليدي يهدر نحو 40٪ من المياه", "انخفاض منسوب المياه الجوفية سنويًا", "تكلفة الطاقة للضخ في ارتفاع", "IoT sensors are now affordable"], image=os.path.join(out, "field.png"))
deck.reveal(s, ["point1", "point2", "point3", "point4"], effect="fade", stagger_ms=150, duration_ms=400)
s.transition("fade", 600)

# 3. Key numbers.
s = deck.kpis("الأثر المتوقع", [("35٪", "توفير في استهلاك المياه"), ("22٪", "خفض تكلفة الطاقة"), ("12", "شهرًا لاسترداد التكلفة")])
deck.reveal(s, ["kpi1", "kpi2", "kpi3"], effect="zoom", stagger_ms=100, duration_ms=500)

# 4. How the system works: native, staged flow.
s = deck.diagram("كيف يعمل النظام", [("الحساسات", "Soil moisture"), ("البوابة", "LoRa gateway"), ("المتحكم", "Smart controller"), ("الصمامات", "Drip valves")], kind="flow",
                 subtitle="كل عنصر قابل للتعديل داخل PowerPoint")
deck.reveal(s, ["node1", "link1", "node2", "link2", "node3", "link3", "node4"], effect="fade", stagger_ms=100, duration_ms=400)
s.transition("push", 700)

# 5. Continuous improvement cycle.
s = deck.diagram("دورة القرار اليومية", ["قياس", "تحليل", "ري", "مراجعة"], kind="cycle")
deck.reveal(s, ["node1", "node2", "node3", "node4"], effect="wipe", stagger_ms=100, duration_ms=500, direction="right")

# 6. Native chart.
s = deck.chart("استهلاك المياه (م³ لكل نخلة)", ["يناير", "مارس", "مايو", "يوليو", "سبتمبر"], {"Traditional": [42, 55, 78, 96, 70], "Smart": [28, 35, 49, 61, 45]},
               kind="column", subtitle="قبل وبعد التطبيق في المزرعة التجريبية")
s.animate("chart", "wipe", "click", 0, 700, "bottom")
s.transition("fade", 600)

# 7. Native table.
s = deck.table("مقارنة طرق الري", ["الطريقة", "كفاءة المياه", "التكلفة الأولية", "الصيانة"],
               [["الغمر", "منخفضة", "منخفضة", "قليلة"], ["التنقيط", "عالية", "متوسطة", "متوسطة"], ["التنقيط الذكي", "عالية جدًا", "متوسطة", "مؤتمتة"]])
s.animate("table", "fade", "click", 0, 500)

# 8. Comparison cards.
s = deck.columns("ما الذي يتغير للمزارع؟", [{"heading": "قبل", "points": ["جدول ري ثابت", "فحص يدوي للتربة", "فواتير طاقة مرتفعة"]},
                                          {"heading": "بعد", "points": ["ري حسب حاجة النخلة", "تنبيهات على الجوال", "تقارير أسبوعية واضحة"]}])
deck.reveal(s, ["card2", "cardtitle2", "cardtext2"], effect="fade", stagger_ms=0, duration_ms=400)
deck.reveal(s, ["card1", "cardtitle1", "cardtext1"], effect="fade", stagger_ms=0, duration_ms=400)

# 9. Implementation timeline.
s = deck.timeline("خطة التنفيذ", [("الربع الأول", "مسح المزارع وتركيب الحساسات"), ("الربع الثاني", "تشغيل تجريبي في 3 مزارع"), ("الربع الثالث", "التوسع إلى 40 مزرعة"), ("الربع الرابع", "تقييم النتائج وتقرير الأثر")])
deck.reveal(s, ["marker1", "steplabel1", "steptext1", "marker2", "steplabel2", "steptext2", "marker3", "steplabel3", "steptext3", "marker4", "steplabel4", "steptext4"], effect="fade", stagger_ms=50, duration_ms=300)
s.transition("wipe", 600)

# 10. Close.
s = deck.closing("شكرًا لكم", "Questions & next steps · najd.example")
s.animate("title", "zoom", "with", 0, 600).animate("subtitle", "fade", "after", 0, 500)

path = deck.save(os.path.join(out, "benchmark.pptx"))
report({"deck": path, "lint": lint(path)})
