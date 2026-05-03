import json
import tempfile
import unittest
from collections import deque
from pathlib import Path

import numpy as np

import dementia_action_subsystem.app_compat as app
import dementia_action_subsystem.config as dac_config


def make_frames(count=6):
    frames = []
    for idx in range(count):
        frame = np.full((64, 64, 3), idx * 25, dtype=np.uint8)
        frames.append((1000.0 + idx * 0.1, frame))
    return frames


def make_pose_keypoints(posture):
    kpts = np.zeros((17, 2), dtype=float)
    if posture == "standing":
        points = {
            5: (0.44, 0.25),
            6: (0.56, 0.25),
            7: (0.40, 0.44),
            8: (0.60, 0.44),
            11: (0.46, 0.50),
            12: (0.54, 0.50),
            13: (0.46, 0.70),
            14: (0.54, 0.70),
            15: (0.46, 0.90),
            16: (0.54, 0.90),
        }
    elif posture == "sitting":
        points = {
            5: (0.44, 0.25),
            6: (0.56, 0.25),
            7: (0.40, 0.44),
            8: (0.60, 0.44),
            11: (0.46, 0.55),
            12: (0.54, 0.55),
            13: (0.38, 0.62),
            14: (0.62, 0.62),
            15: (0.34, 0.80),
            16: (0.66, 0.80),
        }
    elif posture == "lying":
        points = {
            5: (0.22, 0.50),
            6: (0.32, 0.54),
            7: (0.18, 0.58),
            8: (0.35, 0.60),
            11: (0.62, 0.56),
            12: (0.72, 0.58),
            13: (0.82, 0.57),
            14: (0.86, 0.61),
            15: (0.92, 0.56),
            16: (0.94, 0.62),
        }
    else:
        points = {}
    for idx, point in points.items():
        kpts[idx] = point
    return kpts


def make_incident_row():
    return {
        "Id": "incident_1",
        "Time": "2026-05-01 10:00:00",
        "Severity": "High",
        "BehaviorType": "Exit-zone risk",
        "Action": "Walking",
        "Confidence": "0.91",
        "Reason": "near exit zone for 6s",
        "Metrics": {
            "walking_duration": 7.0,
            "direction_change_count": 1,
            "sit_stand_repetition_count": 0,
            "lying_duration": 0.0,
            "exit_zone_time": 6.0,
        },
    }


class FakeSMTP:
    sent_messages = []

    def __init__(self, host, port, timeout=10):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.started_tls = False
        self.logged_in = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def starttls(self):
        self.started_tls = True

    def login(self, username, password):
        self.logged_in = True

    def send_message(self, message):
        FakeSMTP.sent_messages.append(message)


class ActionIncidentPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_dir = dac_config.ACTION_INCIDENT_DIR
        dac_config.ACTION_INCIDENT_DIR = self.temp_dir.name

    def tearDown(self):
        dac_config.ACTION_INCIDENT_DIR = self.original_dir
        self.temp_dir.cleanup()

    def test_save_action_incident_writes_snapshot_clip_and_rich_metadata(self):
        frames = make_frames()
        metrics = {
            "walking_duration": 24.0,
            "direction_change_count": 11,
            "pacing_score": 92,
            "sit_stand_repetition_count": 1,
            "long_lying_after_fall": 0.0,
            "exit_zone_time": 3.0,
        }

        incident = app.save_action_incident(
            frame_buffer=frames,
            trigger_frame=frames[-1][1],
            detected_action="Walking",
            confidence=0.88,
            reason="pacing for 24s with 11 direction changes",
            behavior_type="Pacing / wandering",
            severity="High",
            metrics=metrics,
            now=1000.5,
        )

        self.assertEqual(incident["Label"], app.ACTION_INCIDENT_LABEL)
        self.assertEqual(incident["BehaviorType"], "Pacing / wandering")
        self.assertEqual(incident["Severity"], "High")
        self.assertEqual(incident["Action"], "Walking")
        self.assertEqual(incident["Confidence"], "0.88")
        self.assertEqual(incident["Metrics"], metrics)
        self.assertIn("SnapshotUrl", incident)
        self.assertIn("/api/dementia-action/incident-asset/", incident["SnapshotUrl"])

        snapshot_path = Path(incident["SnapshotPath"])
        clip_path = Path(incident["ClipPath"])
        metadata_path = Path(incident["MetadataPath"])

        self.assertTrue(snapshot_path.exists())
        self.assertGreater(snapshot_path.stat().st_size, 0)
        self.assertTrue(clip_path.exists())
        self.assertGreater(clip_path.stat().st_size, 0)
        self.assertTrue(metadata_path.exists())

        saved_metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        self.assertEqual(saved_metadata["label"], app.ACTION_INCIDENT_LABEL)
        self.assertEqual(saved_metadata["behavior_type"], "Pacing / wandering")
        self.assertEqual(saved_metadata["severity"], "High")
        self.assertAlmostEqual(saved_metadata["confidence"], 0.88)
        self.assertEqual(saved_metadata["metrics"], metrics)
        self.assertIn("snapshot_url", saved_metadata)
        self.assertIn("/api/dementia-action/incident-asset/", saved_metadata["snapshot_url"])

    def test_load_recent_action_incidents_orders_newest_first(self):
        frames = make_frames()
        older = app.save_action_incident(
            frames,
            frames[-1][1],
            "Walking",
            0.7,
            "near exit zone for 7s",
            "Exit-zone risk",
            "Medium",
            {"exit_zone_time": 7.0},
            now=1000.0,
        )
        newer = app.save_action_incident(
            frames,
            frames[-1][1],
            "Fall Down",
            0.95,
            "Fall Down action detected.",
            "Fall Down",
            "High",
            {},
            now=1010.0,
        )

        recent = app.load_recent_action_incidents(limit=2)

        self.assertEqual([row["Id"] for row in recent], [newer["Id"], older["Id"]])

    def test_legacy_fallback_metadata_is_still_readable(self):
        metadata_path = Path(dac_config.ACTION_INCIDENT_DIR) / "fallback_legacy.json"
        snapshot_path = Path(dac_config.ACTION_INCIDENT_DIR) / "fallback_legacy.jpg"
        clip_path = Path(dac_config.ACTION_INCIDENT_DIR) / "fallback_legacy.mp4"
        snapshot_path.write_bytes(b"snapshot")
        clip_path.write_bytes(b"clip")
        metadata_path.write_text(
            json.dumps(
                {
                    "id": "fallback_legacy",
                    "timestamp": 999.0,
                    "display_time": "2026-01-01 10:00:00",
                    "label": app.FALLBACK_INCIDENT_LABEL,
                    "detected_action": "Fall Down",
                    "confidence": 0.91,
                    "reason": "lying after fall for 10s",
                    "snapshot_path": str(snapshot_path),
                    "clip_path": str(clip_path),
                }
            ),
            encoding="utf-8",
        )

        recent = app.load_recent_action_incidents(limit=1)

        self.assertEqual(recent[0]["BehaviorType"], "Fall Down")
        self.assertEqual(recent[0]["Severity"], "High")
        self.assertEqual(recent[0]["Label"], app.FALLBACK_INCIDENT_LABEL)

    def test_save_fallback_incident_wrapper_keeps_old_label(self):
        frames = make_frames()

        incident = app.save_fallback_incident(
            frame_buffer=frames,
            fall_frame=frames[-1][1],
            detected_action="Fall Down",
            confidence=0.91,
            reason="lying after fall for 10s",
            now=1000.5,
        )

        self.assertEqual(incident["Label"], app.FALLBACK_INCIDENT_LABEL)
        self.assertEqual(incident["BehaviorType"], "Fall Down")
        self.assertEqual(incident["Severity"], "High")


