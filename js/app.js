// Kiosk scale fit
function fitKiosk() {
  const kiosk = document.querySelector('.kiosk');
  if (!kiosk) return;
  const vw = window.innerWidth;
  if (vw < 1080) {
    const scale = vw / 1080;
    kiosk.style.transform = `scale(${scale})`;
    kiosk.style.transformOrigin = 'top left';
    kiosk.style.marginLeft = '0';
    kiosk.style.marginRight = '0';
    document.body.style.height = Math.ceil(1920 * scale) + 'px';
  } else {
    kiosk.style.transform = '';
    kiosk.style.transformOrigin = '';
    kiosk.style.marginLeft = '';
    kiosk.style.marginRight = '';
    document.body.style.height = '';
  }
}
fitKiosk();
window.addEventListener('resize', fitKiosk);

// Live clock
const KO_DAYS = ['일', '월', '화', '수', '목', '금', '토'];
function tick() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const day = KO_DAYS[now.getDay()];
  const hms = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
  const hm = pad(now.getHours()) + ':' + pad(now.getMinutes());
  const dateDot = y + '.' + mo + '.' + d;       // 2026.06.11
  const dateDash = y + '-' + mo + '-' + d;        // 2026-06-11

  const clkEl = document.getElementById('clk');
  if (clkEl) clkEl.textContent = hms;
  const cd = document.getElementById('clkDate');
  if (cd) cd.textContent = dateDot + ' · ' + day;
  // CCTV timestamp
  const ts = document.getElementById('cctvTime');
  if (ts) ts.textContent = dateDash + ' ' + hms;
  // Photo timestamp
  const pt = document.getElementById('photoTime');
  if (pt) pt.textContent = dateDash + ' ' + hm;
}
setInterval(tick, 1000); tick();

