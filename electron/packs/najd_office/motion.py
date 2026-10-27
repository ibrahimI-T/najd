"""PowerPoint animations and transitions written as PowerPoint itself writes them (structure taken from XML that
PowerPoint 16 saved for the same effects). Only the effects listed here are offered; anything else is refused."""
from lxml import etree

P = "http://schemas.openxmlformats.org/presentationml/2006/main"
P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"

# name -> (presetID, presetClass); subtypes by direction where the effect has one.
EFFECTS = {"appear": (1, "entr"), "fade": (10, "entr"), "fly": (2, "entr"), "wipe": (22, "entr"), "zoom": (23, "entr"), "grow": (6, "emph")}
EFFECT_NAMES = {value: key for key, value in EFFECTS.items()}
SUBTYPE = {"top": 1, "right": 2, "bottom": 4, "left": 8}
WIPE_FILTER = {"top": "up", "right": "right", "bottom": "down", "left": "left"}
FLY_FROM = {"bottom": ("ppt_y", "1+#ppt_h/2"), "top": ("ppt_y", "0-#ppt_h/2"), "left": ("ppt_x", "0-#ppt_w/2"), "right": ("ppt_x", "1+#ppt_w/2")}
TRIGGERS = ("click", "with", "after")
NODE_TYPE = {"click": "clickEffect", "with": "withEffect", "after": "afterEffect"}
TRANSITIONS = ("fade", "push", "wipe", "cut")


class MotionError(ValueError):
    pass


def check_effect(effect, trigger, delay_ms, duration_ms, direction):
    if effect not in EFFECTS:
        raise MotionError("Unsupported effect %r; use one of %s" % (effect, ", ".join(EFFECTS)))
    if trigger not in TRIGGERS:
        raise MotionError("Unsupported trigger %r; use click, with or after" % (trigger,))
    if direction is not None and (effect not in ("fly", "wipe") or direction not in SUBTYPE):
        raise MotionError("Direction applies to fly and wipe only: top, right, bottom or left")
    if not (0 <= int(delay_ms) <= 60000 and 50 <= int(duration_ms) <= 20000):
        raise MotionError("delay_ms must be 0-60000 and duration_ms 50-20000")


def _el(tag, attrs=None, ns=P):
    element = etree.Element("{%s}%s" % (ns, tag))
    for key, value in (attrs or {}).items():
        element.set(key, str(value))
    return element


def _sub(parent, tag, attrs=None, ns=P):
    child = _el(tag, attrs, ns)
    parent.append(child)
    return child


class _Ids:
    def __init__(self):
        self.value = 0

    def next(self):
        self.value += 1
        return self.value


def _cond(parent, delay):
    _sub(_sub(parent, "stCondLst"), "cond", {"delay": delay})


def _target(behaviour, spid):
    _sub(_sub(behaviour, "tgtEl"), "spTgt", {"spid": spid})


def _visibility(children, ids, spid):
    set_ = _sub(children, "set")
    behaviour = _sub(set_, "cBhvr")
    timing = _sub(behaviour, "cTn", {"id": ids.next(), "dur": 1, "fill": "hold"})
    _cond(timing, 0)
    _target(behaviour, spid)
    _sub(_sub(behaviour, "attrNameLst"), "attrName").text = "style.visibility"
    _sub(_sub(set_, "to"), "strVal", {"val": "visible"})


def _anim(children, ids, spid, attribute, start, end, duration, additive=True):
    anim = _sub(children, "anim", {"calcmode": "lin", "valueType": "num"})
    behaviour = _sub(anim, "cBhvr", {"additive": "base"} if additive else None)
    _sub(behaviour, "cTn", {"id": ids.next(), "dur": duration, "fill": "hold"})
    _target(behaviour, spid)
    _sub(_sub(behaviour, "attrNameLst"), "attrName").text = attribute
    values = _sub(anim, "tavLst")
    for tm, value in (("0", start), ("100000", end)):
        holder = _sub(_sub(values, "tav", {"tm": tm}), "val")
        if isinstance(value, (int, float)):
            _sub(holder, "fltVal", {"val": value})
        else:
            _sub(holder, "strVal", {"val": value})


