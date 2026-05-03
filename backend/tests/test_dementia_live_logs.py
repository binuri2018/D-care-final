"""Live risk event log and caregiver alert log behavior."""

import unittest
from collections import deque

import dementia_action_subsystem.app_compat as app
from dementia_action_subsystem.live_logs import (
    append_caregiver_alert_log,
    append_live_risk_event,
    list_caregiver_alert_log,
    list_live_risk_events,
    reset_live_logs_for_tests,
)


class LiveRiskEventLogTests(unittest.TestCase):
    def setUp(self):
        reset_live_logs_for_tests()

    def tearDown(self):
        reset_live_logs_for_tests()

    def test_normal_risk_not_logged(self):
        append_live_risk_event(1000.0, "Normal", "Standing", "ok")
        self.assertEqual(list_live_risk_events(), [])

    def test_medium_and_high_logged(self):
        append_live_risk_event(1000.0, "Medium", "Lying Down", "approaching threshold")
        append_live_risk_event(1001.0, "High", "Walking", "exit zone")
        events = list_live_risk_events()
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["risk"], "High")
        self.assertEqual(events[1]["risk"], "Medium")

    def test_dedup_within_ten_seconds(self):
        append_live_risk_event(1000.0, "High", "Walking", "same")
        append_live_risk_event(1005.0, "High", "Walking", "same")
        self.assertEqual(len(list_live_risk_events()), 1)

    def test_dedup_respects_time_gap(self):
        append_live_risk_event(1000.0, "High", "Walking", "same")
        append_live_risk_event(1011.0, "High", "Walking", "same")
        self.assertEqual(len(list_live_risk_events()), 2)

    def test_max_ten_events(self):
        for i in range(15):
            append_live_risk_event(2000.0 + i * 11, "High", "Walking", f"r{i}")
        self.assertEqual(len(list_live_risk_events()), 10)


class CaregiverAlertLogTests(unittest.TestCase):
    def setUp(self):
        reset_live_logs_for_tests()

    def tearDown(self):
        reset_live_logs_for_tests()

    def test_max_eight_rows(self):
        for i in range(10):
            append_caregiver_alert_log(
                ts=3000.0 + i,
                incident_id=f"inc_{i:012x}"[:15],
                behavior="B",
                severity="High",
                email_dispatch={"sent": True},
            )
        self.assertEqual(len(list_caregiver_alert_log()), 8)


class MediumLyingRiskTests(unittest.TestCase):
    def test_prolonged_lying_is_medium_before_sustained_high(self):
        history = deque()
        now = 1000.0
        for idx in range(10):
            history.append(
                {
                    "timestamp": now - 9 + float(idx),
                    "center": (0.5, 0.7),
                    "action": "Lying Down",
                    "confidence": 0.86,
                }
            )
        behavior = app.analyze_wandering_risk(history, now, now, False, 0.15)
        self.assertEqual(behavior["risk"], "Medium")
        self.assertIn("Prolonged lying", behavior["behavior_type"])
