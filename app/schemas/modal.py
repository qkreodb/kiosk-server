"""DTOs for the MSDS and Risk-assessment modals."""

from __future__ import annotations

from pydantic import BaseModel, Field


# ──────────────────────────── MSDS ────────────────────────────
class MsdsChemical(BaseModel):
    """Per-chemical MSDS detail, shaped to the frontend MSDS modal."""

    key: str = Field(description="조회 키", examples=["염산"])
    name: str = Field(examples=["염산 (Hydrochloric acid)"])
    cas: str = Field(examples=["7647-01-0"])
    formula: str = Field(examples=["HCl"])
    un: str = Field(description="UN 번호", examples=["UN1789"])
    signal: str = Field(description="신호어", examples=["위험"])
    hazard: list[str] = Field(description="유해·위험 문구 (H-code)")
    handling: str = Field(description="취급")
    storage: str = Field(description="저장")


class MsdsResponse(BaseModel):
    site: str = Field(examples=["고양시사업장"])
    count: int
    chemicals: list[MsdsChemical]


# ──────────────────────── Risk assessment ────────────────────────
class RiskRow(BaseModel):
    """One row of the 위험성평가 table."""

    hazard: str = Field(description="유해·위험요인", examples=["고속 회전체 협착·말림"])
    likelihood: int = Field(description="가능성", ge=1, le=5, examples=[3])
    severity: int = Field(description="중대성", ge=1, le=5, examples=[5])
    risk_score: int = Field(description="위험성 = 가능성 × 중대성", examples=[15])
    risk_level: str = Field(description="high / mid / low", examples=["high"])
    risk_label: str = Field(description="UI 배지 텍스트", examples=["15 높음"])
    control: str = Field(description="개선대책", examples=["방호덮개 설치·연동장치"])


class RiskSummary(BaseModel):
    high: int = Field(description="높음 (15+)")
    mid: int = Field(description="중간 (8~12)")
    low: int = Field(description="낮음 (1~6)")
    total: int = Field(description="총 위험요인")


class RiskResponse(BaseModel):
    process: str = Field(examples=["정밀가공 공정"])
    process_code: str = Field(examples=["PRC-19"])
    assessment_date: str = Field(examples=["2026-05-12"])
    method: str = Field(examples=["4M"])
    summary: RiskSummary
    rows: list[RiskRow]
