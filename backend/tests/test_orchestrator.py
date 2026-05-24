from backend.contracts import AnalysisRequest, GeminiEvaluation
from backend.orchestrator import apply_gemini_result, final_recording_status


class FakeSupabase:
    def __init__(self):
        self.patches = []

    def patch_rows(self, table, query, payload):
        self.patches.append((table, query, payload))
        return [payload]


def test_apply_gemini_result_flips_scoring_false():
    fake = FakeSupabase()
    result = GeminiEvaluation(
        summary="A hand picks up a cup.",
        success=True,
        success_reasoning="The cup is visibly lifted.",
        score=8,
        score_reasoning="The action succeeds with slight hesitation.",
    )

    apply_gemini_result(fake, "rec-1", result)

    assert fake.patches == [
        (
            "recordings",
            "id=eq.rec-1",
            {
                "summary": "A hand picks up a cup.",
                "success": True,
                "success_reasoning": "The cup is visibly lifted.",
                "score": 8,
                "score_reasoning": "The action succeeds with slight hesitation.",
                "is_scoring": False,
            },
        )
    ]


def test_final_recording_status_prefers_in_progress_before_failed():
    assert final_recording_status(["succeeded", "succeeded"]) == "analyzed"
    assert final_recording_status(["succeeded", "failed"]) == "analysis_failed"
    assert final_recording_status(["succeeded", "running"]) == "analyzing"
    assert final_recording_status(["failed", "pending"]) == "analyzing"


def test_analysis_request_contract():
    payload = AnalysisRequest(
        recording_id="r",
        task_id="t",
        submission_id="s",
        storage_path="r/",
    )

    assert payload.storage_path == "r/"