// CCTV modal control
const CCTV_VIDEO_ID = 'zNma5G0oNF8';
function cctvSrc(autoplay) {
  // file:// 로컬 실행 호환: youtube-nocookie 도메인은 origin 검증이 없어 보안 오리진 차단을 회피
  // autoplay + mute(자동재생 허용 조건) + 반복재생 + 컨트롤 최소화
  return 'https://www.youtube-nocookie.com/embed/' + CCTV_VIDEO_ID
    + '?autoplay=' + (autoplay ? 1 : 0)
    + '&mute=1&loop=1&playlist=' + CCTV_VIDEO_ID
    + '&controls=0&modestbranding=1&rel=0&playsinline=1';
}
function openCCTV() {
  const frame = document.getElementById('cctvFrame');
  if (frame) frame.src = cctvSrc(true);
  document.getElementById('cctvOverlay').classList.add('open');
}
function closeCCTV() {
  document.querySelectorAll('.cctv-btn-item').forEach(b => b.classList.remove('monitoring'));
  document.getElementById('cctvOverlay').classList.remove('open');
  const frame = document.getElementById('cctvFrame');
  if (frame) frame.src = '';
}
// Close when clicking the dimmed backdrop
document.getElementById('cctvOverlay').addEventListener('click', e => {
  if (e.target.id === 'cctvOverlay') closeCCTV();
});
// Switch camera feed (updates overlay location + process)
function switchCam(el, locName, locProc) {
  document.querySelectorAll('.cctv-cam-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('cctvLocName').textContent = locName;
  document.getElementById('cctvLocProc').textContent = locProc;
  // 카메라 전환 시 영상 리로드 (실제 운영 시 카메라별 스트림 URL 적용)
  const frame = document.getElementById('cctvFrame');
  if (frame) frame.src = cctvSrc(true);
}

// ===== NOTICE rolling messages (5s) =====
const noticeEls = Array.from(document.querySelectorAll('.ticker-msg'));
let currentNotice = 0;
if (noticeEls.length > 1) {
  setInterval(() => {
    noticeEls[currentNotice].classList.remove('active');
    currentNotice = (currentNotice + 1) % noticeEls.length;
    noticeEls[currentNotice].classList.add('active');
  }, 5000);
}

// ===== 불안전행동 신호등 행렬 =====
// 각 라인의 초기 활성 등급 저장 (0:관심 1:주의 2:경고 3:위험)
const bhInitial = [];
document.querySelectorAll('.bh-matrix-row').forEach(row => {
  bhInitial.push(parseInt(row.dataset.active, 10));
});
// 초기화: 모든 라인을 "관심(정상)" 상태로 리셋
function resetBehavior() {
  document.querySelectorAll('.bh-matrix-row').forEach(row => {
    const lamps = row.querySelectorAll('.bhm-lamp');
    lamps.forEach(l => l.classList.remove('on'));
    lamps[0].classList.add('on'); // 관심 등급만 켜기
    row.dataset.active = '0';
  });
}

// 공정 커스텀 드롭다운
function bhPickProc(opt) {
  const wrap = document.getElementById('bhProcSelect');
  const label = document.getElementById('bhProcLabel');
  document.querySelectorAll('#bhProcDropdown .bps-option').forEach(o => o.classList.remove('active'));
  opt.classList.add('active');
  if (label) label.textContent = opt.textContent;
  if (wrap) wrap.classList.remove('open');
  setMonitoringCctv(opt.dataset.cctv || '1');
  // 공정 변경 시 백엔드 신호등 행렬 갱신 (backend 통합 코드 로드 후 사용 가능)
  if (typeof window.hydrateMatrix === 'function') {
    window.hydrateMatrix(typeof window.currentProcessCode === 'function' ? window.currentProcessCode() : '').catch(() => {});
  }
}
document.addEventListener('click', () => {
  const wrap = document.getElementById('bhProcSelect');
  if (wrap) wrap.classList.remove('open');
});

// 현재 신호등을 대변하는 CCTV를 모니터링(LIVE) 상태로 표시
function setMonitoringCctv(val) {
  document.querySelectorAll('.cctv-btn-item').forEach(b => {
    b.classList.toggle('monitoring', b.dataset.cctv === val);
  });
}

// 신호등 헤더 CCTV 선택 (1/2/3) → 해당 CCTV 영상 팝업 + 모니터링 표시 이동
function bhSelectCctv(val, btn) {
  const map = {
    '1': 'CAM-03 · 정밀가공 라인',
    '2': 'CAM-04 · 절단기 작업존',
    '3': 'CAM-05 · 관람객 통로'
  };
  // 클릭한 버튼으로 모니터링(활성) 표시 이동
  setMonitoringCctv(val);
  openCCTVFor(map[val] || map['1']);
}

// ===== 사업장 온습도 현황: 온습도계/CCTV/심박 뷰 전환 =====
function switchSiteView(view, btn) {
  document.querySelectorAll('.sv-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.sem-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const envG = document.getElementById('siteEnvMarkers');
  const cctvG = document.getElementById('siteCctvMarkers');
  const hrG = document.getElementById('siteHrMarkers');
  if (envG) envG.style.display = (view === 'env') ? '' : 'none';
  if (cctvG) cctvG.style.display = (view === 'cctv') ? '' : 'none';
  if (hrG) hrG.style.display = (view === 'hr') ? '' : 'none';
}

// ===== Generic modal control =====
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
['hrOverlay','msdsOverlay','photoOverlay','evacOverlay','facilityOverlay','contactOverlay','msdsListOverlay','riskOverlay','aiSiteOverlay','envDetailOverlay','processOverlay','issueOverlay','policyOverlay'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', e => {
    if (e.target.id === id) closeModal(id);
  });
});

// 온습도 적정 범위 (모달 카드 표기와 일치)
const ENV_TEMP_RANGE = { min: 18, max: 28 };
const ENV_HUM_RANGE = { min: 40, max: 60 };

