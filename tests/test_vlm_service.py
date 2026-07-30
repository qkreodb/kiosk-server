import unittest
from types import SimpleNamespace

from app.integrations.tts import TtsResult
from app.integrations.vlm_client import VlmResult
from app.services.vlm_service import VlmService


class _VlmClient:
    async def analyze(self, _frame_dir, *, labels, process_name):
        # Simulate a stale action payload arriving with the authoritative
        # person-absent gate. The service must not turn it into a danger.
        return VlmResult(
            person_present=False,
            action_keys=["slot_3"],
            rule_labels={"slot_3": "안전하네스 미착용"},
        )


class _Tts:
    async def synthesize(self, text):
        return TtsResult(status="skipped", text=text, voice="test")


class _Speaker:
    def current_epoch(self):
        return 0

    def play_async(self, *_args, **_kwargs):
        raise AssertionError("사람 없음 사이클에서 TTS를 재생하면 안 됨")


class PersonAbsentClearsDangerTests(unittest.IsolatedAsyncioTestCase):
    async def test_person_absent_clears_stale_harness_state_immediately(self):
        debounce_state = {
            ("CAM-1", "process-1", "slot_3"): {"state": True, "streak": 0}
        }
        settings = SimpleNamespace(
            behavior_debounce_frames=3,
            behavior_cooldown_seconds=0,
            light_interest_threshold=1,
            light_caution_threshold=2,
            light_warning_threshold=3,
            light_danger_threshold=4,
        )
        service = VlmService(
            repo=SimpleNamespace(),
            vlm_client=_VlmClient(),
            tts=_Tts(),
            speaker=_Speaker(),
            warning_light=SimpleNamespace(),
            settings=settings,
            debounce_state=debounce_state,
        )

        result = await service.infer(
            camera_id="CAM-1",
            process_code="process-1",
            frame_dir="/frames",
            labels=["slot_3"],
            process_name="demo",
        )

        self.assertEqual(result.cycle_decision, "not_detected")
        self.assertEqual(result.detection, "")
        self.assertEqual(result.detection_labels, [])
        self.assertEqual(result.behaviors, [])
        self.assertEqual(
            debounce_state[("CAM-1", "process-1", "slot_3")],
            {"state": False, "streak": 0},
        )


if __name__ == "__main__":
    unittest.main()
