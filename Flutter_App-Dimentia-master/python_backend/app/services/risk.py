from __future__ import annotations

RISK_ORDER = {"low": 0.15, "medium": 0.45, "high": 0.75, "critical": 0.95}


def mapped_from_probability(p: float) -> str:
    if p < 0.25:
        return "low"
    if p < 0.5:
        return "medium"
    if p < 0.75:
        return "high"
    return "critical"


def mapped_from_label(label: str | None) -> str:
    if not label:
        return "medium"
    s = label.lower()
    if "non" in s or s == "low":
        return "low"
    if "very mild" in s or "mild" in s:
        return "medium"
    if "moderate" in s:
        return "high"
    if "critical" in s:
        return "critical"
    return "medium"


def hybrid_from_scores(
    clinical_prob: float | None,
    clinical_mapped: str | None,
    mri_mapped: str | None,
    w_clinical: float,
    w_mri: float,
) -> tuple[str, float]:
    c = clinical_prob
    if c is None:
        c = RISK_ORDER.get((clinical_mapped or "medium").lower(), 0.45)
    else:
        c = max(0.0, min(1.0, float(c)))

    m = RISK_ORDER.get((mri_mapped or "medium").lower(), 0.45)

    score = w_clinical * c + w_mri * m
    score = max(0.0, min(1.0, score))
    hybrid = mapped_from_probability(score)
    return hybrid, score
