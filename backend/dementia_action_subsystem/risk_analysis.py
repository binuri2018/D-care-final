"""Temporal risk analysis from pose / action history (wandering, falls, restlessness)."""

from __future__ import annotations

from collections import deque
from typing import Any

from dementia_action_subsystem.config import (
    MIN_PACING_WALKING_DENSITY,
    RISK_THRESHOLDS,
)


def _sorted_history(history: deque) -> list[dict[str, Any]]:
    return sorted(history, key=lambda x: x["timestamp"])


def analyze_wandering_risk(
    history: deque,
    now: float,
    window_start: float,
    use_exit_zone: bool,
    edge_threshold: float,
) -> dict[str, Any]:
    """Analyze deque of {timestamp, center, action, confidence}."""
    rows = _sorted_history(history)
    if not rows:
        return _normal()

    edge = float(edge_threshold)
    pacing_win = float(RISK_THRESHOLDS["pacing_window_seconds"])
    t_cut = now - pacing_win

    recent = [r for r in rows if r["timestamp"] >= t_cut]
    if not recent:
        recent = rows[-24:]

    centers = [tuple(r["center"]) for r in recent]
    actions = [r["action"] for r in recent]
    times = [r["timestamp"] for r in recent]

    walking_duration = sum(
        max(0.0, times[i + 1] - times[i])
        for i in range(len(times) - 1)
        if actions[i] == "Walking"
    )
    total_span = max(0.001, times[-1] - times[0]) if len(times) > 1 else 0.0
    walking_density = (
        sum(1 for a in actions if a == "Walking") / max(1, len(actions))
    )

    direction_change_count = _count_direction_changes(recent)

    exit_zone_time = 0.0
    if use_exit_zone:
        exit_zone_time = _exit_zone_tail_seconds(recent, edge)

    sit_stand_repetition_count = _count_sit_stand_reps(
        recent, RISK_THRESHOLDS["restlessness_min_dwell_sec"]
    )

    long_lying_after_fall = _long_lying_after_fall_seconds(rows, now)

    lying_duration = _lying_streak_at_end(recent)

    pacing_score = min(
        100,
        int(direction_change_count * 8 + walking_duration * 2),
    )

    risk_signals: list[str] = []

    upright_fall = _detect_upright_to_lying_fall(recent)
    if upright_fall:
        risk_signals.append("upright-to-lying-fall-transition")

    # Priority stack (first match wins for behavior_type when High)
    if upright_fall:
        return _high(
            "Fall Down",
            "rapid upright-to-lying transition",
            direction_change_count=direction_change_count,
            walking_duration=walking_duration,
            exit_zone_time=exit_zone_time,
            sit_stand_repetition_count=sit_stand_repetition_count,
            long_lying_after_fall=long_lying_after_fall,
            lying_duration=lying_duration,
            pacing_score=pacing_score,
            walking_density=walking_density,
            risk_signals=risk_signals,
        )

    if long_lying_after_fall >= RISK_THRESHOLDS["long_lying_after_fall_seconds"]:
        return _high(
            "Long lying after fall",
            "prolonged immobility after fall detection",
            direction_change_count=direction_change_count,
            walking_duration=walking_duration,
            exit_zone_time=exit_zone_time,
            sit_stand_repetition_count=sit_stand_repetition_count,
            long_lying_after_fall=long_lying_after_fall,
            lying_duration=lying_duration,
            pacing_score=pacing_score,
            walking_density=walking_density,
            risk_signals=risk_signals,
        )

    if (
        use_exit_zone
        and exit_zone_time >= RISK_THRESHOLDS["exit_zone_seconds"]
        and _currently_at_edge(recent, edge)
    ):
        return _high(
            "Exit-zone risk",
            f"near exit zone for {exit_zone_time:.0f}s",
            direction_change_count=direction_change_count,
            walking_duration=walking_duration,
            exit_zone_time=exit_zone_time,
            sit_stand_repetition_count=sit_stand_repetition_count,
            long_lying_after_fall=long_lying_after_fall,
            lying_duration=lying_duration,
            pacing_score=pacing_score,
            walking_density=walking_density,
            risk_signals=risk_signals,
        )

    min_dir = RISK_THRESHOLDS["pacing_direction_changes"]
    if (
        direction_change_count >= min_dir
        and walking_duration >= 12.0
        and walking_density >= MIN_PACING_WALKING_DENSITY
    ):
        return _high(
            "Pacing / wandering",
            f"pacing for {walking_duration:.0f}s with {direction_change_count} direction changes",
            direction_change_count=direction_change_count,
            walking_duration=walking_duration,
            exit_zone_time=exit_zone_time,
            sit_stand_repetition_count=sit_stand_repetition_count,
            long_lying_after_fall=long_lying_after_fall,
            lying_duration=lying_duration,
            pacing_score=pacing_score,
            walking_density=walking_density,
            risk_signals=risk_signals,
        )

    rep_high = int(RISK_THRESHOLDS["restlessness_reps_high"])
    if sit_stand_repetition_count >= rep_high:
        return _high(
            "Restlessness",
            f"{sit_stand_repetition_count} sit-stand repetitions",
            direction_change_count=direction_change_count,
            walking_duration=walking_duration,
            exit_zone_time=exit_zone_time,
            sit_stand_repetition_count=sit_stand_repetition_count,
            long_lying_after_fall=long_lying_after_fall,
            lying_duration=lying_duration,
            pacing_score=pacing_score,
            walking_density=walking_density,
            risk_signals=risk_signals,
        )

    if lying_duration >= RISK_THRESHOLDS["sustained_lying_seconds"]:
        return _high(
            "Sustained lying posture",
            "lying posture sustained beyond threshold",
            direction_change_count=direction_change_count,
            walking_duration=walking_duration,
            exit_zone_time=exit_zone_time,
            sit_stand_repetition_count=sit_stand_repetition_count,
            long_lying_after_fall=long_lying_after_fall,
            lying_duration=lying_duration,
            pacing_score=pacing_score,
            walking_density=walking_density,
            risk_signals=risk_signals,
        )

    return _normal(
        direction_change_count=direction_change_count,
        walking_duration=walking_duration,
        exit_zone_time=exit_zone_time,
        sit_stand_repetition_count=sit_stand_repetition_count,
        long_lying_after_fall=long_lying_after_fall,
        lying_duration=lying_duration,
        pacing_score=pacing_score,
        walking_density=walking_density,
        risk_signals=risk_signals,
    )


