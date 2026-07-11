"""The optimizer/evaluator loop.

Round 1   — render one candidate per template, let the evaluator score them,
             keep the winner.
Round 2+  — mutate the winner and re-score. Which mutations get tried first is
             steered by the judge's *reason* string for the current winner
             (e.g. a "feels cropped" critique promotes the aspect-ordering
             mutation). If a round improves the score, one more round runs
             from the new winner (up to MAX_ROUNDS); the first round with no
             improvement stops the loop — a small hill-climb with early stop
             instead of a fixed two-shot.

Mutations start from a copy of the winning spec (order changes re-generate the
layout but carry the winner's background/text/radius), so improvements found in
one round survive into the next.

Returns the best spec, its full-res render, and a log of everything tried so
the workflow can print a transparent trail.
"""
import copy
import random

from . import config, layouts
from .evaluate import score_candidates
from .render import render, thumbnail
from .theme import _luma

MAX_ROUNDS = 3

# Judge-critique → mutation routing. The first keyword hit in the winner's
# reason string promotes its mutation to the front of the plan; unmatched
# mutations follow in default order so the plan is always full.
_REASON_ROUTES = (
    (("crop", "cut off", "truncat", "chopped"), "aspect_order"),
    (("balance", "arrangement", "placement", "order", "sequence", "repetit"), "reorder"),
    (("background", "dark", "bright", "contrast", "color", "colour", "muddy", "washed"), "bg_flip"),
    (("harsh", "boxy", "rigid", "sharp", "sterile"), "rounder"),
)
_DEFAULT_PLAN = ("reorder", "bg_flip", "rounder", "aspect_order")


def _mutation_plan(reason: str, n: int) -> list[str]:
    """Order mutations so the ones addressing the judge's critique come first."""
    plan = []
    critique = (reason or "").lower()
    for keywords, name in _REASON_ROUTES:
        if name not in plan and any(k in critique for k in keywords):
            plan.append(name)
    for name in _DEFAULT_PLAN:
        if name not in plan:
            plan.append(name)
    return plan[:n]


def _carry_traits(variant: dict, base: dict) -> dict:
    """Keep the traits a previous round may have won on (bg flip, radius) when
    a mutation regenerates the layout from scratch."""
    for key in ("bg", "text_color", "radius"):
        if key in base:
            variant[key] = base[key]
    return variant


def _mutate(spec: dict, photos, theme: dict, n: int,
            reason: str = "", round_no: int = 2) -> list[dict]:
    """Produce up to `n` variations of a winning spec, prioritised by the
    judge's critique of it. Seeded per-round so successive rounds explore a
    different neighborhood instead of re-proposing the same shuffle."""
    rnd = random.Random(len(spec["cells"]) * 7 + round_no)
    gen = layouts.TEMPLATES[spec["name"]]

    def reorder():
        order = list(range(len(photos)))
        rnd.shuffle(order)
        return _carry_traits(gen(photos, theme, order=order), spec)

    def aspect_order():
        # Widest photos first — layouts that hand big/wide cells to early
        # photos then crop less (the heuristic judge scores crop retention).
        order = sorted(range(len(photos)),
                       key=lambda i: -(photos[i].width / photos[i].height))
        return _carry_traits(gen(photos, theme, order=order), spec)

    def bg_flip():
        alt = copy.deepcopy(spec)
        alt_bg = "#f2efe9" if _luma(alt["bg"]) < 130 else "#15151a"
        alt["bg"] = alt_bg
        alt["text_color"] = "#f5f3ef" if _luma(alt_bg) < 130 else "#1a1a1a"
        return alt

    def rounder():
        # Radius is read at render time, so mutating the copy re-renders visibly.
        v = copy.deepcopy(spec)
        v["radius"] = spec.get("radius", 14) + 10
        return v

    makers = {"reorder": reorder, "aspect_order": aspect_order,
              "bg_flip": bg_flip, "rounder": rounder}
    return [makers[name]() for name in _mutation_plan(reason, n)]


def optimize(photos, theme: dict, template=None):
    """Run the multi-round loop. An optional `template` image steers both which
    candidate wins (the judge scores by resemblance) and appears in the log."""
    log = {"theme": theme, "rounds": [], "template": template is not None}

    # ── Round 1: diverse templates ──
    specs = layouts.generate_candidates(photos, theme)
    renders = [render(s, photos) for s in specs]
    thumbs = [thumbnail(r) for r in renders]
    scores = score_candidates(specs, thumbs, photos, theme, template=template)
    ranked = sorted(zip(specs, renders, scores), key=lambda t: -t[2]["score"])
    log["rounds"].append({"round": 1, "scores": scores})

    best_spec, best_render, best_score = ranked[0]

    # ── Rounds 2..MAX_ROUNDS: critique-guided refinement of the winner ──
    for round_no in range(2, MAX_ROUNDS + 1):
        variants = _mutate(best_spec, photos, theme, config.ROUND2_VARIANTS,
                           reason=best_score.get("reason", ""), round_no=round_no)
        if not variants:
            break
        v_renders = [render(s, photos) for s in variants]
        v_thumbs = [thumbnail(r) for r in v_renders]
        v_scores = score_candidates(variants, v_thumbs, photos, theme,
                                    template=template)
        log["rounds"].append({"round": round_no, "scores": v_scores})

        improved = False
        for spec, r, sc in zip(variants, v_renders, v_scores):
            if sc["score"] > best_score["score"]:
                best_spec, best_render, best_score = spec, r, sc
                improved = True
        if not improved:                      # local optimum — stop early
            break

    log["winner"] = {"name": best_spec["name"], "score": best_score["score"],
                     "judge": best_score["judge"], "rounds_run": len(log["rounds"])}
    return best_spec, best_render, log
