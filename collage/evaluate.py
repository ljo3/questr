"""Score candidate collages. Claude vision judges them holistically when a key
is present; otherwise a deterministic heuristic scores composition so the loop
still runs offline."""
import string

from . import vision

JUDGE_PROMPT = (
    "You are judging candidate photo collages for a travel journal titled "
    '"{title}" (mood: {mood}). Score each candidate 0-100 on: how well the '
    "layout suits these photos, visual balance, how little important content "
    "is cropped, and overall aesthetic appeal.\n"
    "Respond with ONLY a JSON array, one object per candidate in order:\n"
    '[{{"label": "A", "score": 0-100, "reason": "<terse>"}}, ...]'
)


def _crop_retained(cell_box, img) -> float:
    """Fraction of the source photo still visible after cover-cropping into the
    cell (1.0 = no crop). Rewards matching cell/photo aspect ratios."""
    _, _, w, h = cell_box
    cell_ar = w / h
    src_ar = img.width / img.height
    return min(cell_ar / src_ar, src_ar / cell_ar)


def heuristic_score(spec: dict, photos, theme: dict) -> float:
    total_area = sum(c["box"][2] * c["box"][3] for c in spec["cells"]) or 1
    retained = sum(
        _crop_retained(c["box"], photos[c["photo"]]) * c["box"][2] * c["box"][3]
        for c in spec["cells"]
    ) / total_area
    score = 55 + retained * 40                     # 55-95 band
    if spec["name"] == theme.get("layout_hint"):
        score += 4
    return round(min(100, score), 1)


def score_candidates(specs, renders, photos, theme) -> list[dict]:
    """Return [{label, name, score, reason}] aligned with `specs`."""
    labels = list(string.ascii_uppercase)[: len(specs)]

    result = vision.ask(
        [render.copy() for render in renders],
        JUDGE_PROMPT.format(title=theme.get("title", ""), mood=theme.get("mood", "")),
        labels=[f"Candidate {l}:" for l in labels],
        max_edge=560,
        max_tokens=600,
    )

    scored = []
    if isinstance(result, list) and len(result) >= len(specs):
        by_label = {str(r.get("label")).strip().upper()[:1]: r for r in result
                    if isinstance(r, dict)}
        for label, spec in zip(labels, specs):
            r = by_label.get(label, {})
            scored.append({
                "label": label, "name": spec["name"],
                "score": float(r.get("score", 0) or 0),
                "reason": r.get("reason", ""), "judge": "claude",
            })
        if any(s["score"] > 0 for s in scored):
            return scored

    # ── Heuristic fallback ──
    return [{
        "label": label, "name": spec["name"],
        "score": heuristic_score(spec, photos, theme),
        "reason": "composition heuristic", "judge": "heuristic",
    } for label, spec in zip(labels, specs)]