class CaregiverAlertTests(unittest.TestCase):
    def setUp(self):
        FakeSMTP.sent_messages = []

    def test_caregiver_alert_message_contains_incident_details(self):
        subject, body = app.build_caregiver_alert_message(make_incident_row())

        self.assertIn("High", subject)
        self.assertIn("Exit-zone risk", subject)
        self.assertIn("near exit zone", body)
        self.assertIn("Walking", body)
        self.assertIn("Exit-zone 6s", body)

    def test_caregiver_alert_message_includes_pose_when_present(self):
        row = make_incident_row()
        row["Metrics"] = {
            **row["Metrics"],
            "pose_posture": "Sitting",
            "pose_visible_keypoints": 12,
            "pose_reliable": True,
            "pose_quality_score": 0.74,
            "fusion_reason": "LSTM accepted.",
        }
        _, body = app.build_caregiver_alert_message(row)
        self.assertIn("Pose posture: Sitting", body)
        self.assertIn("Keypoints visible: 12/17", body)
        self.assertIn("Pose reliable: True", body)
        self.assertIn("Fusion: LSTM accepted.", body)

    def test_email_alert_is_optional_without_recipient(self):
        result = app.send_caregiver_email_alert(
            make_incident_row(),
            env={},
            smtp_factory=FakeSMTP,
        )

        self.assertFalse(result["sent"])
        self.assertEqual(result["status"], "disabled")
        self.assertIn("browser alert only", result["reason"])
        self.assertEqual(FakeSMTP.sent_messages, [])

    def test_email_alert_reports_browser_only_when_smtp_is_missing(self):
        result = app.send_caregiver_email_alert(
            make_incident_row(),
            recipient_email="caregiver@example.com",
            env={},
            smtp_factory=FakeSMTP,
        )

        self.assertFalse(result["sent"])
        self.assertEqual(result["status"], "not_configured")
        self.assertIn("SMTP host", result["reason"])
        self.assertIn("sender email", result["reason"])
        self.assertEqual(FakeSMTP.sent_messages, [])

    def test_email_alert_sends_with_ui_config_override(self):
        result = app.send_caregiver_email_alert(
            make_incident_row(),
            recipient_email="caregiver@example.com",
            env={},
            config_override={
                "host": "smtp.example.com",
                "port": 587,
                "from_email": "alerts@example.com",
                "username": "alerts@example.com",
                "password": "secret",
                "use_tls": True,
                "use_ssl": False,
            },
            smtp_factory=FakeSMTP,
        )

        self.assertTrue(result["sent"])
        self.assertEqual(result["status"], "sent")
        self.assertEqual(len(FakeSMTP.sent_messages), 1)

    def test_email_alert_sends_with_smtp_config(self):
        env = {
            "SMTP_HOST": "smtp.example.com",
            "SMTP_PORT": "587",
            "SMTP_FROM_EMAIL": "alerts@example.com",
            "SMTP_USERNAME": "alerts@example.com",
            "SMTP_PASSWORD": "secret",
            "SMTP_USE_TLS": "true",
        }

        result = app.send_caregiver_email_alert(
            make_incident_row(),
            recipient_email="caregiver@example.com",
            env=env,
            smtp_factory=FakeSMTP,
        )

        self.assertTrue(result["sent"])
        self.assertEqual(result["status"], "sent")
        self.assertEqual(len(FakeSMTP.sent_messages), 1)
        self.assertEqual(FakeSMTP.sent_messages[0]["To"], "caregiver@example.com")
        self.assertIn("Dementia Care Alert", FakeSMTP.sent_messages[0]["Subject"])