// 측정값이 기준 범위를 벗어나면 카드 배경/문구를 경고 상태로 갱신
function updateEnvStatus(temp, hum) {
  const tempOut = Number.isFinite(temp) && (temp < ENV_TEMP_RANGE.min || temp > ENV_TEMP_RANGE.max);
  const humOut = Number.isFinite(hum) && (hum < ENV_HUM_RANGE.min || hum > ENV_HUM_RANGE.max);

  const tempCard = document.getElementById('envDetailTemp')?.closest('.env-detail-card');
  const humCard = document.getElementById('envDetailHum')?.closest('.env-detail-card');
  if (tempCard) tempCard.classList.toggle('out-of-range', tempOut);
  if (humCard) humCard.classList.toggle('out-of-range', humOut);

  const note = document.getElementById('envStatusNote');
  const icon = document.getElementById('envStatusIcon');
  const text = document.getElementById('envStatusText');
  if (!note || !icon || !text) return;

  if (tempOut || humOut) {
    const labels = [];
    if (tempOut) labels.push('온도');
    if (humOut) labels.push('습도');
    note.classList.add('env-warn');
    note.style.background = '';
    note.style.borderColor = '';
    icon.innerHTML = '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
    text.innerHTML = '<b>' + labels.join(' · ') + '</b> 값이 정상 범위를 벗어났습니다. 확인이 필요합니다. 측정 주기 1분 · 마지막 갱신 방금 전.';
  } else {
    note.classList.remove('env-warn');
    note.style.background = '#D8F4E9';
    note.style.borderColor = '#AADCC8';
    icon.innerHTML = '<path d="M20 6L9 17l-5-5"/>';
    text.innerHTML = '모든 환경 지표가 <b style="color:var(--green);">정상 범위</b> 내에 있습니다. 측정 주기 1분 · 마지막 갱신 방금 전.';
  }
}

// 온습도 센서 상세 열기
function openEnvDetail(sensorId, zone) {
  const sub = document.getElementById('envDetailSub');
  if (sub) sub.textContent = sensorId + ' · ' + zone;
  // 센서별로 약간 다른 값 (데모)
  const temp = (26 + Math.random() * 3).toFixed(1);
  const hum = Math.floor(52 + Math.random() * 12);
  document.getElementById('envDetailTemp').innerHTML = temp + '<small>°C</small>';
  document.getElementById('envDetailHum').innerHTML = hum + '<small>%</small>';
  updateEnvStatus(parseFloat(temp), hum);
  setTimeout(() => document.getElementById('envDetailOverlay').classList.add('open'), 0);
}

// 비상대피로 안내도 열기
function openEvac() {
  document.getElementById('evacOverlay').classList.add('open');
}

// 비상연락망 열기
function openContact() {
  document.getElementById('contactOverlay').classList.add('open');
}

