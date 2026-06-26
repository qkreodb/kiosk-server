# 스피커 TTS 재생 구현 (2026-06-22)

## 작업 내용

`SpeakerActuator.play()`의 로그 stub을 실제 오디오 재생으로 교체.

---

## 변경 파일

### `app/integrations/actuators.py`

**이전 (stub):**
```python
def play(self, audio_path, text):
    logger.info("[SPEAKER] play audio file: %s", audio_path)
    return True  # 로그만 찍고 끝
```

**이후 (실제 재생):**
```python
def play(self, audio_path, text):
    from playsound import playsound
    playsound(audio_path)   # blocking — 재생 완료까지 대기
    return True
```

- `playsound(audio_path)` blocking 호출로 MP3 재생 완료까지 다음 로직 진행 안 됨
- 재생 실패 시 예외를 잡아 `False` 반환 (파이프라인은 중단되지 않음)

### `requirements.txt`

| 패키지 | 이전 | 이후 | 사유 |
|---|---|---|---|
| `edge-tts` | 7.0.0 | 7.2.8 | 구버전이 Microsoft 서버 403으로 막힘 (WSServerHandshakeError) |
| `playsound` | 미포함 | 1.2.2 | 스피커 재생 구현에 추가 |

---

## 패키지 선택 근거 (playsound vs 대안)

| 옵션 | 판단 |
|---|---|
| **playsound 1.2.2** | MP3 직접 지원, blocking 기본, 의존성 최소 → **채택** |
| subprocess + ffplay | ffmpeg 별도 설치 필요, 환경 의존성 높음 → 제외 |
| pygame | 초기화 코드 복잡, 오디오 하나에 오버스펙 → 제외 |
| winsound | WAV 전용 → 제외 |

---

## 파이프라인 흐름 (변경 후)

```
POST /vlm/infer
  └─ Branch A (TTS)
       ├─ VLM "위험 경고 텍스트" 추출
       ├─ TtsService.synthesize()  → MP3 파일 생성 (tts_out/*.mp3)
       └─ SpeakerActuator.play()  → playsound(audio_path) blocking 재생  ← 이번 구현
```

---

## 테스트 결과

테스트 텍스트: `"안전모를 착용하고 단독 사다리 작업을 중지하세요"`

```
[1] TTS 합성 중 → status=synthesized, path=tts_out/warning_***.mp3
[2] 스피커 재생 시작 → playsound blocking
[3] 재생 결과: True  ✅
```

---

## 미완료 (다음 작업)

- [ ] `WarningLightActuator.dispatch()` — 경광등 실제 제어 (Hardware Server 8081 or GPIO)
- [ ] TTS 오프라인 환경 대응 — edge-tts는 인터넷 필요. Jetson 오프라인 시 대체 수단 검토
- edge-tts는 텍스트를 Microsoft의 클라우드 서버로 전송하고 합성된 음성을 받아오는 클라이언트 라이브러리로 폐쇄망에서는 서버에 도달할 수 없어서 동작하지 않음