class VideoActivityReportTests(unittest.TestCase):
    def make_sample(self, timestamp, action, risk="Normal", behavior_type="Observation"):
        behavior = {
            "risk": risk,
            "behavior_type": behavior_type,
            "reason": "normal" if risk == "Normal" else f"{behavior_type} detected",
        }
        live_state = {
            "current_action": action,
            "current_confidence": 0.86,
            "pose_quality": {"score": 0.8},
            "capture_reason": "Watching",
        }
        return app.make_video_activity_sample(timestamp, int(timestamp * 10), behavior, live_state)

    def test_video_activity_report_groups_actions_and_abnormal_segments(self):
        samples = [
            self.make_sample(0.0, "Standing"),
            self.make_sample(1.0, "Standing"),
            self.make_sample(2.0, "Walking"),
            self.make_sample(3.0, "Walking"),
            self.make_sample(4.0, "Sitting", "High", "Restlessness"),
            self.make_sample(5.0, "Standing", "High", "Restlessness"),
        ]

        report = app.build_video_activity_report(
            samples,
            saved_count=1,
            frame_count=60,
            fps=10.0,
            filename="demo.mp4",
        )

        self.assertEqual(report["summary"]["filename"], "demo.mp4")
        self.assertEqual(report["summary"]["saved_count"], 1)
        self.assertEqual(report["summary"]["abnormal_segments"], 1)
        self.assertEqual(report["abnormal_segments"][0]["behavior_type"], "Restlessness")
        self.assertEqual(report["abnormal_segments"][0]["label"], "Restlessness")
        self.assertGreaterEqual(report["summary"]["duration"], 6.0)

    def test_no_reliable_pose_is_reported_but_not_abnormal(self):
        samples = [
            self.make_sample(0.0, "Unknown", "No reliable full-body pose", "No reliable full-body pose"),
            self.make_sample(1.0, "Unknown", "No reliable full-body pose", "No reliable full-body pose"),
        ]

        report = app.build_video_activity_report(samples)

        self.assertEqual(report["summary"]["abnormal_segments"], 0)
        self.assertEqual(report["segments"][0]["label"], "Uncertain posture")

    def test_video_report_infers_sustained_lying_segment(self):
        samples = [
            self.make_sample(float(idx), "Lying Down")
            for idx in range(7)
        ]

        report = app.build_video_activity_report(samples)

        self.assertEqual(report["summary"]["abnormal_segments"], 1)
        self.assertEqual(report["summary"]["medium_segments"], 1)
        self.assertEqual(report["abnormal_segments"][0]["behavior_type"], "Sustained lying posture")
        self.assertEqual(report["abnormal_segments"][0]["risk"], "Medium")

    def test_video_report_infers_sustained_lying_across_split_risk_states(self):
        samples = [
            self.make_sample(float(idx), "Lying Down", "Uncertain" if idx < 3 else "Normal")
            for idx in range(7)
        ]

        report = app.build_video_activity_report(samples)

        self.assertEqual(report["summary"]["abnormal_segments"], 1)
        self.assertEqual(report["abnormal_segments"][0]["behavior_type"], "Sustained lying posture")
        self.assertGreaterEqual(report["abnormal_segments"][0]["duration"], 6.0)

    def test_video_report_infers_medium_risk_from_total_lying_duration(self):
        samples = [
            self.make_sample(0.0, "Lying Down"),
            self.make_sample(3.3, "Sitting"),
            self.make_sample(4.3, "Lying Down"),
            self.make_sample(7.6, "Sitting"),
        ]

        report = app.build_video_activity_report(samples)

        self.assertEqual(report["summary"]["abnormal_segments"], 1)
        self.assertEqual(report["summary"]["medium_segments"], 1)
        self.assertEqual(report["abnormal_segments"][0]["behavior_type"], "Sustained lying posture")
        self.assertEqual(report["abnormal_segments"][0]["duration"], 6.6)
        self.assertIn("total lying posture", report["abnormal_segments"][0]["reason"])


