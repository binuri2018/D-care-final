"""Summaries of recorded video activity sessions."""

from __future__ import annotations

from typing import Any


def make_video_activity_sample(
    timestamp: float,
    frame_index: int,
    behavior: dict[str, Any],
    live_state: dict[str, Any],
) -> dict[str, Any]:
    return {
        "t": timestamp,
        "frame": frame_index,
        "risk": behavior.get("risk", "Normal"),
        "behavior_type": behavior.get("behavior_type", "Observation"),
        "behavior_reason": behavior.get("reason", ""),
        "action": live_state.get("current_action", "Unknown"),
        "confidence": live_state.get("current_confidence", 0.0),
        "pose_quality": live_state.get("pose_quality") or {},
        "capture_reason": live_state.get("capture_reason", ""),
    }


def build_video_activity_report(
    samples: list[dict[str, Any]],
    saved_count: int = 0,
    frame_count: int = 0,
    fps: float = 10.0,
    filename: str = "",
) -> dict[str, Any]:
    if not samples:
        return {
            "summary": {
                "filename": filename,
                "saved_count": saved_count,
                "frame_count": frame_count,
                "duration": 0.0,
                "abnormal_segments": 0,
                "medium_segments": 0,
            },
            "segments": [],
            "abnormal_segments": [],
        }

    duration = float(samples[-1]["t"] - samples[0]["t"]) + 1.0

    segments: list[dict[str, Any]] = []
    i = 0
    n = len(samples)
    while i < n:
        j = i
        while (
            j + 1 < n
            and samples[j + 1]["risk"] == samples[i]["risk"]
            and samples[j + 1]["behavior_type"] == samples[i]["behavior_type"]
        ):
            j += 1
        t0, t1 = samples[i]["t"], samples[j]["t"]
        seg = {
            "label": samples[i]["action"],
            "behavior_type": samples[i]["behavior_type"],
            "risk": samples[i]["risk"],
            "start": t0,
            "end": t1,
            "duration": max(0.0, t1 - t0),
            "frames": j - i + 1,
            "reason": samples[j].get("behavior_reason", ""),
        }
        if seg["risk"] in ("No reliable full-body pose",) or seg[
            "behavior_type"
        ] == "No reliable full-body pose":
            seg["label"] = "Uncertain posture"
        segments.append(seg)
        i = j + 1

    abnormal_out: list[dict[str, Any]] = []
    for seg in segments:
        if seg["risk"] != "High":
            continue
        if seg["label"] == "Uncertain posture":
            continue
        if seg["behavior_type"] == "No reliable full-body pose":
            continue
        abnormal_out.append(
            {
                "behavior_type": seg["behavior_type"],
                "label": seg["behavior_type"],
                "risk": seg["risk"],
                "duration": seg["duration"],
                "reason": seg.get("reason", ""),
            }
        )

    lying_total, lying_longest = _lying_metrics(samples)

    if lying_longest >= 6.0 or lying_total >= 6.0:
        sustained = {
            "behavior_type": "Sustained lying posture",
            "label": "Sustained lying posture",
            "risk": "Medium",
            "duration": max(lying_longest, lying_total) if lying_total >= 6.0 else lying_longest,
            "reason": "total lying posture duration exceeded threshold",
        }
        if lying_total >= 6.0 and lying_longest < 6.0:
            sustained["duration"] = lying_total
            sustained["reason"] = "total lying posture duration exceeded threshold"
        abnormal_out = [a for a in abnormal_out if a["behavior_type"] != "Sustained lying posture"]
        abnormal_out.append(sustained)

    uncertain_only = bool(segments) and all(
        s["risk"] in ("No reliable full-body pose",)
        or s["label"] == "Uncertain posture"
        for s in segments
    )
    high_count = sum(
        1
        for s in segments
        if s["risk"] == "High"
        and s["label"] != "Uncertain posture"
        and s["behavior_type"] != "No reliable full-body pose"
    )

    abnormal_segments = high_count
    if lying_longest >= 6.0 or lying_total >= 6.0:
        abnormal_segments = max(abnormal_segments, 1)

    medium_segments = sum(1 for s in segments if s["risk"] == "Medium")
    if any(a["behavior_type"] == "Sustained lying posture" for a in abnormal_out):
        medium_segments = max(medium_segments, 1)

    if uncertain_only:
        abnormal_segments = 0
        abnormal_out = []
        medium_segments = 0

    return {
        "summary": {
            "filename": filename,
            "saved_count": saved_count,
            "frame_count": frame_count,
            "duration": duration,
            "abnormal_segments": abnormal_segments,
            "medium_segments": medium_segments,
        },
        "segments": segments,
        "abnormal_segments": abnormal_out,
    }


def _lying_metrics(samples: list[dict[str, Any]]) -> tuple[float, float]:
    """Total time spent lying and longest continuous lying span using sample intervals."""
    if len(samples) < 2:
        return 0.0, 0.0
    total = 0.0
    longest_run = 0.0
    run = 0.0
    for i in range(len(samples) - 1):
        dt = max(0.0, samples[i + 1]["t"] - samples[i]["t"])
        if samples[i]["action"] == "Lying Down":
            total += dt
            run += dt
            longest_run = max(longest_run, run)
        else:
            run = 0.0
    if samples[-1]["action"] == "Lying Down":
        longest_run = max(longest_run, run)
    return total, longest_run
