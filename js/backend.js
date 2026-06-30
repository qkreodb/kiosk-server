/* =====================================================================
 * backend.js — 백엔드(PORT 8080) 연동 계층
 * ---------------------------------------------------------------------
 * 디자인(app.js)은 정적/더미 동작만 담고, 실제 서버 연동 기능은 여기에 모은다.
 * app.js 다음에 로드되어 일부 함수(openCCTV/openEnvDetail 등)를 실서버 버전으로
 * 덮어쓴다(window 재할당). 인라인 onclick 에서 호출되는 함수는 window 에 노출한다.
 *
 *   GET  /space-name            → 신호등 행렬 + 공정 드롭다운
 *   POST /behavior/reset        → 카운트 0 리셋(경광등 소등)
 *   POST /vlm/infer             → CCTV [분석] 결과 오버레이
 *   POST /tts/demo              → CCTV [TTS] 데모 재생
 *   POST /led/trigger           → 신호등 헤더(관심/주의/경고/위험) 경광등 점등
 *   GET  /sensor/temp-humid     → 온습도 라이브
 *   GET  /sensor/watch          → 스마트워치 심박 라이브
 *   GET  /cctv/live             → 중앙 전시홀 IP카메라 RTSP→MJPEG 중계
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
  function cctvLiveSrc() { return (window.__API_BASE || 'http://localhost:8080') + '/cctv/live?ts=' + Date.now(); }
  function isCentralCctv(region) {
    return String(region || '').includes('중앙 전시홀') || String(region || '').includes('Central Hall');
  }

  window.openCCTV = function () {
    const frame = document.getElementById('cctvFrame');
    const image = document.getElementById('cctvImage');
    if (image) { image.src = ''; image.style.display = 'none'; }
    if (frame) { frame.style.display = 'block'; frame.src = cctvSrc(true); }
    document.getElementById('cctvOverlay').classList.add('open');
    syncCctvAnalysisUi(); // 분석은 메인화면 토글이 제어 — 현재 상태만 반영
  };
  window.closeCCTV = function () {
    // 분석 루프는 메인화면 토글이 제어하므로 모달을 닫아도 멈추지 않는다.
    document.querySelectorAll('.cctv-btn-item').forEach(b => b.classList.remove('monitoring'));
    document.getElementById('cctvOverlay').classList.remove('open');
    const frame = document.getElementById('cctvFrame');
    const image = document.getElementById('cctvImage');
    if (frame) frame.src = '';
    if (image) image.src = '';
    const vlm = document.getElementById('cctvVlmOverlay');
    if (vlm) vlm.classList.remove('show');
  };
  window.switchCam = function (el, locName, locProc) {
    document.querySelectorAll('.cctv-cam-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('cctvLocName').textContent = locName;
    document.getElementById('cctvLocProc').textContent = locProc;
    const frame = document.getElementById('cctvFrame');
    const image = document.getElementById('cctvImage');
    if (image) { image.src = ''; image.style.display = 'none'; }
    if (frame) { frame.style.display = 'block'; frame.src = cctvSrc(true); }
    // 가동 중이면 다음 요청부터 새 카메라로 자동 반영(루프가 매 요청마다 활성 카메라를 읽음).
  };
  window.openCCTVFor = function (region) {
    document.getElementById('cctvHeadSub').textContent = region + ' · 실시간';
    document.getElementById('cctvLocName').textContent = region + ' CCTV';
    document.getElementById('cctvLocProc').textContent = region + ' · 작업 현장';
    const frame = document.getElementById('cctvFrame');
    const image = document.getElementById('cctvImage');
    const vlm = document.getElementById('cctvVlmOverlay');
    if (vlm) vlm.classList.remove('show');
    if (isCentralCctv(region) && image) {
      // 중앙 전시홀: IP 카메라 RTSP 실시간 영상을 서버 MJPEG 중계로 송출
      if (frame) { frame.src = ''; frame.style.display = 'none'; }
      image.style.display = 'block';
      image.src = cctvLiveSrc();
    } else {
      if (image) { image.src = ''; image.style.display = 'none'; }
      if (frame) { frame.style.display = 'block'; frame.src = cctvSrc(true); }
    }
    document.getElementById('cctvOverlay').classList.add('open');
    syncCctvAnalysisUi(); // 분석은 메인화면 토글이 제어 — 현재 상태만 반영
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

  window.playTtsDemo = async function () {
    const btn = document.getElementById('cctvTtsBtn');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg> 재생 중…';
    try {
      const resp = await fetch((window.__API_BASE || 'http://localhost:8080') + '/tts/demo', { method: 'POST' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      await resp.json();
      btn.style.borderColor = 'var(--green)';
      btn.style.color = 'var(--green)';
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> 완료';
      setTimeout(resetTtsBtn, 1500);
    } catch (e) {
      resetTtsBtn();
    }
    function resetTtsBtn() {
      btn.style.borderColor = '';
      btn.style.color = '';
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg> TTS';
      btn.disabled = false;
    }
  };

  /* ----- VLM 연속 분석 루프 -----
   * CCTV 모달이 열리면 분석을 시작하고, 응답이 올 때마다 즉시 다음 요청을 보낸다.
   * 모달을 닫으면(또는 카메라 전환 시 토큰 무효화) 루프가 멈춘다.
   * 분석 버튼은 이 루프의 일시정지/재개 토글로 동작한다.            */
  // VLM 분석 요청 주기(성공 응답 후 다음 요청까지 대기). 응답 속도를 정확도보다
  // 우선하는 환경이라 2~3초로 단축. 값은 이 상수 하나로만 조정한다(하드코딩 금지).
  const VLM_POLL_INTERVAL_MS = 0; // 성공 응답 후 다음 요청까지 대기(2~3초)
  const VLM_ERROR_BACKOFF_MS = 1500; // 오류 시 재시도 전 대기
  // enabled: 메인화면 ON/OFF 토글이 결정하는 마스터 상태(분석 자체의 가동 여부).
  // paused : (모달 내 [분석] 버튼) 가동 중 일시정지/재개. CCTV 모달 개폐와 무관.
  const vlmLoop = { token: 0, paused: false, enabled: false };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 가장 최근 VLM 분석 결과 — 현장 특이사항 탭의 "VLM 위험행동 감지" 항목 소스.
  let lastVlmDetection = null;

  function cctvModalOpen() {
    const o = document.getElementById('cctvOverlay');
    return !!(o && o.classList.contains('open'));
  }

  // 분석 버튼 표시 갱신: 진행 중 → '일시정지', 일시정지 → '재개'
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
  const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M11 8v6M8 11h6"/></svg>';

  function updateAnalyzeBtn() {
    const btn = document.getElementById('cctvAnalyzeBtn');
    if (!btn) return;
    btn.disabled = false;
    if (!vlmLoop.enabled) { resetAnalyzeBtn(); return; }
    if (vlmLoop.paused) {
      btn.classList.remove('analyzing');
      btn.innerHTML = ICON_PLAY + ' 재개';
    } else {
      btn.classList.add('analyzing');
      btn.innerHTML = ICON_PAUSE + ' 분석 중';
    }
  }
  function resetAnalyzeBtn() {
    const btn = document.getElementById('cctvAnalyzeBtn');
    if (!btn) return;
    btn.classList.remove('analyzing');
    btn.disabled = false;
    btn.innerHTML = ICON_SEARCH + ' 분석';
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

  // 1회 분석 요청 + 렌더. token 이 어긋나거나 모달이 닫혔으면 결과 렌더를 건너뛴다.
  async function runVlmAnalysisOnce(token) {
    const camEl = document.querySelector('.cctv-cam-chip.active .cctv-cam-id');
    const camId = camEl ? camEl.textContent.trim() : 'CAM-03';
    const processCode = (window.currentProcessCode && window.currentProcessCode()) || '';

    const resp = await fetch(API + '/vlm/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera_id: camId, process_code: processCode }),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const d = await resp.json();
    if (vlmLoop.token !== token || !vlmLoop.enabled) return; // 응답 도착 시 이미 중단/전환됨
    lastVlmDetection = d;
    renderVlmResult(d);
    // 결과 오버레이는 CCTV 모달이 열려 있을 때만 노출(분석은 모달과 무관하게 계속).
    if (cctvModalOpen()) document.getElementById('cctvVlmOverlay').classList.add('show');
    hydrateMatrix(processCode).catch(() => {}); // 메인화면 신호등 행렬은 항상 갱신
  }

  // 분석 루프 시작. opts.keepPaused: 카메라 전환 등에서 일시정지 상태 유지.
  function startVlmLoop(opts) {
    if (!(opts && opts.keepPaused)) vlmLoop.paused = false;
    const myToken = ++vlmLoop.token; // 이전 루프/in-flight 응답 무효화
    updateAnalyzeBtn();
    const det = document.getElementById('vlmDetection');
    if (det && !vlmLoop.paused && cctvModalOpen()) {
      // 직전 분석 결과는 다음 응답이 도착할 때까지 그대로 유지한다.
      // (아직 한 번도 결과가 없을 때만 안내 문구를 보여준다)
      const cur = det.textContent.trim();
      if (!cur || cur === '—') det.textContent = '분석 요청 중…';
      document.getElementById('cctvVlmOverlay').classList.add('show');
    }
    (async function loop() {
      while (vlmLoop.token === myToken && vlmLoop.enabled) {
        if (vlmLoop.paused) { await sleep(250); continue; }
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
    vlmLoop.paused = false;
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
    vlmLoop.paused = false;
    updateVlmToggle();
    if (on) {
      startVlmLoop(); // 가동 시작(모달 개폐와 무관하게 주기적으로 /vlm/infer 요청)
    } else {
      stopVlmLoop(); // 루프 중단
      // 대기/지연 TTS 폐기(재생 중인 건 끝까지) — OFF 후 음성이 더 나오지 않도록
      fetch(API + '/vlm/stop', { method: 'POST' }).catch(() => {});
      resetAnalyzeBtn();
      const ov = document.getElementById('cctvVlmOverlay');
      if (ov && !cctvModalOpen()) ov.classList.remove('show');
    }
  }
  window.toggleVlm = function () { setVlmEnabled(!vlmLoop.enabled); };
  window.setVlmEnabled = setVlmEnabled;

  // CCTV 모달이 열릴 때 현재 분석 상태를 오버레이/버튼에 반영(분석을 시작하지는 않음).
  function syncCctvAnalysisUi() {
    const ov = document.getElementById('cctvVlmOverlay');
    if (vlmLoop.enabled) {
      updateAnalyzeBtn();
      const det = document.getElementById('vlmDetection');
      if (det) { const cur = det.textContent.trim(); if (!cur || cur === '—') det.textContent = '분석 요청 중…'; }
      if (ov) ov.classList.add('show');
    } else {
      resetAnalyzeBtn();
      if (ov) ov.classList.remove('show');
    }
  }
  window.syncCctvAnalysisUi = syncCctvAnalysisUi;

  // 모달 내 [분석] 버튼 = 가동 중 일시정지/재개 토글 (마스터 OFF면 동작 안 함)
  window.analyzeCurrentCam = function () {
    if (!vlmLoop.enabled) {
      if (window.showToast) showToast('메인 화면의 “위험행동 분석” 스위치를 켜세요', 'warn');
      return;
    }
    vlmLoop.paused = !vlmLoop.paused;
    updateAnalyzeBtn();
    // 재개 시: 활성 루프가 일시정지 슬립에서 깨어나 다음 주기에 자동 재요청
  };

  /* ===================== 신호등 행렬 / 공정 / 경광등 ===================== */
  // 카운트 → 램프 단계 임계값. 백엔드(KIOSK_LIGHT_*_THRESHOLD)와 동일하게 유지할 것.
  // 0 소등 / 1~4 관심(초록) / 5~9 주의(노랑) / 10~14 경고(빨강) / 15+ 위험(점멸)
  const LIGHT_THRESHOLDS = { interest: 1, caution: 5, warning: 10, danger: 15 };
  function countToLevel(count) {
    if (count >= LIGHT_THRESHOLDS.danger)   return 3;  // 위험(점멸)
    if (count >= LIGHT_THRESHOLDS.warning)  return 2;  // 경고(빨강)
    if (count >= LIGHT_THRESHOLDS.caution)  return 1;  // 주의(노랑)
    if (count >= LIGHT_THRESHOLDS.interest) return 0;  // 관심(초록)
    return -1;                                         // 0회 소등
  }

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
      li.dataset.cctv = String((i % 3) + 1);
      li.textContent = p.label || p.name || p.code;
      li.setAttribute('onclick', 'bhPickProc(this)');
      dd.appendChild(li);
      if (active && label) label.textContent = li.textContent;
    });
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

  // 탭1: VLM 위험행동 · 작업자 심박 · 현장 온습도 이상을 실시간으로 모아 [감지] 카드로 렌더.
  async function renderSiteIssues() {
    const list = document.getElementById('siteIssueList');
    if (!list) return;
    const items = [];

    // 1) VLM 위험행동(가장 최근 분석 결과)
    if (lastVlmDetection && lastVlmDetection.detection) {
      items.push({
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
        if (temp >= HEAT_HI) items.push({ sev: 'mid', title: '고온 이상 (' + z + ')', desc: '현재 ' + temp.toFixed(1) + '°C · 온열질환 주의' });
        else if (temp <= HEAT_LO) items.push({ sev: 'mid', title: '저온 이상 (' + z + ')', desc: '현재 ' + temp.toFixed(1) + '°C · 한랭질환 주의' });
        if (hum >= HUM_HI) items.push({ sev: 'low', title: '다습 이상 (' + z + ')', desc: '현재 습도 ' + hum.toFixed(0) + '%' });
        else if (hum <= HUM_LO) items.push({ sev: 'low', title: '건조 이상 (' + z + ')', desc: '현재 습도 ' + hum.toFixed(0) + '%' });
      });
    } catch (e) { /* 무시 */ }

    const stamp = nowHMS();
    if (!items.length) {
      list.innerHTML = '<div class="issue-empty">현재 감지된 이상이 없습니다 · 실시간 모니터링 중</div>';
    } else {
      list.innerHTML = items.map((it) => `
        <div class="issue-item sev-${it.sev}">
          <div class="issue-time">${stamp}</div>
          <div class="issue-body">
            <div class="issue-title">${it.title}</div>
            <div class="issue-desc">${it.desc}</div>
          </div>
          <span class="issue-badge detect">감지</span>
        </div>`).join('');
    }
    const sum = document.getElementById('issueSummary');
    if (sum) sum.textContent = '현재 ' + items.length + '건 감지 · ' + stamp;
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

    // 신호등 행렬 초기 동기화 + 2초마다 자동 갱신(F5 불필요)
    try { await hydrateMatrix(currentProcessCode()); setConn(true, '신호등 동기화 완료'); }
    catch (e) { setConn(false, e.message); }
    setInterval(() => hydrateMatrix(currentProcessCode()).catch(() => {}), MATRIX_POLL_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