def _effect(parent, ids, item):
    preset, klass = EFFECTS[item["effect"]]
    direction = item.get("direction") or ("bottom" if item["effect"] == "fly" else "left" if item["effect"] == "wipe" else None)
    subtype = SUBTYPE[direction] if item["effect"] in ("fly", "wipe") else (16 if item["effect"] == "zoom" else 0)
    duration = int(item["duration_ms"])
    par = _sub(parent, "par")
    node = _sub(par, "cTn", {"id": ids.next(), "presetID": preset, "presetClass": klass, "presetSubtype": subtype,
                              "fill": "hold", "grpId": 0, "nodeType": NODE_TYPE[item["trigger"]]})
    _cond(node, int(item["delay_ms"]))
    children = _sub(node, "childTnLst")
    spid = item["spid"]
    if item["effect"] == "grow":
        scale = _sub(children, "animScale")
        behaviour = _sub(scale, "cBhvr")
        _sub(behaviour, "cTn", {"id": ids.next(), "dur": duration, "fill": "hold"})
        _target(behaviour, spid)
        _sub(scale, "by", {"x": 150000, "y": 150000})
        return
    _visibility(children, ids, spid)
    if item["effect"] in ("fade", "wipe"):
        effect = _sub(children, "animEffect", {"transition": "in", "filter": "fade" if item["effect"] == "fade" else "wipe(%s)" % WIPE_FILTER[direction]})
        behaviour = _sub(effect, "cBhvr")
        _sub(behaviour, "cTn", {"id": ids.next(), "dur": duration})
        _target(behaviour, spid)
    elif item["effect"] == "fly":
        attribute, start = FLY_FROM[direction]
        other = "ppt_y" if attribute == "ppt_x" else "ppt_x"
        for name, begin in sorted(((attribute, start), (other, "#" + other))):
            _anim(children, ids, spid, name, begin, "#" + name, duration)
    elif item["effect"] == "zoom":
        _anim(children, ids, spid, "ppt_w", 0, "#ppt_w", duration, additive=False)
        _anim(children, ids, spid, "ppt_h", 0, "#ppt_h", duration, additive=False)


def effect_length(item):
    return int(item["delay_ms"]) + int(item["duration_ms"])


def build_timing(items):
    """p:timing for one slide. items: dicts with spid, effect, trigger, delay_ms, duration_ms, direction, in order."""
    if not items:
        return None
    ids = _Ids()
    timing = _el("timing")
    root = _sub(_sub(_sub(timing, "tnLst"), "par"), "cTn", {"id": ids.next(), "dur": "indefinite", "restart": "never", "nodeType": "tmRoot"})
    seq = _sub(_sub(root, "childTnLst"), "seq", {"concurrent": 1, "nextAc": "seek"})
    main = _sub(seq, "cTn", {"id": ids.next(), "dur": "indefinite", "nodeType": "mainSeq"})
    groups = _sub(main, "childTnLst")
    group_children, step_children, step_end, offset = None, None, 0, 0
    for item in items:
        # A click starts a new group. Effects before the first click (with/after at the start of the slide) form a group
        # that begins with the slide, written as PowerPoint writes it: delay indefinite plus onBegin of the main sequence.
        if item["trigger"] == "click" or group_children is None:
            group = _sub(groups, "par")
            group_node = _sub(group, "cTn", {"id": ids.next(), "fill": "hold"})
            conditions = _sub(group_node, "stCondLst")
            _sub(conditions, "cond", {"delay": "indefinite"})
            if item["trigger"] != "click":
                _sub(_sub(conditions, "cond", {"evt": "onBegin", "delay": 0}), "tn", {"val": main.get("id")})
            group_children = _sub(group_node, "childTnLst")
            step_children, offset, step_end = None, 0, 0
        if item["trigger"] == "after" or step_children is None:
            offset = step_end if item["trigger"] == "after" else 0
            step = _sub(group_children, "par")
            step_node = _sub(step, "cTn", {"id": ids.next(), "fill": "hold"})
            _cond(step_node, offset)
            step_children = _sub(step_node, "childTnLst")
            step_end = offset
        _effect(step_children, ids, item)
        step_end = max(step_end, offset + effect_length(item))
    prev = _sub(_sub(seq, "prevCondLst"), "cond", {"evt": "onPrev", "delay": 0})
    _sub(_sub(prev, "tgtEl"), "sldTgt")
    nxt = _sub(_sub(seq, "nextCondLst"), "cond", {"evt": "onNext", "delay": 0})
    _sub(_sub(nxt, "tgtEl"), "sldTgt")
    builds = _sub(timing, "bldLst")
    for spid in dict.fromkeys(item["spid"] for item in items):
        _sub(builds, "bldP", {"spid": spid, "grpId": 0, "animBg": 1})
    return timing