def _normal(**kwargs: Any) -> dict[str, Any]:
    base = {
        "risk": "Normal",
        "reason": "Normal movement or posture.",
        "behavior_type": "Observation",
        "walking_duration": 0.0,
        "direction_change_count": 0,
        "pacing_score": 0,
        "sit_stand_repetition_count": 0,
        "long_lying_after_fall": 0.0,
        "exit_zone_time": 0.0,
        "lying_duration": 0.0,
        "walking_density": 0.0,
        "risk_signals": [],
    }
    base.update(kwargs)
    return base


def _high(behavior: str, reason: str, **kwargs: Any) -> dict[str, Any]:
    return _normal(**kwargs) | {"risk": "High", "behavior_type": behavior, "reason": reason}


def _count_direction_changes(recent: list[dict[str, Any]]) -> int:
    prev_sign = None
    prev_x = None
    prev_t = None
    changes = 0
    min_delta = 0.02
    min_dt = 0.35
    for r in recent:
        if r["action"] != "Walking":
            prev_x = None
            continue
        cx = float(r["center"][0])
        t = float(r["timestamp"])
        if prev_x is not None and (t - prev_t) >= min_dt:
            dx = cx - prev_x
            if abs(dx) >= min_delta:
                s = 1 if dx > 0 else -1
                if prev_sign is not None and s != prev_sign:
                    changes += 1
                prev_sign = s
        prev_x = cx
        prev_t = t
    return changes


def _currently_at_edge(recent: list[dict[str, Any]], edge: float) -> bool:
    if not recent:
        return False
    cx = float(recent[-1]["center"][0])
    return cx <= edge or cx >= 1.0 - edge


def _exit_zone_tail_seconds(recent: list[dict[str, Any]], edge: float) -> float:
    if not recent or not _currently_at_edge(recent, edge):
        return 0.0
    acc = 0.0
    for i in range(len(recent) - 1, 0, -1):
        cx = float(recent[i]["center"][0])
        if cx > edge and cx < 1.0 - edge:
            break
        acc += max(0.0, recent[i]["timestamp"] - recent[i - 1]["timestamp"])
    return acc


def _count_sit_stand_reps(
    recent: list[dict[str, Any]], min_dwell: float
) -> int:
    reps = 0
    prev_action: str | None = None
    last_rep_t: float | None = None
    for r in recent:
        a = r["action"]
        if a not in ("Sitting", "Standing"):
            continue
        t = float(r["timestamp"])
        if prev_action is not None and a != prev_action:
            if last_rep_t is None or (t - last_rep_t) >= min_dwell:
                reps += 1
                last_rep_t = t
        prev_action = a
    return reps


def _long_lying_after_fall_seconds(rows: list[dict[str, Any]], now: float) -> float:
    fall_t = None
    for r in rows:
        if r["action"] == "Fall Down":
            fall_t = float(r["timestamp"])
    if fall_t is None:
        return 0.0
    lying = 0.0
    for i in range(len(rows) - 1):
        if rows[i]["timestamp"] < fall_t:
            continue
        if rows[i]["action"] == "Lying Down":
            lying += max(0.0, rows[i + 1]["timestamp"] - rows[i]["timestamp"])
    return lying


def _lying_streak_at_end(recent: list[dict[str, Any]]) -> float:
    if not recent or recent[-1]["action"] != "Lying Down":
        return 0.0
    dur = 0.0
    for i in range(len(recent) - 1, 0, -1):
        if recent[i]["action"] != "Lying Down":
            break
        dur += max(0.0, recent[i]["timestamp"] - recent[i - 1]["timestamp"])
    return dur


def _detect_upright_to_lying_fall(recent: list[dict[str, Any]]) -> bool:
    win = RISK_THRESHOLDS["fall_transition_window_sec"]
    drop = RISK_THRESHOLDS["lying_vertical_drop"]
    if len(recent) < 2:
        return False
    tail = [r for r in recent if r["timestamp"] >= recent[-1]["timestamp"] - win]
    upright = {"Standing", "Walking"}
    for i in range(len(tail) - 1):
        if tail[i + 1]["action"] != "Lying Down":
            continue
        if tail[i]["action"] not in upright:
            continue
        y0 = float(tail[i]["center"][1])
        y1 = float(tail[i + 1]["center"][1])
        if (y1 - y0) >= drop:
            return True
    return False
