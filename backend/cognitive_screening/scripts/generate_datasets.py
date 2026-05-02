"""Generate medical, cognitive, and fusion CSVs under cognitive_screening/assets/data/."""

from __future__ import annotations

import os

from cognitive_screening.data_generation.synthetic_medical import generate_medical
from cognitive_screening.data_generation.synthetic_cognitive import (
    generate_cognitive_and_match_medical,
    build_fusion_table,
)

_PKG_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(_PKG_ROOT, "assets", "data")


def main() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    n = 5000
    med = generate_medical(n=n, seed=42)
    cog = generate_cognitive_and_match_medical(med, seed=7)
    fusion = build_fusion_table(cog, med)

    med_path = os.path.join(DATA_DIR, "medical.csv")
    cog_path = os.path.join(DATA_DIR, "cognitive_session.csv")
    fusion_path = os.path.join(DATA_DIR, "fusion.csv")

    med_out = med.drop(columns=["H_clinical_risk", "R_report_risk", "I_imaging_risk"], errors="ignore")
    med.to_csv(med_path, index=False)
    med_out.to_csv(os.path.join(DATA_DIR, "medical_features_only.csv"), index=False)

    cog.to_csv(cog_path, index=False)
    fusion.to_csv(fusion_path, index=False)
    print("Wrote:", med_path, cog_path, fusion_path, "rows", len(med), len(cog), len(fusion))


if __name__ == "__main__":
    main()
