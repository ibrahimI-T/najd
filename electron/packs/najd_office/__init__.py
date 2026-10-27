"""NAJD Office kit (docs/AGENT-PLATFORM-M3-PLAN.md, M3-7): professional, editable Office files with compact calls.

    from najd_office import Deck, lint, inspect, report
    deck = Deck(theme="midnight")                     # midnight, slate, sand, forest
    s = deck.title_slide("عنوان العرض", "Subtitle")
    s.animate("title", "fade").animate("subtitle", "fly", "after", direction="bottom")
    deck.diagram("Process", ["Plan", "Build", "Test"], kind="flow").transition("push")
    deck.save("deck.pptx"); report(lint("deck.pptx"))

Effects: appear, fade, fly, wipe, zoom (entrance), grow (emphasis); triggers click, with, after; transitions fade,
push, wipe, cut. Motion is written as PowerPoint writes it; playing it is verified only by the Office review route.
convert(path, to) does ready conversions (pictures, csv/xlsx, docx/pptx to md/txt): see convert.py.
"""
from .checks import inspect, lint, report
from .convert import convert
from .deck import THEMES, Deck
from .doc import Doc

__version__ = "1.0.0"
__all__ = ["Deck", "Doc", "THEMES", "convert", "inspect", "lint", "report", "__version__"]
