"""The optimizer/evaluator loop.

Round 1  — render one candidate per template, let the evaluator score them,
            keep the winner.
Round 2  — mutate the winner (reorder photos, alt background, tighter/looser
            gaps), score again, keep the best overall.

Returns the best spec, its full-res render, and a log of everything tried so
the workflow can print a transparent trail.
"""
import random

from . import config, layouts
from .evaluate import score_candidates
from .render import render, thumbnail
from .theme import _luma


def _mutate(spec: dict, photos, theme: dict, n: int) -> list[dict]:
    """Produce `n` variations of a winning spec."""
    rnd = random.Random(len(spec["cells"]) * 7 + 1)
    gen = layouts.TEMPLATES[spec["name"]]
    variants = []

    # 1) reshuffle photo order
    order = list(range(len(photos)))
    rnd.shuffle(order)
    variants.append(gen(photos, theme, order=order))

    # 2) alternate background — flip light/dark for a different feel
    alt = gen(photos, theme)
    alt_bg = "#f2efe9" if _luma(alt["bg"]) < 130 else "#15151a"
    alt["bg"] = alt_bg
    alt["text_color"] = "#f5f3ef" if _luma(alt_bg) < 130 else "#1a1a1a"
    variants.append(alt)

    # 3) rounder corners (a cleaner, more modern look) — radius is read at
    #    render time, so this re-renders visibly (gap is baked into the boxes)
    rounder = gen(photos, theme)
    rounder["radius"] = spec.get("radius", 14) + 10
    variants.append(rounder)

    return variants[:n]


def optimize(photos, theme: dict):
    log = {"theme": theme, "rounds": []}

    # ── Round 1: diverse templates ──
    specs = layouts.generate_candidates(photos, theme)
    renders = [render(s, photos) for s in specs]
    thumbs = [thumbnail(r) for r in renders]
    scores = score_candidates(specs, thumbs, photos, theme)
    ranked = sorted(zip(specs, renders, scores), key=lambda t: -t[2]["score"])
    log["rounds"].append({"round": 1, "scores": scores})

    best_spec, best_render, best_score = ranked[0]

    # ── Round 2: refine the winner ──
    variants = _mutate(best_spec, photos, theme, config.ROUND2_VARIANTS)
    if variants:
        v_renders = [render(s, photos) for s in variants]
        v_thumbs = [thumbnail(r) for r in v_renders]
        v_scores = score_candidates(variants, v_thumbs, photos, theme)
        log["rounds"].append({"round": 2, "scores": v_scores})
        for spec, r, sc in zip(variants, v_renders, v_scores):
            if sc["score"] > best_score["score"]:
                best_spec, best_render, best_score = spec, r, sc

    log["winner"] = {"name": best_spec["name"], "score": best_score["score"],
                     "judge": best_score["judge"]}
    return best_spec, best_render, log