// 경영방침 및 법령요지 모달 열기
function openPolicy(type) {
  const title = document.getElementById('policyTitle');
  const body = document.getElementById('policyBody');
  const box = document.querySelector('#policyOverlay .modal-box');
  if (!title || !body) return;

  if (type === 'management') {
    // 문서형(document) 레이아웃 — 참고: 안전보건경영방침.dc.html
    if (box) box.classList.add('policy-doc-mode');
    title.textContent = '안전보건경영방침';
    const triSvg = `
      <svg viewBox="0 0 52 600" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="0,0 52,0 0,160" fill="#162352" opacity="0.85"/>
        <polygon points="0,140 52,180 0,280" fill="#2a9aaa" opacity="0.7"/>
        <polygon points="0,260 38,320 0,400" fill="#162352" opacity="0.6"/>
        <polygon points="0,380 52,430 0,520" fill="#2a9aaa" opacity="0.5"/>
        <polygon points="0,500 30,550 0,600" fill="#162352" opacity="0.4"/>
      </svg>`;
    const cornerSvg = `<svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 17 L1 1 L17 1" stroke="#4db8c4" stroke-width="2.5" fill="none"/></svg>`;
    const items = [
      '위험성평가에서 제시된 내용에 근거해 우리사 전체의 산재된 위험을 파악하며,<br>이에 대비한다.',
      '안전보건방침은 전직원이 함께 제작에 참여하며, 즉시 전사에 공유되어야 한다.',
      '안전보건관리는 전직원의 참여를 기본으로 하며, 최고경영자의 주도하에 안전보건관리에 최우선으로 임한다.',
      '사람을 살피고 서로 협조한다',
      '나부터 먼저 안전수칙을 철저히 지킨다',
      '안전수칙을 서로 공유하며 준수할 수 있도록 독려한다.',
    ];
    const itemRows = items.map(t =>
      `<div class="policy-item-row"><div class="policy-hana-badge">하나</div><div class="policy-item-text">${t}</div></div>`
    ).join('');
    body.innerHTML = `
      <div class="policy-doc">
        <button class="policy-doc-close" onclick="closeModal('policyOverlay')" aria-label="닫기">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="policy-doc-wrapper">
          <div class="policy-tri">${triSvg}</div>
          <div class="policy-doc-card">
            <div class="policy-corner policy-corner-tl">${cornerSvg}</div>
            <div class="policy-corner policy-corner-tr">${cornerSvg}</div>
            <div class="policy-corner policy-corner-bl">${cornerSvg}</div>
            <div class="policy-corner policy-corner-br">${cornerSvg}</div>
            <div class="policy-doc-title">안전보건경영방침</div>
            <div style="margin-bottom:16px;">
              <span class="policy-doc-subtitle">무사고 사업장을 목표로 안전수칙을 준수한다</span>
            </div>
            <div class="policy-items-box">${itemRows}</div>
            <div class="policy-doc-footer">
              <div class="policy-footer-date">2026-06-24</div>
              <div class="policy-footer-sig">세이퍼정밀 주식회사 대표이사 김용필</div>
            </div>
          </div>
        </div>
      </div>
    `;
  } else {
    if (box) box.classList.remove('policy-doc-mode');
    title.textContent = '산업안전보건 법령요지';
    body.innerHTML = `
      <div style="padding: 10px 0;">
        <h4 style="font-size:16px; color:var(--cyan); margin-bottom:12px; font-weight:700; border-left:3px;">근로자의 주요 권리와 의무 (법 제5조 등)</h4>
        <ul style="list-style:none; padding:0; font-size:14px; color:var(--t-2); line-height:2.0; margin-bottom:24px;">
          <li style="margin-bottom:8px;"><b>• 급박한 위험 시 작업중지권</b>: 급박한 위험이 있을 때 작업을 중지하고 대피할 수 있는 권리.</li>
          <li style="margin-bottom:8px;"><b>• 안전보건수칙 준수 의무</b>: 사업주가 제공하는 보호구 착용 및 안전보건 규칙 준수 의무.</li>
          <li style="margin-bottom:8px;"><b>• 건강진단 수검 의무</b>: 회사가 실시하는 정기 및 특수 건강진단을 적극 수검할 의무.</li>
        </ul>
        <h4 style="font-size:16px; color:var(--orange); margin-bottom:12px; font-weight:700; border-left:3px;">사업주의 주요 의무 (법 제4조)</h4>
        <ul style="list-style:none; padding:0; font-size:14px; color:var(--t-2); line-height:2.0;">
          <li style="margin-bottom:8px;"><b>• 위험성평가 실시 및 이행</b>: 사업장 내 위험 요인을 파악하고 개선 대책을 수립·이행할 의무.</li>
          <li style="margin-bottom:8px;"><b>• 정기 안전보건교육 제공</b>: 신규 채용 및 정기 안전보건 교육을 소속 근로자에게 제공할 의무.</li>
          <li style="margin-bottom:8px;"><b>• 안전보건관리체계 구축</b>: 중대재해처벌법에 따른 전담 조직 및 안전 예산 편성 의무.</li>
        </ul>
      </div>
    `;
  }
  document.getElementById('policyOverlay').classList.add('open');
}

// MSDS 목록 / 위험성평가 / AI 부스 도면 열기
function openMSDSList() { document.getElementById('msdsListOverlay').classList.add('open'); }
function openRisk() { document.getElementById('riskOverlay').classList.add('open'); }
function openAISite() { document.getElementById('aiSiteOverlay').classList.add('open'); }
function openProcessMgmt() { document.getElementById('processOverlay').classList.add('open'); }
function openIssueMgmt() { document.getElementById('issueOverlay').classList.add('open'); }

