"""DTOs for the temp/humidity and Galaxy-Watch heart-rate endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field


class TempHumidReading(BaseModel):
    """One 온습도 센서 reading (from the Hardware Server's DB)."""

    sensor_id: str = Field(examples=["TH-01"])
    sensor_name: str | None = Field(
        default=None,
        description="하드웨어 서버 송신 식별자 (예: shelly_1, sonoff_1)",
        examples=["shelly_1"],
    )
    zone: str = Field(examples=["정밀가공 시연존"])
    process_code: str | None = Field(default=None, examples=["PRC-19"])
    temp: float = Field(description="섭씨 온도 (°C)", examples=[27.4])
    humidity: float = Field(description="상대 습도 (%)", examples=[58])
    feels_like: float | None = Field(default=None, description="체감 온도 (°C)")
    dust: int | None = Field(default=None, description="미세먼지 (㎍/㎥)")
    timestamp: str = Field(description="ISO-8601 측정 시각")


class TempHumidResponse(BaseModel):
    location: str = Field(examples=["경기도 고양시"])
    count: int
    readings: list[TempHumidReading]


class WatchReading(BaseModel):
    """Heart-rate sample from one Galaxy Watch wearer (심박 데이터)."""

    watch_id: str = Field(examples=["WATCH-01"])
    name: str | None = Field(default=None, examples=["이정학"])
    hr: int = Field(description="심박수 (BPM)", examples=[88])
    status: str = Field(description="정상 / 주의 / 위험", examples=["정상"])
    zone: str | None = Field(default=None, examples=["정밀가공 시연존"])
    process_code: str | None = Field(default=None, examples=["PRC-19"])
    device: str = Field(default="Galaxy Watch")
    timestamp: str = Field(description="ISO-8601 측정 시각")


class WatchResponse(BaseModel):
    region: str = Field(examples=["고양시사업장"])
    count: int
    workers: list[WatchReading]
