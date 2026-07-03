import json, sys, wave
import numpy as np
import onnxruntime as ort
from pygoruut.pygoruut import Pygoruut

MODEL = "voices/piper-kss-korean.onnx"
CONF  = "voices/piper-kss-korean.onnx.json"
TEXT  = sys.argv[1] if len(sys.argv) > 1 else "안전모를 착용하세요"
OUT   = "/tmp/tts_test.wav"
PAD, BOS, EOS = "_", "^", "$"

conf = json.load(open(CONF, encoding="utf-8"))
pid  = conf["phoneme_id_map"]
sr   = conf["audio"]["sample_rate"]
inf  = conf.get("inference", {})
scales = np.array([inf.get("noise_scale", 0.667),
                   inf.get("length_scale", 1.0),
                   inf.get("noise_w", 0.8)], dtype=np.float32)

# 1) 텍스트 → pygoruut 음소(IPA). 첫 실행 시 goruut 바이너리 캐시(네트워크 필요, 이후 오프라인)
pg = Pygoruut()
phon = str(pg.phonemize(language="Korean", sentence=TEXT))
print("[phonemes]", phon)

# 2) 음소 → id (piper 규칙: BOS, 각 음소 뒤 PAD, EOS)
ids, miss = list(pid[BOS]), 0
for ch in phon:
    if ch in pid:
        ids += pid[ch] + pid[PAD]
    else:
        miss += 1
ids += pid[EOS]
print(f"[ids] len={len(ids)}, 매핑실패 문자수={miss}")

# 3) ONNX 추론
sess = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
print("[onnx inputs]", [(i.name, i.shape) for i in sess.get_inputs()])
audio = sess.run(None, {
    "input": np.array([ids], dtype=np.int64),
    "input_lengths": np.array([len(ids)], dtype=np.int64),
    "scales": scales,
})[0].squeeze()

# 4) wav 저장
pcm = (audio / (np.max(np.abs(audio)) + 1e-9) * 32767).astype(np.int16)
with wave.open(OUT, "wb") as wf:
    wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr)
    wf.writeframes(pcm.tobytes())
print("[done]", OUT)