// ===== 시설 위치 안내도 (응급구급함/소화기/AED 공용) =====
const FACILITY = {
  aid: {
    title: '응급 구급함 위치 안내도',
    color: '#FF7B85',
    iconBg: 'rgba(255,123,133,0.12)', iconBorder: 'rgba(255,123,133,0.35)',
    dwg: 'DWG. NO. FAC-AID-1F',
    icon: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/>',
    label: '구급함',
    // 도면 내 위치들 [x, y]
    points: [[175, 130], [725, 270], [450, 360]],
    note: '응급 구급함은 <b>부스 A 입구, 부스 D, 세미나실</b>에 비치되어 있습니다. 부상 발생 시 가장 가까운 구급함을 사용하고 안전관리자에게 즉시 보고하세요.'
  },
  fire: {
    title: '소화기 위치 안내도',
    color: '#FF3B47',
    iconBg: 'rgba(255,59,71,0.12)', iconBorder: 'rgba(255,59,71,0.35)',
    dwg: 'DWG. NO. FAC-FIRE-1F',
    icon: '<path d="M9 4h4l1 2v2h-6V6z"/><path d="M8 8h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z"/><line x1="14" y1="5" x2="17" y2="4"/>',
    label: '소화기',
    points: [[290, 100], [610, 100], [175, 290], [725, 290], [450, 440]],
    note: '소화기는 <b>각 부스 출입구와 중앙 전시홀</b>에 배치되어 있습니다. 화재 초기 발견 시 소화기로 진화하되, 불길이 천장에 닿으면 즉시 대피하세요.'
  },
  aed: {
    title: 'AED(자동심장충격기) 설치 위치 안내도',
    color: '#FFB800',
    iconBg: 'rgba(255,184,0,0.2)', iconBorder: 'rgba(255,184,0,0.4)',
    dwg: 'DWG. NO. FAC-AED-1F',
    icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M13 7l-3 5h3l-1 4 4-6h-3z" fill="currentColor" stroke="none"/>',
    label: 'AED',
    points: [[450, 130], [175, 290]],
    note: 'AED는 <b>중앙 전시홀과 부스 B</b>에 설치되어 있습니다. 심정지 환자 발견 시 AED를 가져와 음성 안내에 따라 사용하고 동시에 119에 신고하세요.'
  }
};

function openFacility(type) {
  const f = FACILITY[type];
  if (!f) return;
  document.getElementById('facModalTitle').textContent = f.title;
  document.getElementById('facDwgNo').textContent = f.dwg;
  document.getElementById('facNoteText').innerHTML = f.note;
  // note 색상
  const note = document.getElementById('facNote');
  note.style.background = f.iconBg;
  note.style.borderColor = f.iconBorder;
  note.querySelector('svg').style.color = f.color;
  note.querySelectorAll('b').forEach(b => b.style.color = f.color);
  // 마커 주입
  const NS = 'http://www.w3.org/2000/svg';
  const g = document.getElementById('facMarkers');
  g.innerHTML = '';
  f.points.forEach(([x, y]) => {
    // 펄스 링
    const pulse = document.createElementNS(NS, 'circle');
    pulse.setAttribute('cx', x); pulse.setAttribute('cy', y);
    pulse.setAttribute('r', '9'); pulse.setAttribute('fill', f.color); pulse.setAttribute('opacity', '0.25');
    const a1 = document.createElementNS(NS, 'animate');
    a1.setAttribute('attributeName', 'r'); a1.setAttribute('values', '8;16;8'); a1.setAttribute('dur', '1.8s'); a1.setAttribute('repeatCount', 'indefinite');
    const a2 = document.createElementNS(NS, 'animate');
    a2.setAttribute('attributeName', 'opacity'); a2.setAttribute('values', '0.45;0;0.45'); a2.setAttribute('dur', '1.8s'); a2.setAttribute('repeatCount', 'indefinite');
    pulse.appendChild(a1); pulse.appendChild(a2);
    g.appendChild(pulse);
    // 마커 원
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    dot.setAttribute('r', '8'); dot.setAttribute('fill', f.color);
    dot.setAttribute('stroke', '#0a2540'); dot.setAttribute('stroke-width', '2');
    g.appendChild(dot);
    // 사각형 라벨
    const labelW = 52, labelH = 22;
    const lx = x + 12, ly = y - labelH / 2;
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', lx); rect.setAttribute('y', ly);
    rect.setAttribute('width', labelW); rect.setAttribute('height', labelH);
    rect.setAttribute('fill', f.color); rect.setAttribute('fill-opacity', '0.6'); rect.setAttribute('rx', '3');
    g.appendChild(rect);
    const txt = document.createElementNS(NS, 'text');
    txt.setAttribute('x', lx + labelW / 2); txt.setAttribute('y', y + 5);
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', '#000000');
    txt.setAttribute('font-family', 'Pretendard, sans-serif');
    txt.setAttribute('font-size', '13');
    txt.setAttribute('font-weight', '800');
    txt.textContent = f.label;
    g.appendChild(txt);
  });
  document.getElementById('facilityOverlay').classList.add('open');
}

