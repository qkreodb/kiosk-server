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

  async function refreshLiveSensors() {
    const [th, watch] = await Promise.allSettled([
      fetchJson('/sensor/temp-humid'),
      fetchJson('/sensor/watch')
    ]);
    if (th.status === 'fulfilled') liveSensors.tempHumid = th.value;
    if (watch.status === 'fulfilled') liveSensors.watch = watch.value;
    updateLiveSensorBadge();
  }
  function latestTempHumidReading() {
    const readings = liveSensors.tempHumid && liveSensors.tempHumid.readings;
    return Array.isArray(readings) && readings.length ? readings[0] : null;
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
  function isCentralWatch(watchId, proc) {
    return watchId === 'WATCH-03' || String(proc || '').includes('중앙 전시홀');
  }
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

  function ensureLiveSensorBadge() {
    let badge = document.getElementById('liveSensorBadge');
    if (badge) return badge;
    const host = document.querySelector('.site-env-card .behavior-head-right') || document.querySelector('.site-env-card');
    if (!host) return null;
    badge = document.createElement('div');
    badge.id = 'liveSensorBadge';
    badge.className = 'live-sensor-badge';
    badge.innerHTML = '<span class="lsb-temp">TEMP --.-°C</span><span class="lsb-hum">HUM --.-%</span><span class="lsb-hr">HR -- BPM</span>';
    host.insertBefore(badge, host.firstChild);
    return badge;
  }
  function updateLiveSensorBadge() {
    const badge = ensureLiveSensorBadge();
    if (!badge) return;
    const th = latestTempHumidReading();
    const workers = latestWatchWorkers();
    const hr = workers.length ? Number(workers[0].hr || 0) : 0;
    const tempText = th ? Number(th.temp).toFixed(1) : '--.-';
    const humText = th ? Number(th.humidity).toFixed(1) : '--.-';
    const hrText = hr ? String(hr) : '--';
    badge.innerHTML =
      '<span class="lsb-temp">TEMP ' + tempText + '°C</span>' +
      '<span class="lsb-hum">HUM ' + humText + '%</span>' +
      '<span class="lsb-hr">HR ' + hrText + ' BPM</span>';
  }

  /* ===================== 모달 라이브 폴링 ===================== */
  // 모달이 열려 있는 동안 주기적으로 값을 다시 가져와 실시간으로 갱신한다.
  const MODAL_POLL_MS = 3000;
  // 온습도 실센서별 모달 갱신 주기: shelly 4분(완만), sonoff 5초(직관적 실시간).
  const TH_POLL_MS = { shelly_1: 240000, sonoff_1: 5000 };
  const modalPollers = {}; // overlayId -> intervalId

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
    document.getElementById('envDetailOverlay').classList.add('open');

    const live = !!sensorName;
    const pollMs = TH_POLL_MS[sensorName] || MODAL_POLL_MS;
    async function update() {
      if (!live) {
        const dummy = dummyTempHumid(sensorId);
        setText('envDetailTemp', dummy.temp + '<small>°C</small>', true);
        setText('envDetailHum', dummy.humidity + '<small>%</small>', true);
        return;
      }
      const reading = await fetchTempHumidByName(sensorName);
      if (!reading) return;
      if (sub) sub.textContent = sensorId + ' · ' + zone + ' · LIVE';
      setText('envDetailTemp', Number(reading.temp).toFixed(1) + '<small>°C</small>', true);
      setText('envDetailHum', Number(reading.humidity).toFixed(1) + '<small>%</small>', true);
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
      await refreshLiveSensors();
      const live = latestWatchWorkers()[0] || null;
      const workers = Array.from({ length: n }, (_, i) => {
        const watch = 'WATCH-' + String(i + 1).padStart(2, '0');
        if (watch === 'WATCH-03' && live) {
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

    const live = isCentralWatch(watchId, proc);
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
        watchId || worker.watch_id || 'WATCH-03',
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
    startVlmLoop(); // 모달 열림과 동시에 VLM 연속 분석 시작
  };
  window.closeCCTV = function () {
    stopVlmLoop(); // 모달 닫으면 분석 루프 중단
    resetAnalyzeBtn();
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
    startVlmLoop({ keepPaused: true }); // 새 카메라로 즉시 재타게팅(일시정지 상태는 유지)
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
    startVlmLoop(); // 모달 열림과 동시에 VLM 연속 분석 시작
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
  const VLM_POLL_INTERVAL_MS = 2500; // 성공 응답 후 다음 요청까지 대기(2~3초)
  const VLM_ERROR_BACKOFF_MS = 1500; // 오류 시 재시도 전 대기
  const vlmLoop = { token: 0, paused: false };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    if (vlmLoop.token !== token || !cctvModalOpen()) return; // 응답 도착 시 이미 중단/전환됨
    renderVlmResult(d);
    document.getElementById('cctvVlmOverlay').classList.add('show');
    hydrateMatrix(processCode).catch(() => {});
  }

  // 분석 루프 시작. opts.keepPaused: 카메라 전환 등에서 일시정지 상태 유지.
  function startVlmLoop(opts) {
    if (!(opts && opts.keepPaused)) vlmLoop.paused = false;
    const myToken = ++vlmLoop.token; // 이전 루프/in-flight 응답 무효화
    updateAnalyzeBtn();
    const det = document.getElementById('vlmDetection');
    if (det && !vlmLoop.paused) {
      // 직전 분석 결과는 다음 응답이 도착할 때까지 그대로 유지한다.
      // (아직 한 번도 결과가 없을 때만 안내 문구를 보여준다)
      const cur = det.textContent.trim();
      if (!cur || cur === '—') det.textContent = '분석 요청 중…';
      document.getElementById('cctvVlmOverlay').classList.add('show');
    }
    (async function loop() {
      while (vlmLoop.token === myToken && cctvModalOpen()) {
        if (vlmLoop.paused) { await sleep(250); continue; }
        try {
          await runVlmAnalysisOnce(myToken);
          // 성공 → 5초 대기 후 다음 요청 (요청 → 응답 → 대기 → 요청)
          await sleep(VLM_POLL_INTERVAL_MS);
        } catch (e) {
          if (vlmLoop.token !== myToken || !cctvModalOpen()) break;
          console.error('[VLM 분석] 실패:', e);
          document.getElementById('vlmDetection').textContent = '분석 실패: ' + e.message;
          document.getElementById('vlmWarning').textContent = '백엔드 연결을 확인하세요';
          document.getElementById('cctvVlmOverlay').classList.add('show');
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

  // 분석 버튼 = 일시정지/재개 토글
  window.analyzeCurrentCam = function () {
    if (!cctvModalOpen()) return;
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

  /* ===================== 초기화 ===================== */
  async function init() {
    document.body.appendChild(badge);
    setConn(false, '연결 중…');

    // 라이브 센서 배지 + 폴링 시작
    ensureLiveSensorBadge();
    refreshLiveSensors().catch(() => updateLiveSensorBadge());
    setInterval(() => refreshLiveSensors().catch(() => updateLiveSensorBadge()), 5000);

    // 공정 드롭다운을 실제 DB 목록으로 채움(실패해도 하드코딩 옵션 유지)
    try { await populateProcesses(); }
    catch (e) { console.warn('[공정 목록] 동적 로드 실패, 기본 옵션 사용:', e.message); }

    // 신호등 행렬 초기 동기화
    try { await hydrateMatrix(currentProcessCode()); setConn(true, '신호등 동기화 완료'); }
    catch (e) { setConn(false, e.message); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
