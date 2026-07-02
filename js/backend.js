/* =====================================================================
 * backend.js — 백엔드(PORT 8080) 연동 계층
 * ---------------------------------------------------------------------
 * 디자인(app.js)은 정적/더미 동작만 담고, 실제 서버 연동 기능은 여기에 모은다.
 * app.js 다음에 로드되어 일부 함수(openCCTVFor/openEnvDetail 등)를 실서버 버전으로
 * 덮어쓴다(window 재할당). 인라인 onclick 에서 호출되는 함수는 window 에 노출한다.
 *
 *   GET  /space-name            → 신호등 행렬 + 공정 드롭다운
 *   POST /behavior/reset        → 카운트 0 리셋(경광등 소등)
 *   POST /vlm/infer             → CAM-1 위험행동 분석 결과 오버레이
 *   POST /vlm/prompt            → CAM-2 자유 프롬프트 질의(자막 타자 출력)
 *   POST /led/trigger           → 신호등 헤더(관심/주의/경고/위험) 경광등 점등
 *   GET  /sensor/temp-humid     → 온습도 라이브
 *   GET  /sensor/watch          → 스마트워치 심박 라이브
 *   GET  /cctv/live?cam=N       → 카메라별 IP카메라 RTSP→MJPEG 중계
 * ===================================================================== */