// ===== 심박 모니터링 =====
const krNames = ['김*현','이*준','박*후','최*재','정*진','강*준','조*우','윤*성','임*호','한*경','오*민','신*찬'];
function openHeartRate(region, count) {
  const grid = document.getElementById('hrGrid');
  const n = Math.min(count || 1, 8); // 표시 최대 8명
  let html = '';
  for (let i = 0; i < n; i++) {
    // 심박 60~140 랜덤
    const bpm = 62 + Math.floor(Math.random() * 76);
    let cls = '', status = '정상';
    if (bpm >= 130) { cls = 'danger'; status = '위험'; }
    else if (bpm >= 110) { cls = 'warn'; status = '주의'; }
    const name = krNames[i % krNames.length];
    const initial = name.charAt(0);
    html += `
      <div class="hr-worker ${cls}">
        <div class="hr-avatar">${initial}</div>
        <div class="hr-worker-info">
          <div class="hr-worker-name">${name}</div>
          <div class="hr-worker-meta">WATCH-${String(i+1).padStart(2,'0')} · Galaxy Watch</div>
          <span class="hr-status-badge">${status}</span>
        </div>
        <div style="text-align:right;">
          <div class="hr-bpm">
            <span class="hr-bpm-val">${bpm}</span><span class="hr-bpm-unit">BPM</span>
          </div>
        </div>
      </div>`;
  }
  grid.innerHTML = html;
  document.getElementById('hrOverlay').classList.add('open');
}

// 스마트워치 개인 (공정 상세에서 호출) - 1명 정보
function openWatchWorker(name, watchId, proc) {
  const grid = document.getElementById('hrGrid');
  const bpm = 78 + Math.floor(Math.random() * 50);
  let cls = '', status = '정상';
  if (bpm >= 130) { cls = 'danger'; status = '위험'; }
  else if (bpm >= 110) { cls = 'warn'; status = '주의'; }
  grid.innerHTML = `
    <div class="hr-worker ${cls}" style="grid-column:1 / 3;">
      <div class="hr-avatar">${name.charAt(0)}</div>
      <div class="hr-worker-info">
        <div class="hr-worker-name">${name}</div>
        <div class="hr-worker-meta">${watchId} · Galaxy Watch · ${proc}</div>
        <span class="hr-status-badge">${status}</span>
      </div>
      <div style="text-align:right;">
        <div class="hr-bpm">
          <span class="hr-bpm-val">${bpm}</span><span class="hr-bpm-unit">BPM</span>
        </div>
      </div>
    </div>`;
  document.getElementById('hrOverlay').classList.add('open');
}

