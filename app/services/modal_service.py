"""Business logic for the MSDS and Risk-assessment modal endpoints."""

from __future__ import annotations

from fastapi import HTTPException

from app.repositories.base import KioskRepository
from app.schemas.modal import (
    MsdsChemical,
    MsdsResponse,
    RiskResponse,
    RiskRow,
    RiskSummary,
)


def risk_level(score: int) -> tuple[str, str]:
    """Map a risk score to (level, korean_word).

    Buckets match the frontend summary cards: 높음(15+) / 중간(8~14) / 낮음(1~7).
    """
    if score >= 15:
        return "high", "높음"
    if score >= 8:
        return "mid", "중간"
    return "low", "낮음"


class ModalService:
    def __init__(self, repo: KioskRepository) -> None:
        self._repo = repo

    def get_msds(self) -> MsdsResponse:
        data = self._repo.get_msds()
        chemicals = [MsdsChemical(**c) for c in data["chemicals"]]
        return MsdsResponse(
            site=data["site"], count=len(chemicals), chemicals=chemicals
        )

    def get_risk(self, process_code: str | None = None) -> RiskResponse:
        # Default to the first process that has a risk assessment.
        code = process_code or "PRC-19"
        data = self._repo.get_risk(code)
        if data is None:
            raise HTTPException(
                status_code=404,
                detail=f"공정 {code} 의 위험성평가 결과가 없습니다.",
            )

        rows: list[RiskRow] = []
        high = mid = low = 0
        for r in data["rows"]:
            score = int(r["likelihood"]) * int(r["severity"])
            level, word = risk_level(score)
            if level == "high":
                high += 1
            elif level == "mid":
                mid += 1
            else:
                low += 1
            rows.append(
                RiskRow(
                    hazard=r["hazard"],
                    likelihood=int(r["likelihood"]),
                    severity=int(r["severity"]),
                    risk_score=score,
                    risk_level=level,
                    risk_label=f"{score} {word}",
                    control=r["control"],
                )
            )

        summary = RiskSummary(high=high, mid=mid, low=low, total=len(rows))
        return RiskResponse(
            process=data["process"],
            process_code=data["process_code"],
            assessment_date=data["assessment_date"],
            method=data["method"],
            summary=summary,
            rows=rows,
        )