(function () {
  'use strict';

  // API base 해석 우선순위:
  //   1. ?api=http://... 쿼리 파라미터 (명시적 오버라이드)
  //   2. 파일 직접 열기(file://) → localhost:8080
  //   3. 포트 80/443(ngrok·리버스프록시 등) → 포트 없이 같은 origin 사용
  //   4. 그 외(로컬 LAN 직접 접속) → 같은 호스트:8080
  const API = (function () {
    const qs = new URLSearchParams(location.search);
    if (qs.get('api')) return qs.get('api').replace(/\/$/, '');
    if (location.protocol === 'file:' || !location.hostname) return 'http://localhost:8080';
    const port = location.port;
    // 표준 포트(80/443)이면 FastAPI 도 같은 origin 에서 서빙되는 것 (ngrok 등)
    if (!port || port === '80' || port === '443') {
      return location.protocol + '//' + location.hostname;
    }
    return location.protocol + '//' + location.hostname + ':8080';
  })();
  window.__API_BASE = API;

  function sensorApi() { return window.__API_BASE || 'http://localhost:8080'; }
  async function fetchJson(path) {
    const resp = await fetch(sensorApi() + path, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  }

  /* ===================== 라이브 센서 (온습도 / 심박) ===================== */
  const liveSensors = { tempHumid: null, watch: null };
  // 화면 하단 라이브 배지에 표시할 온습도 센서(요청: sonoff 값 사용).
  const BADGE_TH_SENSOR = 'sonoff_1';

  async function refreshLiveSensors() {
    const [th, watch] = await Promise.allSettled([
      fetchJson('/sensor/temp-humid?sensor_name=' + encodeURIComponent(BADGE_TH_SENSOR)),
      fetchJson('/sensor/watch')
    ]);
    if (th.status === 'fulfilled') liveSensors.tempHumid = th.value;
    if (watch.status === 'fulfilled') liveSensors.watch = watch.value;
  }
  // 특정 온습도 센서(shelly_1/sonoff_1)의 최신값만 직접 조회.
  async function fetchTempHumidByName(sensorName) {
    const data = await fetchJson('/sensor/temp-humid?sensor_name=' + encodeURIComponent(sensorName));
    const readings = data && data.readings;
    return Array.isArray(readings) && readings.length ? readings[0] : null;
  }
  function latestWatchWorkers() {
    const workers = liveSensors.watch && liveSensors.watch.workers;
    return Array.isArray(workers) ? workers : [];
  }
  function heartClass(bpm) {
    if (bpm >= 130) return 'danger';
    if (bpm >= 110) return 'warn';
    return '';
  }
  function heartStatus(bpm, apiStatus) {
    if (apiStatus) return apiStatus;
    if (bpm >= 130) return 'DANGER';
    if (bpm >= 110) return 'CAUTION';
    return 'NORMAL';
  }
  function isCentralTempHumid(sensorId, zone) {
    return sensorId === 'TH-03' || String(zone || '').includes('중앙 전시홀');
  }
  // DB의 실제 갤럭시워치 1대는 백엔드에서 workers[0]=WATCH-01(가장 왼쪽)에 매핑된다.
  // 이 워치만 /sensor/watch 라이브값을 쓰고, 나머지 작업자는 더미(랜덤) 심박을 보여준다.
  const LIVE_WATCH_ID = 'WATCH-01';
  function isLiveWatch(watchId) { return watchId === LIVE_WATCH_ID; }
  function dummyTempHumid(sensorId) {
    const idx = Number(String(sensorId || '').replace(/\D/g, '')) || 1;
    return {
      temp: (25.5 + idx * 0.4 + Math.random() * 1.8).toFixed(1),
      humidity: Math.floor(49 + idx * 2 + Math.random() * 8)
    };
  }
  function dummyHeartRate(watchId) {
    const idx = Number(String(watchId || '').replace(/\D/g, '')) || 1;
    return 68 + ((idx * 9) % 32) + Math.floor(Math.random() * 8);
  }
  function renderWatchWorkers(workers) {
    const grid = document.getElementById('hrGrid');
    if (!grid) return;
    if (!workers.length) {
      grid.innerHTML = '<div class="watch-none">No live watch data</div>';
      return;
    }
    grid.innerHTML = workers.map((w, i) => {
      const bpm = Number(w.hr || 0);
      const cls = heartClass(bpm);
      const name = w.name || ('Worker ' + String(i + 1));
      const watchId = w.watch_id || ('WATCH-' + String(i + 1).padStart(2, '0'));
      const meta = [watchId, w.device || 'Galaxy Watch', w.zone].filter(Boolean).join(' · ');
      return `
        <div class="hr-worker ${cls}">
          <div class="hr-avatar">${String(name).charAt(0)}</div>
          <div class="hr-worker-info">
            <div class="hr-worker-name">${name}</div>
            <div class="hr-worker-meta">${meta}</div>
            <span class="hr-status-badge">${heartStatus(bpm, w.status)}</span>
          </div>
          <div style="text-align:right;">
            <div class="hr-bpm">
              <svg class="hr-pulse-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="color:inherit;"><path d="M3 12h4l2 5 4-12 2 7h6"/></svg>
              <span class="hr-bpm-val">${bpm || '-'}</span><span class="hr-bpm-unit">BPM</span>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  /* ===================== 모달 라이브 폴링 ===================== */
  // 모달이 열려 있는 동안 주기적으로 값을 다시 가져와 실시간으로 갱신한다.
  const MODAL_POLL_MS = 3000;
  // 온습도 실센서별 모달 갱신 주기: shelly 4분(완만), sonoff 5초(직관적 실시간).
  const TH_POLL_MS = { shelly_1: 240000, sonoff_1: 5000 };
  const modalPollers = {}; // overlayId -> intervalId
  // 메인 화면 자동 갱신 주기(F5 없이 실시간): 신호등 행렬 + 라이브 배지.
  const MATRIX_POLL_MS = 2000;
  const LIVE_POLL_MS = 2000;

  function stopModalPoll(overlayId) {
    if (modalPollers[overlayId]) {
      clearInterval(modalPollers[overlayId]);
      delete modalPollers[overlayId];
    }
  }
  // fn: 값 갱신 함수(비동기 가능). 같은 모달의 기존 폴링은 정리하고 새로 시작.
  // intervalMs 미지정 시 기본 주기(MODAL_POLL_MS) 사용.
  function startModalPoll(overlayId, fn, intervalMs) {
    stopModalPoll(overlayId);
    modalPollers[overlayId] = setInterval(() => {
      // 닫힌 모달(배경 클릭 등으로 .open 제거)은 자동 정리 — 닫기 직후 한 번 더 요청 방지
      const el = document.getElementById(overlayId);
      if (!el || !el.classList.contains('open')) { stopModalPoll(overlayId); return; }
      Promise.resolve(fn()).catch(() => { /* 일시적 오류는 다음 주기에 재시도 */ });
    }, intervalMs || MODAL_POLL_MS);
  }

  // closeModal(닫기 버튼) 호출 시 해당 모달의 폴링을 즉시 정지하도록 래핑.
  // (배경 클릭으로 닫는 경우는 위 인터벌의 .open 체크가 정리한다)
  const _closeModal = window.closeModal;
  window.closeModal = function (id) {
    stopModalPoll(id);
    if (typeof _closeModal === 'function') _closeModal(id);
    else { const el = document.getElementById(id); if (el) el.classList.remove('open'); }
  };

  /* 온습도 센서 상세(라이브) — app.js 더미 버전 덮어쓰기
   * sensorName(shelly_1/sonoff_1)이 주어진 아이콘은 해당 실센서를 라이브 조회하고,
   * 그 외 아이콘은 기존처럼 더미값을 표시한다. 폴링 주기는 센서별로 다르다.   */
  window.openEnvDetail = async function (sensorId, zone, sensorName) {
    const sub = document.getElementById('envDetailSub');
    if (sub) sub.textContent = sensorId + ' · ' + zone;
    setText('envDetailTemp', '--<small>°C</small>', true);
    setText('envDetailHum', '--<small>%</small>', true);
    if (typeof updateEnvStatus === 'function') updateEnvStatus(NaN, NaN);
    document.getElementById('envDetailOverlay').classList.add('open');

    const live = !!sensorName;
    const pollMs = TH_POLL_MS[sensorName] || MODAL_POLL_MS;
    async function update() {
      if (!live) {
        const dummy = dummyTempHumid(sensorId);
        setText('envDetailTemp', dummy.temp + '<small>°C</small>', true);
        setText('envDetailHum', dummy.humidity + '<small>%</small>', true);
        if (typeof updateEnvStatus === 'function') updateEnvStatus(parseFloat(dummy.temp), parseFloat(dummy.humidity));
        return;
      }
      const reading = await fetchTempHumidByName(sensorName);
      if (!reading) return;
      if (sub) sub.textContent = sensorId + ' · ' + zone + ' · LIVE';
      setText('envDetailTemp', Number(reading.temp).toFixed(1) + '<small>°C</small>', true);
      setText('envDetailHum', Number(reading.humidity).toFixed(1) + '<small>%</small>', true);
      if (typeof updateEnvStatus === 'function') updateEnvStatus(Number(reading.temp), Number(reading.humidity));
    }

    try { await update(); } catch (_) { /* 모달은 유지 */ }
    startModalPoll('envDetailOverlay', update, pollMs); // shelly 4분 / sonoff 5초
  };

  /* 심박 그룹(라이브) — app.js 더미 버전 덮어쓰기 */
  window.openHeartRate = async function (region, count) {
    const sub = document.getElementById('hrSub');
    const grid = document.getElementById('hrGrid');
    if (sub) sub.textContent = region + ' · Live Galaxy Watch';
    if (grid) grid.innerHTML = '<div class="watch-none">Loading live watch data...</div>';
    document.getElementById('hrOverlay').classList.add('open');

    const n = Math.min(count || 5, 8);
    const names = ['이*학', '전*조', '김*수', '박*후', '최*재', '정*진', '강*준', '윤*성'];
    const zones = ['부스 A', '부스 C', '중앙 전시홀', '부스 B', '세미나실', '중앙 통로', '부스 D', '하역장'];
    async function update() {
      // 실제 워치(WATCH-01)만 라이브, 나머지는 더미. 라이브 호출이 실패해도
      // 나머지 더미 작업자는 정상 렌더되도록 라이브값은 별도로 try/catch.
      let live = null;
      try { await refreshLiveSensors(); live = latestWatchWorkers()[0] || null; }
      catch (e) { live = null; }
      const workers = Array.from({ length: n }, (_, i) => {
        const watch = 'WATCH-' + String(i + 1).padStart(2, '0');
        if (watch === LIVE_WATCH_ID && live) {
          return { watch_id: watch, name: names[i], hr: live.hr, status: live.status, zone: zones[i], device: live.device || 'Galaxy Watch' };
        }
        const bpm = dummyHeartRate(watch);
        return { watch_id: watch, name: names[i], hr: bpm, status: heartStatus(bpm), zone: zones[i], device: 'Galaxy Watch' };
      });
      renderWatchWorkers(workers);
    }

    try { await update(); }
    catch (e) { if (grid) grid.innerHTML = '<div class="watch-none">Watch API unavailable</div>'; }
    startModalPoll('hrOverlay', update); // 열려 있는 동안 주기적 갱신
  };

  /* 심박 개인(라이브) — app.js 더미 버전 덮어쓰기 */
  window.openWatchWorker = async function (name, watchId, proc) {
    const sub = document.getElementById('hrSub');
    const grid = document.getElementById('hrGrid');
    if (sub) sub.textContent = proc + ' · ' + name;
    document.getElementById('hrOverlay').classList.add('open');

    const live = isLiveWatch(watchId);
    async function update() {
      if (!live) {
        const bpm = dummyHeartRate(watchId);
        if (grid) grid.innerHTML = workerCard(name || 'Worker', watchId, 'Galaxy Watch', proc, bpm, heartStatus(bpm), heartClass(bpm));
        return;
      }
      await refreshLiveSensors();
      const worker = latestWatchWorkers()[0] || null;
      if (!worker) { if (grid) grid.innerHTML = '<div class="watch-none">No live watch data</div>'; return; }
      const bpm = Number(worker.hr || 0);
      if (grid) grid.innerHTML = workerCard(
        name || worker.name || 'Worker',
        watchId || worker.watch_id || LIVE_WATCH_ID,
        worker.device || 'Galaxy Watch',
        proc || worker.zone || '',
        bpm || '-', heartStatus(bpm, worker.status), heartClass(bpm));
    }

    if (live && grid) grid.innerHTML = '<div class="watch-none">Loading live watch data...</div>';
    try { await update(); }
    catch (e) { if (grid) grid.innerHTML = '<div class="watch-none">Watch API unavailable</div>'; }
    startModalPoll('hrOverlay', update); // 열려 있는 동안 주기적 갱신
  };
  function workerCard(name, watchId, device, proc, bpm, status, cls) {
    return `
      <div class="hr-worker ${cls}" style="grid-column:1 / 3;">
        <div class="hr-avatar">${String(name).charAt(0)}</div>
        <div class="hr-worker-info">
          <div class="hr-worker-name">${name}</div>
          <div class="hr-worker-meta">${[watchId, device, proc].filter(Boolean).join(' · ')}</div>
          <span class="hr-status-badge">${status}</span>
        </div>
        <div style="text-align:right;">
          <div class="hr-bpm">
            <svg class="hr-pulse-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2 5 4-12 2 7h6"/></svg>
            <span class="hr-bpm-val">${bpm}</span><span class="hr-bpm-unit">BPM</span>
          </div>
        </div>
      </div>`;
  }
  function setText(id, html, asHtml) {
    const el = document.getElementById(id);
    if (!el) return;
    if (asHtml) el.innerHTML = html; else el.textContent = html;
  }

  /* ===================== CCTV (라이브 스트림 포함) ===================== */
  // cam: DB cctv_info 의 cctv_id(숫자 문자열). 백엔드가 카메라별 RTSP URL 을 해석한다.
  function cctvLiveSrc(cam) {
    return (window.__API_BASE || 'http://localhost:8080')
      + '/cctv/live?cam=' + encodeURIComponent(cam || '1') + '&ts=' + Date.now();
  }
  // 모달 제목("CAM-2 · …")에서 카메라 번호 추출. 못 찾으면 1(기존 CCTV).
  function camNumFrom(region) {
    const m = /CAM-(\d+)/i.exec(String(region || ''));
    return m ? m[1] : '1';
  }
  // 프롬프트 질의(신규 CCTV) 모드로 동작하는 카메라 번호 — 지도 가장 우측 CAM-2.
  const PROMPT_CAM_NUM = '2';

  /* ----- 이상현상 수신 시 CAM-1 CCTV 미니 팝업 알림 -----
   * VLM이 실제 이상행동을 카운트(쿨다운 통과)하면 사업장 지도 CCTV 탭의 CAM-1
   * CCTV 아이콘 주위를 빨갛게 점멸시키고, 옆에 작은 라이브 CCTV 영상을 띄운다.
   * 팝업은 CCTV 탭(siteCctvMarkers)이 보일 때만 노출되며 클릭 시 전체 모달로 연결.   */
  let cctvAlertTimer = null;
  const CCTV_ALERT_MS = 8000; // 표시 후 자동 닫힘(새 감지 시 갱신)
  function showCctvAlert() {
    const ring = document.getElementById('cctvAlertRing');
    const popup = document.getElementById('cctvAlertPopup');
    const img = document.getElementById('cctvMiniImg');
    if (!ring || !popup) return;
    // CCTV 탭이 보일 때만 의미 있음 — 다른 탭이면 불필요한 MJPEG 스트림/점멸 생략.
    const markers = document.getElementById('siteCctvMarkers');
    if (markers && markers.style.display === 'none') return;
    ring.style.display = '';
    popup.style.display = '';
    // CAM-1 미니 화면도 RTSP 라이브(MJPEG) 스트림을 사용한다.
    if (img && !img.getAttribute('src')) img.src = cctvLiveSrc('1');
    if (cctvAlertTimer) clearTimeout(cctvAlertTimer);
    cctvAlertTimer = setTimeout(hideCctvAlert, CCTV_ALERT_MS);
  }
  function hideCctvAlert() {
    const ring = document.getElementById('cctvAlertRing');
    const popup = document.getElementById('cctvAlertPopup');
    const img = document.getElementById('cctvMiniImg');
    if (ring) ring.style.display = 'none';
    if (popup) popup.style.display = 'none';
    if (img) img.removeAttribute('src'); // 스트림 중단(자원 절약)
    if (cctvAlertTimer) { clearTimeout(cctvAlertTimer); cctvAlertTimer = null; }
  }
  window.showCctvAlert = showCctvAlert;
  window.hideCctvAlert = hideCctvAlert;

  /* ----- 프롬프트 자막 큐 (신규 CCTV · CAM-2) -----
   * /vlm/prompt 응답 텍스트를 큐에 쌓고, CCTV 화면 하단 반투명 자막에 타자 효과로
   * 한 글자씩 쓴다. 한 메시지를 다 쓰면 큐에서 "가장 최근" 메시지만 꺼내 출력하고
   * 그 사이 쌓인 오래된 메시지는 버린다 — 응답이 타자 속도보다 빨라도 자막이
   * 뒤처지지(지연 누적) 않게 하기 위해서다.                              */
  const CAPTION_CHAR_MS = 45;    // 글자당 타자 간격
  const CAPTION_HOLD_MS = 1500;  // 다 쓴 자막을 다음 메시지 전까지 잠깐 유지
  const captionQueue = [];
  let captionTyping = false;

  function clearCaption() {
    captionQueue.length = 0;
    const box = document.getElementById('cctvCaption');
    const span = document.getElementById('cctvCaptionText');
    if (span) span.textContent = '';
    if (box) box.classList.remove('show', 'typing');
  }
  function enqueueCaption(text) {
    if (!text) return;
    captionQueue.push(String(text));
    drainCaptionQueue();
  }
  async function drainCaptionQueue() {
    if (captionTyping) return;
    const box = document.getElementById('cctvCaption');
    const span = document.getElementById('cctvCaptionText');
    if (!box || !span) return;
    captionTyping = true;
    try {
      while (captionQueue.length) {
        const text = captionQueue[captionQueue.length - 1]; // 최신 메시지만
        captionQueue.length = 0;                            // 그 사이 메시지는 폐기
        box.classList.add('show', 'typing');
        for (let i = 1; i <= text.length; i++) {
          span.textContent = text.slice(0, i);
          await sleep(CAPTION_CHAR_MS);
          if (!cctvModalOpen()) return; // 모달 닫힘 → 즉시 중단(clearCaption이 정리)
        }
        box.classList.remove('typing');
        if (captionQueue.length) continue; // 새 메시지 이미 도착 → 바로 이어서
        await sleep(CAPTION_HOLD_MS);
      }
    } finally {
      captionTyping = false;
    }
  }

  /* ----- 프롬프트 질의 루프 -----
   * CAM-2 모달이 열리면 즉시 시작: 입력창의 프롬프트로 POST /vlm/prompt →
   * 응답 텍스트를 자막 큐에 넣고 곧바로 다음 질의(응답 도착 주도). 프롬프트는
   * 매 요청 시점에 입력창을 읽으므로 사용자가 수정하면 다음 질의부터 반영된다. */
  const PROMPT_INTERVAL_MS = 300;      // 성공 응답 후 다음 질의까지 대기
  const PROMPT_ERROR_BACKOFF_MS = 2000; // 오류 시 재시도 전 대기
  const DEFAULT_PROMPT = '지금 CCTV 장면에서 무슨 일이 일어나고 있는지 한 문장으로 설명해줘.';
  const promptLoop = { token: 0, active: false };

  function currentPromptText() {
    const input = document.getElementById('cctvPromptInput');
    const v = input && input.value.trim();
    return v || DEFAULT_PROMPT;
  }
  // 루프 계속 여부: 토큰 일치 + active + CCTV 모달이 실제로 열려 있음.
  // 모달이 어떤 경로로 닫히든(closeCCTV 미호출 포함) cctvModalOpen()이 false가 되어
  // 다음 요청을 내보내지 않고 루프가 스스로 종료된다(중복 호출 방지 안전망).
  function promptLoopAlive(token) {
    return promptLoop.token === token && promptLoop.active && cctvModalOpen();
  }
  function startPromptLoop() {
    promptLoop.active = true;
    const myToken = ++promptLoop.token; // 이전 루프/in-flight 응답 무효화
    (async function loop() {
      while (promptLoopAlive(myToken)) {
        try {
          const resp = await fetch(API + '/vlm/prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ camera_id: 'CAM-' + PROMPT_CAM_NUM, prompt: currentPromptText() }),
          });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const d = await resp.json();
          if (!promptLoopAlive(myToken)) return; // 응답 도착 시 이미 닫힘/전환됨
          if (d.ok && d.text) enqueueCaption(d.text);
          await sleep(PROMPT_INTERVAL_MS);
        } catch (e) {
          if (!promptLoopAlive(myToken)) return;
          console.error('[VLM 프롬프트] 실패:', e);
          await sleep(PROMPT_ERROR_BACKOFF_MS);
        }
      }
    })();
  }
  function stopPromptLoop() {
    promptLoop.active = false;
    promptLoop.token++;
  }
  // 입력 바 [전송]/Enter — 루프가 매 요청 입력창을 읽으므로 다음 질의부터 반영된다.
  window.sendCctvPrompt = function (ev) {
    if (ev) ev.preventDefault();
    if (window.showToast) showToast('프롬프트 적용 — 다음 응답부터 반영됩니다', 'ok');
  };

  window.closeCCTV = function () {
    // CAM-1 분석 루프는 메인화면 토글이 제어하므로 모달을 닫아도 멈추지 않는다.
    document.querySelectorAll('.cctv-btn-item').forEach(b => b.classList.remove('monitoring'));
    document.getElementById('cctvOverlay').classList.remove('open');
    const image = document.getElementById('cctvImage');
    if (image) image.src = ''; // MJPEG 스트림 중단(자원 절약)
    stopPromptLoop();
    clearCaption();
    const vlm = document.getElementById('cctvVlmOverlay');
    if (vlm) vlm.classList.remove('show');
  };
  window.openCCTVFor = function (region) {
    document.getElementById('cctvHeadSub').textContent = region + ' · 실시간';
    const cam = camNumFrom(region);
    const image = document.getElementById('cctvImage');
    const vlm = document.getElementById('cctvVlmOverlay');
    const bar = document.getElementById('cctvPromptBar');
    if (vlm) vlm.classList.remove('show');
    stopPromptLoop();
    clearCaption();
    if (image) { image.style.display = 'block'; image.src = cctvLiveSrc(cam); }
    document.getElementById('cctvOverlay').classList.add('open');
    if (cam === PROMPT_CAM_NUM) {
      // 신규 CCTV: 프롬프트 입력 바 노출 + 모달 팝업 즉시 질의 시작
      if (bar) bar.style.display = 'flex';
      startPromptLoop();
    } else {
      if (bar) bar.style.display = 'none';
      syncCctvAnalysisUi(); // 기존 CCTV: 분석은 메인화면 토글이 제어 — 현재 상태만 반영
    }
  };

  /* ===================== VLM / TTS ===================== */

  window.showToast = function (msg, kind) {
    let el = document.getElementById('kioskToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kioskToast';
      el.className = 'kiosk-toast';
      document.body.appendChild(el);
    }
    el.className = 'kiosk-toast ' + (kind || 'warn');
    el.textContent = msg;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2600);
  };

  /* ----- VLM 연속 분석 루프 (기존 CCTV · CAM-1) -----
   * 메인화면의 "위험행동 분석" 토글이 켜지면 시작하고, 응답이 올 때마다 즉시
   * 다음 요청을 보낸다. 토글을 끄면(토큰 무효화) 루프가 멈춘다.            */
  // VLM 분석 요청 주기(성공 응답 후 다음 요청까지 대기). 값은 이 상수 하나로만 조정.
  const VLM_POLL_INTERVAL_MS = 0;
  const VLM_ERROR_BACKOFF_MS = 1500; // 오류 시 재시도 전 대기
  // enabled: 메인화면 ON/OFF 토글이 결정하는 마스터 상태(분석 자체의 가동 여부).
  const vlmLoop = { token: 0, enabled: false };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 가장 최근 VLM 분석 결과 — 현장 특이사항 탭의 "VLM 위험행동 감지" 항목 소스.
  let lastVlmDetection = null;

  function cctvModalOpen() {
    const o = document.getElementById('cctvOverlay');
    return !!(o && o.classList.contains('open'));
  }

  function renderVlmResult(d) {
    document.getElementById('vlmDetection').textContent = d.detection || '— (위험행동 미감지)';
    document.getElementById('vlmWarning').textContent = d.warning_text || '—';
    const wl = d.warning_light || {};
    const ledTxt = wl.led && wl.led.status ? ' · LED ' + (wl.led.status === 'sent' ? '점등' : wl.led.status) : '';
    document.getElementById('vlmLight').textContent = (wl.label || '—') + (wl.trigger_count != null ? ' (누적 ' + wl.trigger_count + '회)' : '') + ledTxt;
    const tts = d.tts || {};
    document.getElementById('vlmTts').textContent = {
      synthesized: '🔊 음성 안내 재생 중',
      stubbed: '🔊 음성 안내 재생 중(스텁)',
      skipped: '경고문 없음 — 미재생',
      failed: '재생 실패: ' + (tts.detail || ''),
    }[tts.status] || (tts.status || '—');
  }

  // 불안전행동 감시 신호등에서 체크된 항목의 라벨 키 목록.
  // 체크된 행동만 VLM 분석 대상에 포함시킨다(미체크는 제외).
  function selectedFocusLabels() {
    return Array.from(document.querySelectorAll('.bhm-focus-cb:checked'))
      .map((cb) => cb.dataset.focusKey)
      .filter(Boolean);
  }
  // 체크박스 토글 핸들러(인라인 onchange용). 선택은 다음 분석 요청 때 자동 반영된다.
  window.onFocusToggle = function () { /* 선택값은 요청 시점에 읽으므로 별도 처리 불필요 */ };

  // 1회 분석 요청 + 렌더. token 이 어긋나거나 모달이 닫혔으면 결과 렌더를 건너뛴다.
  // 분석 대상은 기존 CCTV(CAM-1) 고정 — 신규 CCTV(CAM-2)는 프롬프트 질의 전용.
  async function runVlmAnalysisOnce(token) {
    const camId = 'CAM-1';
    const processCode = (window.currentProcessCode && window.currentProcessCode()) || '';

    const resp = await fetch(API + '/vlm/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera_id: camId, process_code: processCode, labels: selectedFocusLabels() }),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const d = await resp.json();
    if (vlmLoop.token !== token || !vlmLoop.enabled) return; // 응답 도착 시 이미 중단/전환됨
    lastVlmDetection = d;
    renderVlmResult(d);
    // 이상현상(쿨다운 통과한 실제 카운트 발생) 시 중앙 CCTV 아이콘에 미니 팝업 알림.
    if (d.behaviors && d.behaviors.length) showCctvAlert();
    // 결과 오버레이는 CCTV 모달이 열려 있을 때만 노출(분석은 모달과 무관하게 계속).
    if (cctvModalOpen()) document.getElementById('cctvVlmOverlay').classList.add('show');
    hydrateMatrix(processCode).catch(() => {}); // 메인화면 신호등 행렬은 항상 갱신
  }

  // 분석 루프 시작(토글 ON 시).
  function startVlmLoop() {
    const myToken = ++vlmLoop.token; // 이전 루프/in-flight 응답 무효화
    const det = document.getElementById('vlmDetection');
    if (det && cctvModalOpen()) {
      // 직전 분석 결과는 다음 응답이 도착할 때까지 그대로 유지한다.
      // (아직 한 번도 결과가 없을 때만 안내 문구를 보여준다)
      const cur = det.textContent.trim();
      if (!cur || cur === '—') det.textContent = '분석 요청 중…';
      document.getElementById('cctvVlmOverlay').classList.add('show');
    }
    (async function loop() {
      while (vlmLoop.token === myToken && vlmLoop.enabled) {
        try {
          await runVlmAnalysisOnce(myToken);
          // 성공 → 다음 요청까지 대기 (요청 → 응답 → 대기 → 요청)
          await sleep(VLM_POLL_INTERVAL_MS);
        } catch (e) {
          if (vlmLoop.token !== myToken || !vlmLoop.enabled) break;
          console.error('[VLM 분석] 실패:', e);
          if (cctvModalOpen()) {
            document.getElementById('vlmDetection').textContent = '분석 실패: ' + e.message;
            document.getElementById('vlmWarning').textContent = '백엔드 연결을 확인하세요';
            document.getElementById('cctvVlmOverlay').classList.add('show');
          }
          await sleep(VLM_ERROR_BACKOFF_MS); // 오류 백오프 후 재시도
        }
      }
    })();
  }

  // 루프 중단(토큰 무효화). 진행 중 요청의 응답은 token 불일치로 렌더되지 않음.
  function stopVlmLoop() {
    vlmLoop.token++;
  }
  window.startVlmLoop = startVlmLoop;
  window.stopVlmLoop = stopVlmLoop;

  /* ----- 메인화면 ON/OFF 토글: 분석 가동의 마스터 스위치 ----- */
  function updateVlmToggle() {
    const t = document.getElementById('vlmToggle');
    if (!t) return;
    t.classList.toggle('on', vlmLoop.enabled);
    t.setAttribute('aria-checked', vlmLoop.enabled ? 'true' : 'false');
    const txt = t.querySelector('.vlm-toggle-text');
    if (txt) txt.textContent = vlmLoop.enabled ? 'ON' : 'OFF';
  }

  function setVlmEnabled(on) {
    on = !!on;
    if (vlmLoop.enabled === on) { updateVlmToggle(); return; }
    vlmLoop.enabled = on;
    updateVlmToggle();
    if (on) {
      startVlmLoop(); // 가동 시작(모달 개폐와 무관하게 주기적으로 /vlm/infer 요청)
    } else {
      stopVlmLoop(); // 루프 중단
      // 대기/지연 TTS 폐기(재생 중인 건 끝까지) — OFF 후 음성이 더 나오지 않도록
      fetch(API + '/vlm/stop', { method: 'POST' }).catch(() => {});
      const ov = document.getElementById('cctvVlmOverlay');
      if (ov && !cctvModalOpen()) ov.classList.remove('show');
    }
  }
  window.toggleVlm = function () { setVlmEnabled(!vlmLoop.enabled); };
  window.setVlmEnabled = setVlmEnabled;

  // CCTV 모달이 열릴 때 현재 분석 상태를 오버레이에 반영(분석을 시작하지는 않음).
  function syncCctvAnalysisUi() {
    const ov = document.getElementById('cctvVlmOverlay');
    if (vlmLoop.enabled) {
      const det = document.getElementById('vlmDetection');
      if (det) { const cur = det.textContent.trim(); if (!cur || cur === '—') det.textContent = '분석 요청 중…'; }
      if (ov) ov.classList.add('show');
    } else {
      if (ov) ov.classList.remove('show');
    }
  }
  window.syncCctvAnalysisUi = syncCctvAnalysisUi;

  /* ===================== 신호등 행렬 / 공정 / 경광등 ===================== */
  // 카운트 → 램프 단계 임계값. 백엔드(KIOSK_LIGHT_*_THRESHOLD)와 동일하게 유지할 것.
  // 0~9 소등 / 10~19 관심(초록) / 20~39 주의(노랑) / 40~49 경고(빨강) / 50+ 위험(점멸)
  const LIGHT_THRESHOLDS = { interest: 10, caution: 20, warning: 40, danger: 50 };
  function countToLevel(count) {
    if (count >= LIGHT_THRESHOLDS.danger)   return 3;  // 위험(점멸)
    if (count >= LIGHT_THRESHOLDS.warning)  return 2;  // 경고(빨강)
    if (count >= LIGHT_THRESHOLDS.caution)  return 1;  // 주의(노랑)
    if (count >= LIGHT_THRESHOLDS.interest) return 0;  // 관심(초록)
    return -1;                                         // 0회 소등
  }

  /* ----- 신호등 카운트 기준치 설정 패널 (상단 [기준치] 버튼) -----
   * ▲▼로 관심/주의/경고/위험 임계값을 조절하고 [설정]을 누르면 LIGHT_THRESHOLDS에
   * 반영 + localStorage 저장(새로고침 후 유지) + 매트릭스 즉시 재렌더한다.        */
  const THR_KEYS = ['interest', 'caution', 'warning', 'danger'];
  const THR_STORAGE_KEY = 'kioskLightThresholds';
  let thrDraft = { ...LIGHT_THRESHOLDS }; // 패널에서 편집 중인 임시값(설정 전까지 미반영)

  function loadSavedThresholds() {
    try {
      const saved = JSON.parse(localStorage.getItem(THR_STORAGE_KEY) || 'null');
      if (!saved) return;
      THR_KEYS.forEach((k) => { if (Number.isFinite(saved[k])) LIGHT_THRESHOLDS[k] = saved[k]; });
    } catch (_) { /* 손상된 저장값 무시 */ }
  }
  function renderThrValues() {
    THR_KEYS.forEach((k) => {
      const el = document.getElementById('thrVal-' + k);
      if (el) el.textContent = String(thrDraft[k]);
    });
  }
  window.toggleThrPanel = function () {
    const p = document.getElementById('thrPanel');
    if (!p) return;
    if (p.classList.contains('open')) { window.closeThrPanel(); return; }
    thrDraft = { ...LIGHT_THRESHOLDS }; // 열 때 현재 적용값으로 초기화
    renderThrValues();
    p.classList.add('open');
  };
  window.closeThrPanel = function () {
    const p = document.getElementById('thrPanel');
    if (p) p.classList.remove('open');
  };
  // ▲▼ 스테퍼: 임시값만 조절(최소 1). 실제 반영은 [설정]을 눌러야 한다.
  window.stepThr = function (key, delta) {
    if (!(key in thrDraft)) return;
    thrDraft[key] = Math.max(1, (Number(thrDraft[key]) || 0) + delta);
    renderThrValues();
  };
  // [설정]: 오름차순 검증 후 서버(PUT /led/thresholds)에 저장 → 신호등 UI + 실물
  // 경광등이 같은 값을 공유. 서버 미연결이면 신호등에만 로컬 반영(경광등 미반영).
  window.applyThr = async function () {
    const t = thrDraft;
    if (!(t.interest < t.caution && t.caution < t.warning && t.warning < t.danger)) {
      if (window.showToast) showToast('기준치는 관심 < 주의 < 경고 < 위험 순으로 커야 합니다', 'warn');
      return;
    }
    let msg = '신호등·경광등 기준치를 적용했습니다', kind = 'ok';
    try {
      const resp = await fetch(API + '/led/thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t),
      });
      if (!resp.ok) {
        let detail = '기준치 저장 실패';
        try { const e = await resp.json(); if (e && e.detail) detail = e.detail; } catch (_) {}
        if (window.showToast) showToast(detail, 'warn');
        return; // 서버 검증 실패 시 반영하지 않음
      }
      const saved = await resp.json();
      THR_KEYS.forEach((k) => { if (Number.isFinite(saved[k])) LIGHT_THRESHOLDS[k] = saved[k]; });
    } catch (_) {
      THR_KEYS.forEach((k) => { LIGHT_THRESHOLDS[k] = t[k]; });
      msg = '서버 미연결 — 신호등에만 적용됨(경광등 미반영)'; kind = 'warn';
    }
    try { localStorage.setItem(THR_STORAGE_KEY, JSON.stringify(LIGHT_THRESHOLDS)); } catch (_) {}
    hydrateMatrix(currentProcessCode()).catch(() => {}); // 즉시 재렌더(실패해도 다음 폴링이 갱신)
    window.closeThrPanel();
    if (window.showToast) showToast(msg, kind);
  };

  // 서버의 공용 기준치를 받아 신호등에 반영(단일 소스 동기화). 실패 시 localStorage 유지.
  async function fetchThresholds() {
    try {
      const resp = await fetch(API + '/led/thresholds', { cache: 'no-store' });
      if (!resp.ok) return;
      const t = await resp.json();
      THR_KEYS.forEach((k) => { if (Number.isFinite(t[k])) LIGHT_THRESHOLDS[k] = t[k]; });
      try { localStorage.setItem(THR_STORAGE_KEY, JSON.stringify(LIGHT_THRESHOLDS)); } catch (_) {}
    } catch (_) { /* 오프라인이면 localStorage 값 유지 */ }
  }

  loadSavedThresholds(); // 스크립트 로드 시 localStorage 값으로 우선 표시(서버 응답 전까지)

  async function hydrateMatrix(processCode) {
    const path = '/space-name' + (processCode ? '?process_code=' + encodeURIComponent(processCode) : '');
    const resp = await fetch(API + path, { cache: 'no-store' });
    if (!resp.ok) throw new Error('GET /space-name → ' + resp.status);
    const data = await resp.json();
    const rows = document.querySelectorAll('#bhMatrix .bh-matrix-row');
    if (Array.isArray(data.behaviors)) {
      data.behaviors.forEach((b, idx) => {
        const row = rows[idx];
        if (!row) return;
        const level = countToLevel(b.count);
        const lamps = row.querySelectorAll('.bhm-lamp');
        lamps.forEach(l => l.classList.remove('on'));
        if (lamps[level]) lamps[level].classList.add('on');
        row.dataset.active = String(level);
      });
    }
    return data;
  }
  window.hydrateMatrix = hydrateMatrix;

  // 현재 선택된 공정 코드 (커스텀 드롭다운: 활성 .bps-option)
  function currentProcessCode() {
    const opt = document.querySelector('#bhProcDropdown .bps-option.active');
    if (!opt) return '';
    if (opt.dataset.code) return opt.dataset.code;
    const v = opt.dataset.value || opt.textContent || '';
    const m = /(PRC-\d+)/i.exec(v);
    return m ? m[1] : v.trim();
  }
  window.currentProcessCode = currentProcessCode;

  // /space-name 의 processes(실제 DB 공정 목록)로 커스텀 드롭다운을 채운다.
  async function populateProcesses() {
    const dd = document.getElementById('bhProcDropdown');
    const label = document.getElementById('bhProcLabel');
    if (!dd) return;
    const resp = await fetch(API + '/space-name', { cache: 'no-store' });
    if (!resp.ok) throw new Error('GET /space-name → ' + resp.status);
    const data = await resp.json();
    const procs = Array.isArray(data.processes) ? data.processes : [];
    if (!procs.length) return; // 비어 있으면 기존(하드코딩) 옵션 유지
    const current = (data.process && data.process.code) || procs[0].code;
    dd.innerHTML = '';
    procs.forEach((p, i) => {
      const li = document.createElement('li');
      const active = String(p.code) === String(current);
      li.className = 'bps-option' + (active ? ' active' : '');
      li.dataset.value = (p.label || p.name || p.code);
      li.dataset.code = p.code;
      li.dataset.cctv = String((i % 2) + 1); // CCTV 2대(CAM-1/CAM-2)에 번갈아 매핑
      li.textContent = p.label || p.name || p.code;
      li.setAttribute('onclick', 'bhPickProc(this)');
      dd.appendChild(li);
      if (active && label) label.textContent = li.textContent;
    });
    // 새로 채운 드롭다운의 active 공정에 맞춰 CCTV 강조 동기화
    if (typeof window.syncMonitoringToProc === 'function') window.syncMonitoringToProc();
  }

  // 초기화 버튼: UI 즉시 소등 + 백엔드 count 0 리셋
  window.resetBehavior = async function () {
    const processCode = currentProcessCode();
    document.querySelectorAll('#bhMatrix .bh-matrix-row').forEach(row => {
      row.querySelectorAll('.bhm-lamp').forEach(l => l.classList.remove('on'));
      row.dataset.active = '-1';
    });
    try {
      await fetch(API + '/behavior/reset?process_code=' + encodeURIComponent(processCode), { method: 'POST' });
    } catch (_) { /* 오프라인이면 무시 */ }
  };

  // 신호등 헤더 칸(관심/주의/경고/위험) 클릭 → 실물 경광등 점등
  const LED_LABEL = { interest: '관심', caution: '주의', warning: '경고', danger: '위험' };
  window.triggerLed = async function (level, btn) {
    const allBtns = Array.from(document.querySelectorAll('.bhm-led-btn'));
    allBtns.forEach(b => { b.disabled = true; });
    if (btn) btn.classList.add('fired');
    let cooldown = 1200;
    try {
      const resp = await fetch(API + '/led/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: level }),
      });
      const name = LED_LABEL[level] || level;
      if (!resp.ok) {
        let detail = 'HTTP ' + resp.status;
        try { const err = await resp.json(); if (err && err.detail) detail = err.detail; } catch (_) {}
        throw new Error(detail);
      }
      const d = await resp.json();
      if (d.status === 'sent') {
        cooldown = ((d.signal && d.signal.duration_ms) || 5000) + 300;
        setConn(true, '경광등 ' + name + ' 점등 중…');
      } else if (d.status === 'simulated') {
        setConn(true, '경광등 ' + name + ' · 시뮬(장치 없음)');
      } else {
        setConn(true, '경광등 ' + name + ' · dry-run');
      }
    } catch (e) {
      setConn(false, '경광등 실패: ' + e.message);
    } finally {
      setTimeout(() => {
        allBtns.forEach(b => { b.disabled = false; });
        if (btn) btn.classList.remove('fired');
      }, cooldown);
    }
  };

  /* ===================== 연결 상태 배지 ===================== */
  const badge = document.createElement('div');
  badge.id = 'connBadge';
  badge.className = 'conn-badge';
  function setConn(ok, msg) {
    const col = ok ? '#16A34A' : '#DC2626';
    badge.innerHTML =
      '<span class="conn-dot" style="background:' + col + ';box-shadow:0 0 8px ' + col + ';"></span>' +
      (ok ? '백엔드 연결됨' : '백엔드 오프라인') + ' · :8080' + (msg ? ' · ' + msg : '');
  }

  /* ===================== 현장 특이사항 관리 모달 ===================== */
  // 온습도 이상 임계값(현장 특이사항 감지 기준).
  const HEAT_HI = 31, HEAT_LO = 5, HUM_HI = 70, HUM_LO = 20;

  function nowHMS() {
    const d = new Date(), p = (n) => ('0' + n).slice(-2);
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  // 현장 특이사항 누적 로그: 스냅샷이 아니라 "가장 위가 최신"인 이력으로 최대 5개까지
  // 쌓고, 새 항목이 들어오면 가장 오래된 것이 아래로 밀려 사라진다(rolling window).
  //
  // 누적 규칙(소스별 연속 중복 제거):
  //  - 어떤 소스(VLM / 워커별 심박 / 구역별 온습도)의 최신 감지가 직전과 "같으면"
  //    새 줄을 만들지 않고 해당 줄의 시간만 갱신한다.
  //  - "다르면" 새 줄로 맨 위에 쌓는다.
  //  예) A,B 누적 상태에서 B가 계속 감지되면 B의 시간만 갱신(A B), C가 감지되면
  //      A B C, 다시 B가 감지되면 A B C B (직전 최신이 C라 새 B 줄이 쌓임).
  //  소스별로 비교하므로 VLM·심박·온습도가 동시에 떠도 서로 번갈아 도배되지 않는다.
  const SITE_ISSUE_MAX = 5;
  let siteIssueLog = [];        // [{src, sig, sev, title, desc, time}] — newest first
  const issueLastSig = {};      // 소스 -> 그 소스의 직전 시그니처(연속 중복 판정용)
  const issueSig = (it) => it.src + '|' + it.sev + '|' + it.title + '|' + it.desc;

  // 탭1: VLM 위험행동 · 작업자 심박 · 현장 온습도 이상을 실시간으로 모아 [감지] 카드로 렌더.
  async function renderSiteIssues() {
    const list = document.getElementById('siteIssueList');
    if (!list) return;
    const items = [];

    // 1) VLM 위험행동(가장 최근 분석 결과)
    if (lastVlmDetection && lastVlmDetection.detection) {
      items.push({
        src: 'vlm',
        sev: 'high',
        title: 'VLM 위험행동 감지: ' + lastVlmDetection.detection,
        desc: lastVlmDetection.warning_text || '안전관리자 확인 필요',
      });
    }

    // 2) 작업자 심박 이상(정상이 아닌 워치)
    try {
      const w = await fetchJson('/sensor/watch');
      (w.workers || []).forEach((x) => {
        if (x.status && x.status !== '정상') {
          items.push({
            src: 'hr:' + (x.name || x.watch_id),
            sev: x.status === '위험' ? 'high' : 'mid',
            title: '작업자 심박 이상 (' + (x.name || x.watch_id) + ')',
            desc: [x.zone, Number(x.hr || 0) + 'bpm', x.status].filter(Boolean).join(' · '),
          });
        }
      });
    } catch (e) { /* 백엔드 일시 오류는 무시 */ }

    // 3) 현장 온습도 이상
    try {
      const t = await fetchJson('/sensor/temp-humid');
      (t.readings || []).forEach((r) => {
        const temp = Number(r.temp), hum = Number(r.humidity);
        const z = r.zone || r.sensor_name || '센서';
        if (temp >= HEAT_HI) items.push({ src: 'th:' + z + ':t', sev: 'mid', title: '고온 이상 (' + z + ')', desc: '현재 ' + temp.toFixed(1) + '°C · 온열질환 주의' });
        else if (temp <= HEAT_LO) items.push({ src: 'th:' + z + ':t', sev: 'mid', title: '저온 이상 (' + z + ')', desc: '현재 ' + temp.toFixed(1) + '°C · 한랭질환 주의' });
        if (hum >= HUM_HI) items.push({ src: 'th:' + z + ':h', sev: 'low', title: '다습 이상 (' + z + ')', desc: '현재 습도 ' + hum.toFixed(0) + '%' });
        else if (hum <= HUM_LO) items.push({ src: 'th:' + z + ':h', sev: 'low', title: '건조 이상 (' + z + ')', desc: '현재 습도 ' + hum.toFixed(0) + '%' });
      });
    } catch (e) { /* 무시 */ }

    const stamp = nowHMS();
    // 소스별로 직전 시그니처와 비교: 같으면 해당 줄 시간만 갱신, 다르면 새 줄로 누적.
    for (const it of items) {
      const sig = issueSig(it);
      if (issueLastSig[it.src] === sig) {
        const e = siteIssueLog.find((x) => x.sig === sig); // 최신 동일 줄의 시간만 갱신
        if (e) { e.time = stamp; continue; }
        // 로그 5개 밖으로 밀려나 사라진 경우엔 아래 분기로 떨어져 다시 쌓는다.
      }
      issueLastSig[it.src] = sig;
      siteIssueLog.unshift({ src: it.src, sev: it.sev, title: it.title, desc: it.desc, sig, time: stamp });
    }
    if (siteIssueLog.length > SITE_ISSUE_MAX) siteIssueLog.length = SITE_ISSUE_MAX; // 최대 5개 유지

    if (!siteIssueLog.length) {
      list.innerHTML = '<div class="issue-empty">현재 감지된 이상이 없습니다 · 실시간 모니터링 중</div>';
    } else {
      list.innerHTML = siteIssueLog.map((it) => `
        <div class="issue-item sev-${it.sev}">
          <div class="issue-time">${it.time}</div>
          <div class="issue-body">
            <div class="issue-title">${it.title}</div>
            <div class="issue-desc">${it.desc}</div>
          </div>
          <span class="issue-badge detect">감지</span>
        </div>`).join('');
    }
    const sum = document.getElementById('issueSummary');
    if (sum) sum.textContent = '최근 ' + siteIssueLog.length + '건 · ' + stamp;
  }

  // 탭2: 현장 특성 — '현장 위치 이름' 기준. level 0=상위 구역, 1=하위 작업존.
  // 참조 이미지 기준으로 밀폐공간만 일부 해당(나머지 컬럼은 미해당).
  // proc: 연결 공정(대표 1개), more: 추가 연결 공정 수("외 N개"). 참조 이미지 기준.
  const SITE_TRAITS = [
    { name: '도장부스',            level: 0, psm: false, confined: false, heat: false, cold: false, proc: '도장 및 표면처리 공정', more: 2, moreList: ['기계조립공정', '정밀가공공정'] },
    { name: '도장 전 준비구역',     level: 1, psm: false, confined: false, heat: false, cold: false, proc: '' },
    { name: '도장작업실',          level: 1, psm: false, confined: false, heat: false, cold: false, proc: '정밀가공 공정' },
    { name: '출하대기장',          level: 0, psm: false, confined: false, heat: false, cold: false, proc: '' },
    { name: '포장라인',            level: 1, psm: false, confined: false, heat: false, cold: false, proc: '' },
    { name: '검수존',              level: 1, psm: false, confined: false, heat: false, cold: false, proc: '' },
    { name: '밀폐작업구역',         level: 0, psm: false, confined: true,  heat: false, cold: false, proc: '기계조립공정', more: 1, moreList: ['정밀가공 공정'] },
    { name: '밀폐내부 작업존',      level: 1, psm: false, confined: true,  heat: false, cold: false, proc: '시료채취 작업', more: 1, moreList: ['정밀가공공정'] },
    { name: '정비투입구역',         level: 1, psm: false, confined: true,  heat: false, cold: false, proc: '정밀가공 공정' },
    { name: '안전보건교육장',       level: 0, psm: false, confined: false, heat: false, cold: false, proc: '' },
    { name: '작업허가서 발급창구',   level: 0, psm: false, confined: false, heat: false, cold: false, proc: '' },
    { name: '용접실1',             level: 0, psm: false, confined: false, heat: false, cold: false, proc: '' },
    { name: '용접대기존',          level: 1, psm: false, confined: false, heat: false, cold: false, proc: '' },
    { name: '용접작업대',          level: 1, psm: false, confined: false, heat: false, cold: false, proc: '' },
    { name: '직원휴게실',          level: 0, psm: false, confined: false, heat: false, cold: false, proc: '' },
    { name: '가공라인2',           level: 0, psm: false, confined: true,  heat: false, cold: false, proc: '' },
    { name: 'CNC가공존',           level: 1, psm: false, confined: false, heat: false, cold: false, proc: 'CNC 가공공정' },
    { name: '공구교환 및 보정구역',  level: 1, psm: false, confined: false, heat: false, cold: false, proc: '' },
    { name: '가공라인1',           level: 0, psm: false, confined: true,  heat: false, cold: false, proc: '' },
    { name: '절단기 작업존',        level: 1, psm: false, confined: false, heat: false, cold: false, proc: '정밀가공 공정' },
  ];

  function renderSiteTraits() {
    const tb = document.getElementById('traitTableBody');
    if (!tb) return;
    const cell = (v) => v
      ? '<td><i class="ri-checkbox-circle-fill tc-on"></i></td>'
      : '<td><i class="ri-close-circle-fill tc-off"></i></td>';
    const procCell = (s) => {
      if (!s.proc) return '<td class="tt-proc tt-proc-none">-</td>';
      let more = '';
      if (s.more) {
        const tip = (s.moreList && s.moreList.length)
          ? ' data-tip="' + s.moreList.join(', ').replace(/"/g, '&quot;') + '"' : '';
        more = ' <span class="tt-more"' + tip + '>외 ' + s.more + '개</span>';
      }
      return '<td class="tt-proc">' + s.proc + more + '</td>';
    };
    tb.innerHTML = SITE_TRAITS.map((s) => {
      const cls = s.level ? 'tt-label tt-child' : 'tt-label tt-parent';
      const toggle = s.level ? '' : '<span class="tt-toggle">−</span>';
      return `<tr>
        <td class="tt-name"><div class="${cls}">${toggle}<span>${s.name}</span></div></td>
        ${cell(s.psm)}${cell(s.confined)}${cell(s.heat)}${cell(s.cold)}${procCell(s)}
      </tr>`;
    }).join('');
  }

  // app.js 더미 버전 덮어쓰기 — 첫 탭(현장 특이사항) 실시간, 둘째 탭(현장 특성) 표.
  window.openIssueMgmt = function () {
    const ov = document.getElementById('issueOverlay');
    if (!ov) return;
    if (window.switchTab) switchTab('tab-issues', document.querySelector('#issueOverlay .tab-btn'));
    renderSiteTraits();
    ov.classList.add('open');
    renderSiteIssues();                              // 즉시 1회
    startModalPoll('issueOverlay', renderSiteIssues); // 열려 있는 동안 실시간 갱신
  };
  window.renderSiteIssues = renderSiteIssues;
  window.renderSiteTraits = renderSiteTraits;

  /* ===================== 초기화 ===================== */
  async function init() {
    document.body.appendChild(badge);
    setConn(false, '연결 중…');

    // 라이브 센서 폴링(모달·공정 행렬이 읽는 liveSensors 갱신) — 2초 주기
    refreshLiveSensors().catch(() => {});
    setInterval(() => refreshLiveSensors().catch(() => {}), LIVE_POLL_MS);

    // 공정 드롭다운을 실제 DB 목록으로 채움(실패해도 하드코딩 옵션 유지)
    try { await populateProcesses(); }
    catch (e) { console.warn('[공정 목록] 동적 로드 실패, 기본 옵션 사용:', e.message); }

    // 서버의 공용 기준치를 신호등에 동기화(경광등과 같은 값 사용)
    await fetchThresholds();

    // 신호등 행렬 초기 동기화 + 2초마다 자동 갱신(F5 불필요)
    try { await hydrateMatrix(currentProcessCode()); setConn(true, '신호등 동기화 완료'); }
    catch (e) { setConn(false, e.message); }
    setInterval(() => hydrateMatrix(currentProcessCode()).catch(() => {}), MATRIX_POLL_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