// ===== 현장사진 / CCTV =====
function openCCTVFor(region) {
  document.getElementById('cctvHeadSub').textContent = region + ' · 실시간';
  document.getElementById('cctvLocName').textContent = region + ' CCTV';
  document.getElementById('cctvLocProc').textContent = region + ' · 작업 현장';
  const frame = document.getElementById('cctvFrame');
  if (frame) frame.src = cctvSrc(true);
  document.getElementById('cctvOverlay').classList.add('open');
}
function openSitePhoto(region) {
  document.getElementById('photoSub').textContent = region + ' · 최근 촬영';
  document.getElementById('photoLocName').textContent = region + ' 현장';
  document.getElementById('photoOverlay').classList.add('open');
}

// ===== MSDS DB =====
const MSDS = {
  '염산': { cas:'7647-01-0', formula:'HCl', name:'염산 (Hydrochloric acid)', un:'UN1789', signal:'위험',
    hazard:['피부에 심한 화상과 눈 손상을 일으킴 (H314)','호흡기 자극을 일으킬 수 있음 (H335)','금속을 부식시킬 수 있음 (H290)'],
    handling:'국소배기장치 사용, 내산성 보호장갑·보안경·방독마스크 착용', storage:'서늘하고 환기되는 곳, 알칼리·금속과 격리' },
  '황산': { cas:'7664-93-9', formula:'H₂SO₄', name:'황산 (Sulfuric acid)', un:'UN1830', signal:'위험',
    hazard:['피부에 심한 화상과 눈 손상을 일으킴 (H314)','강한 산화성·부식성','물과 급격히 반응하여 발열'],
    handling:'반드시 물에 산을 천천히 첨가, 내산성 PPE 필수', storage:'밀폐 용기, 가연물·유기물과 격리' },
  '에틸 알코올': { cas:'64-17-5', formula:'C₂H₅OH', name:'에탄올 (Ethanol)', un:'UN1170', signal:'위험',
    hazard:['고인화성 액체 및 증기 (H225)','심한 눈 자극을 일으킴 (H319)'],
    handling:'화기 엄금, 정전기 방지, 환기 유지', storage:'인화성 물질 보관소, 점화원과 격리' },
  '락카페인트 스프레이 (육각)': { cas:'혼합물', formula:'Mixture', name:'락카페인트 스프레이', un:'UN1950', signal:'위험',
    hazard:['극인화성 에어로졸 (H222)','가열 시 폭발 위험 (H229)','졸음 또는 현기증 유발 가능 (H336)'],
    handling:'화기 엄금, 환기되는 곳에서 사용, 방독마스크 착용', storage:'50°C 이하, 직사광선 피함, 점화원과 격리' },
};
function openMSDS(key) {
  const m = MSDS[key];
  if (!m) return;
  document.getElementById('msdsSub').textContent = m.name;
  document.getElementById('msdsBody').innerHTML = `
    <div class="msds-title-row">
      <span class="msds-cas">CAS ${m.cas}</span>
      <span class="msds-name">${m.name}</span>
    </div>
    <div class="ghs-row">
      <div class="ghs-pic" title="부식성"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l5 5M3 9l4 1 2-3M15 4l-2 6 6-1M20 11l-4 7h-3"/><path d="M6 20h5M14 20h4"/></svg></div>
      <div class="ghs-pic" title="유해/위험"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></div>
    </div>
    <div class="msds-section">
      <div class="msds-section-title">기본 정보</div>
      <dl class="msds-grid">
        <dt>화학식</dt><dd>${m.formula}</dd>
        <dt>UN 번호</dt><dd>${m.un}</dd>
        <dt>신호어</dt><dd style="color:var(--red);font-weight:700;">${m.signal}</dd>
      </dl>
    </div>
    <div class="msds-section">
      <div class="msds-section-title">유해·위험 문구 (H-code)</div>
      <div class="msds-hazard-list">
        ${m.hazard.map(h=>`<div class="msds-hazard">⚠ ${h}</div>`).join('')}
      </div>
    </div>
    <div class="msds-section">
      <div class="msds-section-title">취급 및 저장</div>
      <dl class="msds-grid">
        <dt>취급</dt><dd>${m.handling}</dd>
        <dt>저장</dt><dd>${m.storage}</dd>
      </dl>
    </div>`;
  document.getElementById('msdsOverlay').classList.add('open');
}