class ActionRiskAnalysisTests(unittest.TestCase):
    def test_pacing_wandering_becomes_high_risk(self):
        history = deque()
        now = 1000.0
        x_positions = [0.2, 0.8] * 7
        for idx, x_pos in enumerate(x_positions):
            history.append(
                {
                    "timestamp": now - len(x_positions) + idx,
                    "center": (x_pos, 0.5),
                    "action": "Walking",
                    "confidence": 0.85,
                }
            )

        behavior = app.analyze_wandering_risk(history, now, now, True, 0.15)

        self.assertEqual(behavior["risk"], "High")
        self.assertEqual(behavior["behavior_type"], "Pacing / wandering")
        self.assertGreaterEqual(behavior["direction_change_count"], 5)

    def test_sparse_walking_turns_do_not_become_pacing(self):
        history = deque()
        now = 1000.0
        for idx in range(24):
            is_walk = idx % 2 == 0
            history.append(
                {
                    "timestamp": now - 24 + idx,
                    "center": ((0.2, 0.8)[(idx // 2) % 2], 0.5),
                    "action": "Walking" if is_walk else "Standing",
                    "confidence": 0.85,
                }
            )

        behavior = app.analyze_wandering_risk(history, now, now, True, 0.15)

        self.assertNotEqual(behavior["risk"], "High")
        self.assertNotEqual(behavior["behavior_type"], "Pacing / wandering")
        self.assertLess(behavior["walking_density"], app.MIN_PACING_WALKING_DENSITY)

    def test_exit_zone_risk_is_detected(self):
        history = deque()
        now = 1000.0
        for idx in range(7):
            history.append(
                {
                    "timestamp": now - 7 + idx,
                    "center": (0.04, 0.5),
                    "action": "Standing",
                    "confidence": 0.8,
                }
            )

        behavior = app.analyze_wandering_risk(history, now, now, True, 0.15)

        self.assertEqual(behavior["risk"], "High")
        self.assertEqual(behavior["behavior_type"], "Exit-zone risk")
        self.assertGreaterEqual(behavior["exit_zone_time"], 6)

    def test_exit_zone_requires_current_continuous_edge_presence(self):
        history = deque()
        now = 1000.0
        for idx in range(4):
            history.append(
                {
                    "timestamp": now - 12 + idx,
                    "center": (0.04, 0.5),
                    "action": "Standing",
                    "confidence": 0.8,
                }
            )
        for idx in range(5):
            history.append(
                {
                    "timestamp": now - 8 + idx,
                    "center": (0.5, 0.5),
                    "action": "Standing",
                    "confidence": 0.8,
                }
            )
        for idx in range(3):
            history.append(
                {
                    "timestamp": now - 3 + idx,
                    "center": (0.04, 0.5),
                    "action": "Standing",
                    "confidence": 0.8,
                }
            )

        behavior = app.analyze_wandering_risk(history, now, now, True, 0.15)

        self.assertNotEqual(behavior["risk"], "High")
        self.assertLess(behavior["exit_zone_time"], 6)

    def test_repeated_sit_stand_restlessness_is_detected(self):
        history = deque()
        now = 1000.0
        actions = ["Sitting", "Standing"] * 4
        for idx, action in enumerate(actions):
            history.append(
                {
                    "timestamp": now - len(actions) + idx,
                    "center": (0.5, 0.5),
                    "action": action,
                    "confidence": 0.8,
                }
            )

        behavior = app.analyze_wandering_risk(history, now, now, False, 0.15)

        self.assertEqual(behavior["risk"], "High")
        self.assertEqual(behavior["behavior_type"], "Restlessness")
        self.assertGreaterEqual(behavior["sit_stand_repetition_count"], 6)

    def test_fast_label_flicker_does_not_count_as_restlessness(self):
        history = deque()
        now = 1000.0
        actions = ["Sitting", "Standing"] * 8
        for idx, action in enumerate(actions):
            history.append(
                {
                    "timestamp": now - 4 + idx * 0.2,
                    "center": (0.5, 0.5),
                    "action": action,
                    "confidence": 0.8,
                }
            )

        behavior = app.analyze_wandering_risk(history, now, now, False, 0.15)

        self.assertNotEqual(behavior["risk"], "High")
        self.assertLess(behavior["sit_stand_repetition_count"], app.RISK_THRESHOLDS["restlessness_reps_high"])

    def test_long_lying_after_fall_is_detected(self):
        history = deque()
        now = 1000.0
        history.append(
            {
                "timestamp": now - 10,
                "center": (0.5, 0.7),
                "action": "Fall Down",
                "confidence": 0.91,
            }
        )
        for idx in range(9):
            history.append(
                {
                    "timestamp": now - 9 + idx,
                    "center": (0.5, 0.7),
                    "action": "Lying Down",
                    "confidence": 0.86,
                }
            )

        behavior = app.analyze_wandering_risk(history, now, now, False, 0.15)

        self.assertEqual(behavior["risk"], "High")
        self.assertEqual(behavior["behavior_type"], "Long lying after fall")
        self.assertGreaterEqual(behavior["long_lying_after_fall"], 8)

    def test_rapid_upright_to_lying_transition_is_detected_as_fall(self):
        history = deque()
        now = 1000.0
        samples = [
            (now - 3.5, (0.5, 0.41), "Standing"),
            (now - 3.0, (0.5, 0.42), "Standing"),
            (now - 2.2, (0.5, 0.44), "Standing"),
            (now - 1.3, (0.5, 0.64), "Lying Down"),
            (now - 0.5, (0.5, 0.72), "Lying Down"),
        ]
        for timestamp, center, action in samples:
            history.append(
                {
                    "timestamp": timestamp,
                    "center": center,
                    "action": action,
                    "confidence": 0.86,
                }
            )

        behavior = app.analyze_wandering_risk(history, now, now, False, 0.15)

        self.assertEqual(behavior["risk"], "High")
        self.assertEqual(behavior["behavior_type"], "Fall Down")
        self.assertIn("upright-to-lying-fall-transition", behavior["risk_signals"])

    def test_sit_down_to_lying_transition_is_not_fall(self):
        history = deque()
        now = 1000.0
        samples = [
            (now - 4.8, (0.5, 0.41), "Standing"),
            (now - 4.0, (0.5, 0.42), "Standing"),
            (now - 2.6, (0.5, 0.55), "Sit down"),
            (now - 1.6, (0.5, 0.58), "Sitting"),
            (now - 0.8, (0.5, 0.68), "Lying Down"),
        ]
        for timestamp, center, action in samples:
            history.append(
                {
                    "timestamp": timestamp,
                    "center": center,
                    "action": action,
                    "confidence": 0.86,
                }
            )

        behavior = app.analyze_wandering_risk(history, now, now, False, 0.15)

        self.assertNotEqual(behavior["behavior_type"], "Fall Down")
        self.assertNotIn("upright-to-lying-fall-transition", behavior["risk_signals"])

    def test_sustained_lying_posture_is_detected_without_fall_label(self):
        history = deque()
        now = 1000.0
        for idx in range(13):
            history.append(
                {
                    "timestamp": now - 13 + idx,
                    "center": (0.5, 0.7),
                    "action": "Lying Down",
                    "confidence": 0.86,
                }
            )

        behavior = app.analyze_wandering_risk(history, now, now, False, 0.15)

        self.assertEqual(behavior["risk"], "High")
        self.assertEqual(behavior["behavior_type"], "Sustained lying posture")
        self.assertGreaterEqual(behavior["lying_duration"], 12)

    def test_interrupted_lying_posture_does_not_count_as_sustained(self):
        history = deque()
        now = 1000.0
        for idx in range(10):
            history.append(
                {
                    "timestamp": now - 20 + idx,
                    "center": (0.5, 0.7),
                    "action": "Lying Down",
                    "confidence": 0.86,
                }
            )
        for idx in range(8):
            history.append(
                {
                    "timestamp": now - 8 + idx,
                    "center": (0.5, 0.5),
                    "action": "Standing",
                    "confidence": 0.86,
                }
            )

        behavior = app.analyze_wandering_risk(history, now, now, False, 0.15)

        self.assertEqual(behavior["lying_duration"], 0)
        self.assertNotEqual(behavior["behavior_type"], "Sustained lying posture")


class AbnormalCaptureGateTests(unittest.TestCase):
    def test_normal_walking_does_not_create_incident_candidate(self):
        behavior = {
            "risk": "Normal",
            "reason": "Normal movement or posture.",
            "behavior_type": "Observation",
            "walking_duration": 4.0,
            "direction_change_count": 0,
            "pacing_score": 8,
            "sit_stand_repetition_count": 0,
            "long_lying_after_fall": 0.0,
            "exit_zone_time": 0.0,
        }
        pose_quality = {"reliable": True, "score": 0.8, "visible_count": 14}

        trigger = app.build_incident_trigger(
            "Walking",
            0.92,
            behavior,
            pose_quality=pose_quality,
            confirmation_state={},
            now=1000.0,
        )

        self.assertIsNone(trigger)

    def test_high_risk_must_be_confirmed_before_triggering(self):
        behavior = {
            "risk": "High",
            "reason": "near exit zone for 12s",
            "behavior_type": "Exit-zone risk",
            "walking_duration": 0.0,
            "direction_change_count": 0,
            "pacing_score": 50,
            "sit_stand_repetition_count": 0,
            "long_lying_after_fall": 0.0,
            "exit_zone_time": 12.0,
        }
        pose_quality = {"reliable": True, "score": 0.84, "visible_count": 14}
        confirmation_state = {}

        first = app.build_incident_trigger(
            "Standing",
            0.88,
            behavior,
            pose_quality=pose_quality,
            confirmation_state=confirmation_state,
            now=1000.0,
        )
        confirmed = app.build_incident_trigger(
            "Standing",
            0.88,
            behavior,
            pose_quality=pose_quality,
            confirmation_state=confirmation_state,
            now=1003.0,
        )

        self.assertIsNone(first)
        self.assertIsNotNone(confirmed)
        self.assertEqual(confirmed["behavior_type"], "Exit-zone risk")
        self.assertIn("Confirmed", confirmed["reason"])

    def test_fall_down_confirmation_is_short(self):
        behavior = {
            "risk": "High",
            "reason": "rapid upright-to-lying transition",
            "behavior_type": "Fall Down",
            "walking_duration": 0.0,
            "direction_change_count": 0,
            "pacing_score": 0,
            "sit_stand_repetition_count": 0,
            "long_lying_after_fall": 0.0,
            "exit_zone_time": 0.0,
        }
        pose_quality = {"reliable": True, "score": 0.84, "visible_count": 14}
        confirmation_state = {}

        first = app.build_incident_trigger(
            "Fall Down",
            0.91,
            behavior,
            pose_quality=pose_quality,
            confirmation_state=confirmation_state,
            now=1000.0,
        )
        too_soon = app.build_incident_trigger(
            "Fall Down",
            0.91,
            behavior,
            pose_quality=pose_quality,
            confirmation_state=confirmation_state,
            now=1000.79,
        )
        confirmed = app.build_incident_trigger(
            "Fall Down",
            0.91,
            behavior,
            pose_quality=pose_quality,
            confirmation_state=confirmation_state,
            now=1000.81,
        )

        self.assertIsNone(first)
        self.assertIsNone(too_soon)
        self.assertIsNotNone(confirmed)
        self.assertEqual(confirmed["behavior_type"], "Fall Down")

    def test_restlessness_requires_twenty_second_confirmation(self):
        behavior = {
            "risk": "High",
            "reason": "7 sit-stand repetitions",
            "behavior_type": "Restlessness",
            "walking_duration": 0.0,
            "direction_change_count": 0,
            "pacing_score": 35,
            "sit_stand_repetition_count": 7,
            "long_lying_after_fall": 0.0,
            "exit_zone_time": 0.0,
        }
        pose_quality = {"reliable": True, "score": 0.84, "visible_count": 14}
        confirmation_state = {}

        early = app.build_incident_trigger(
            "Standing",
            0.88,
            behavior,
            pose_quality=pose_quality,
            confirmation_state=confirmation_state,
            now=1000.0,
        )
        almost_confirmed = app.build_incident_trigger(
            "Standing",
            0.88,
            behavior,
            pose_quality=pose_quality,
            confirmation_state=confirmation_state,
            now=1019.0,
        )
        confirmed = app.build_incident_trigger(
            "Standing",
            0.88,
            behavior,
            pose_quality=pose_quality,
            confirmation_state=confirmation_state,
            now=1020.0,
        )

        self.assertIsNone(early)
        self.assertIsNone(almost_confirmed)
        self.assertIsNotNone(confirmed)
        self.assertEqual(confirmed["behavior_type"], "Restlessness")

    def test_partial_body_pose_rejects_abnormal_candidate(self):
        kpts = np.zeros((17, 2), dtype=float)
        for idx in [0, 1, 2, 5, 6]:
            kpts[idx] = [0.5, 0.3]
        quality = app.score_pose_quality(
            kpts,
            confidences=np.full(17, 0.9, dtype=float),
            bbox=(0.2, 0.1, 0.8, 0.7),
            box_confidence=0.9,
        )
        behavior = {
            "risk": "High",
            "reason": "pacing for 24s with 11 direction changes",
            "behavior_type": "Pacing / wandering",
            "walking_duration": 24.0,
            "direction_change_count": 11,
            "pacing_score": 92,
            "sit_stand_repetition_count": 0,
            "long_lying_after_fall": 0.0,
            "exit_zone_time": 0.0,
        }

        trigger = app.build_incident_trigger(
            "Walking",
            0.99,
            behavior,
            pose_quality=quality,
            confirmation_state={},
            now=1000.0,
        )

        self.assertFalse(quality["reliable"])
        self.assertIsNone(trigger)

    def test_tiny_jitter_does_not_count_as_direction_changes(self):
        history = deque()
        now = 1000.0
        for idx in range(40):
            offset = 0.002 if idx % 2 else -0.002
            history.append(
                {
                    "timestamp": now - 40 + idx,
                    "center": (0.5 + offset, 0.5),
                    "action": "Walking",
                    "confidence": 0.9,
                }
            )

        behavior = app.analyze_wandering_risk(history, now, now, False, 0.15)

        self.assertEqual(behavior["direction_change_count"], 0)
        self.assertNotEqual(behavior["risk"], "High")


class PoseGeometryTests(unittest.TestCase):
    def test_geometry_classifies_standing(self):
        geometry = app.classify_pose_geometry(
            make_pose_keypoints("standing"),
            {"score": 0.9},
        )

        self.assertEqual(geometry["posture"], "Standing")

    def test_geometry_classifies_sitting(self):
        geometry = app.classify_pose_geometry(
            make_pose_keypoints("sitting"),
            {"score": 0.9},
        )

        self.assertEqual(geometry["posture"], "Sitting")

    def test_geometry_classifies_lying(self):
        geometry = app.classify_pose_geometry(
            make_pose_keypoints("lying"),
            {"score": 0.9},
        )

        self.assertEqual(geometry["posture"], "Lying")

    def test_geometry_returns_uncertain_for_missing_body_points(self):
        geometry = app.classify_pose_geometry(np.zeros((17, 2), dtype=float), {"score": 0.2})

        self.assertEqual(geometry["posture"], "Uncertain posture")

    def test_geometry_standing_overrides_bad_lstm_lying_prediction(self):
        action, confidence, reason = app.choose_final_action(
            "Lying Down",
            0.99,
            {"posture": "Standing", "confidence": 0.9},
            {"reliable": True, "score": 0.9},
            motion_context={"is_walking": False},
        )

        self.assertEqual(action, "Standing")
        self.assertAlmostEqual(confidence, 0.9)
        self.assertIn("Geometry", reason)

    def test_motion_context_overrides_static_lstm_prediction_for_walking(self):
        action, confidence, reason = app.choose_final_action(
            "Standing",
            0.93,
            {"posture": "Standing", "confidence": 0.86},
            {"reliable": True, "score": 0.9},
            motion_context={
                "is_walking": True,
                "confidence": 0.78,
                "reason": "Body center moved enough.",
            },
        )

        self.assertEqual(action, "Walking")
        self.assertGreaterEqual(confidence, 0.78)
        self.assertIn("Body center", reason)

    def test_lstm_fall_requires_lying_or_uncertain_geometry(self):
        lying_action, _, _ = app.choose_final_action(
            "Fall Down",
            0.91,
            {"posture": "Lying", "confidence": 0.9},
            {"reliable": True, "score": 0.9},
            motion_context={"is_walking": False},
        )
        standing_action, _, _ = app.choose_final_action(
            "Fall Down",
            0.91,
            {"posture": "Standing", "confidence": 0.9},
            {"reliable": True, "score": 0.9},
            motion_context={"is_walking": False},
        )

        self.assertEqual(lying_action, "Fall Down")
        self.assertEqual(standing_action, "Standing")


if __name__ == "__main__":
    unittest.main()