def build_transition(kind, duration_ms):
    if kind not in TRANSITIONS:
        raise MotionError("Unsupported transition %r; use fade, push, wipe or cut" % (kind,))
    duration_ms = int(duration_ms)
    speed = "fast" if duration_ms <= 500 else "med" if duration_ms <= 750 else "slow"
    alternate = etree.Element("{%s}AlternateContent" % MC, nsmap={"mc": MC})
    # Requires="p14" names a prefix, so p14 must be declared on mc:Choice itself, as PowerPoint writes it.
    choice = etree.SubElement(alternate, "{%s}Choice" % MC, nsmap={"p14": P14})
    choice.set("Requires", "p14")
    fallback = _sub(alternate, "Fallback", ns=MC)
    for parent, with_duration in ((choice, True), (fallback, False)):
        transition = _sub(parent, "transition", {"spd": speed})
        if with_duration:
            transition.set("{%s}dur" % P14, str(duration_ms))
        _sub(transition, kind)
    return alternate


def apply(slide_element, items, transition=None):
    """Replace a slide's transition and timing (p:sld children order: cSld, clrMapOvr, transition, timing, extLst)."""
    for old in slide_element.findall("{%s}timing" % P) + slide_element.findall("{%s}transition" % P) + [
            node for node in slide_element.findall("{%s}AlternateContent" % MC) if node.find(".//{%s}transition" % P) is not None]:
        slide_element.remove(old)
    anchor = slide_element.find("{%s}clrMapOvr" % P)
    if anchor is None:
        anchor = slide_element.find("{%s}cSld" % P)
    position = list(slide_element).index(anchor) + 1
    if transition:
        slide_element.insert(position, build_transition(*transition))
        position += 1
    timing = build_timing(items)
    if timing is not None:
        slide_element.insert(position, timing)


def read(slide_element):
    """Declared animations and transition of a slide, read from its XML (not played)."""
    effects = []
    for node in slide_element.iter("{%s}cTn" % P):
        if node.get("presetClass") not in ("entr", "emph", "exit", "path"):
            continue
        preset = (int(node.get("presetID", "0")), node.get("presetClass"))
        target = node.find(".//{%s}spTgt" % P)
        cond = node.find("{%s}stCondLst/{%s}cond" % (P, P))
        durations = [int(c.get("dur")) for c in node.iter("{%s}cTn" % P) if c is not node and str(c.get("dur", "")).isdigit() and c.get("dur") != "1"]
        effects.append({"effect": EFFECT_NAMES.get(preset, "preset-%s-%s" % preset), "trigger": {v: k for k, v in NODE_TYPE.items()}.get(node.get("nodeType"), node.get("nodeType")),
                        "spid": int(target.get("spid")) if target is not None else None, "delay_ms": int(cond.get("delay", "0")) if cond is not None and str(cond.get("delay", "0")).isdigit() else 0,
                        "duration_ms": max(durations) if durations else None})
    transition = None
    for node in slide_element.iter("{%s}transition" % P):
        kind = next((child.tag.split("}")[1] for child in node), None)
        duration = node.get("{%s}dur" % P14)
        transition = {"kind": kind, "duration_ms": int(duration) if duration else None}
        break
    return {"effects": effects, "transition": transition}
