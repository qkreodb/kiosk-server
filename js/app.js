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
['hrOverlay','msdsOverlay','photoOverlay','evacOverlay','facilityOverlay','contactOverlay','riskOverlay','aiSiteOverlay','envDetailOverlay','processOverlay','issueOverlay','policyOverlay'].forEach(id => {
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

// 위험성평가 / AI 부스 도면 열기
function openRisk() { document.getElementById('riskOverlay').classList.add('open'); }
function openAISite() { document.getElementById('aiSiteOverlay').classList.add('open'); }
// ===== 공정(작업)관리 드릴다운 =====
// 행 순서는 processOverlay 목록 표의 onclick 인덱스(0~4)와 일치
const PROCESS_DATA = [
  { code:'PRC-19', name:'정밀가공 라인', manager:'이*학',
    locations:['도장부스','도장작업실','밀폐내부 작업존(밀폐)','밀폐작업구역(밀폐)','원자재 이송구역','절단기 작업존','정비투입구역'],
    desc:'금속 또는 부품을 규격과 도면에 맞게 고정밀로 가공하는 작업',
    workers:[{name:'김*모',hr:72},{name:'박*철',hr:88},{name:'이*준',hr:65}],
    subs:[
      {ord:1,name:'선반 외경 가공',desc:'지름 60mm의 원봉을 선반에 고정한 후, 바깥 지름을 50mm로 깎아내는 작업. 자동차 샤프트의 외경을 일정한 크기로 정밀 가공',machines:'전동식 자주식 고소작업대, 이동식 흄 집진기, 이동차 외벽청소용 곤돌라',chems:['염산','에틸 알코올','황산'],prot:'알루미늄 방열복, 용접용 차광 보안면'},
      {ord:2,name:'홈 가공',desc:'축 중간에 키(key)가 들어갈 수 있도록 깊이 3mm, 폭 5mm의 홈을 파는 작업',machines:'이동식 흄 집진기',chems:['황산'],prot:'용접용 차광 보안면, 안전고리 추락 방지용 라이프라인'},
    ]},
  { code:'PRC-07', name:'절단·용접 작업', manager:'전*조',
    locations:['절단기 작업존','용접실'],
    desc:'금속 자재를 절단하고 용접하여 부품을 제작하는 작업',
    workers:[{name:'최*민',hr:80},{name:'정*호',hr:91}],
    subs:[
      {ord:1,name:'금속 절단',desc:'설계 도면에 따라 금속 자재를 정해진 크기로 절단하는 작업',machines:'플라즈마 절단기, 금속 절단기',chems:['절삭유'],prot:'안전장갑, 차광 보안면, 귀마개'},
      {ord:2,name:'MIG 용접',desc:'절단된 금속 부품을 MIG 용접으로 결합하는 작업',machines:'이동식 흄 집진기, MIG 용접기',chems:['아르곤 가스','이산화탄소'],prot:'용접용 차광 보안면, 방열장갑, 용접 앞치마'},
    ]},
  { code:'PRC-12', name:'도장 작업', manager:'김*수',
    locations:['도장부스','도장작업실'],
    desc:'제품 표면에 도료를 도포하여 방청 및 미관을 개선하는 작업',
    workers:[{name:'한*수',hr:68},{name:'오*진',hr:75}],
    subs:[
      {ord:1,name:'표면 전처리',desc:'도장 전 제품 표면의 이물질 및 녹을 제거하는 작업',machines:'샌드블라스터, 에어 컴프레서',chems:['신나','프라이머'],prot:'방독마스크, 보호장갑, 보안경'},
      {ord:2,name:'도료 도포',desc:'스프레이 건을 이용하여 도료를 균일하게 도포하는 작업',machines:'에어 스프레이 건, 도장 부스 환기장치',chems:['우레탄 도료','경화제','신나'],prot:'방독마스크, 보호의, 보호장갑'},
    ]},
  { code:'PRC-23', name:'조립 라인', manager:'박*후',
    locations:['조립 작업구역','품질검사실'],
    desc:'가공된 부품을 조립하여 완성품을 제작하는 작업',
    workers:[{name:'장*민',hr:70},{name:'임*혁',hr:82},{name:'강*연',hr:77}],
    subs:[
      {ord:1,name:'부품 조립',desc:'도면에 따라 각 부품을 순서대로 조립하는 작업',machines:'전동 드라이버, 토크렌치, 조립 지그',chems:['그리스','나사 고정제'],prot:'안전장갑, 보안경'},
      {ord:2,name:'품질 검사',desc:'완성된 조립품의 치수 및 기능을 검사하는 작업',machines:'버니어 캘리퍼스, 토크 테스터',chems:[],prot:'안전장갑'},
    ]},
  { code:'PRC-31', name:'물류·하역', manager:'최*재',
    locations:['원자재 이송구역','창고'],
    desc:'완성품 및 원자재의 입출고 및 보관을 관리하는 작업',
    workers:[{name:'윤*식',hr:85},{name:'서*찬',hr:73}],
    subs:[
      {ord:1,name:'원자재 하역',desc:'입고된 원자재를 지게차로 하역하여 지정 위치에 보관하는 작업',machines:'지게차, 파레트 잭',chems:['지게차 배터리액'],prot:'안전모, 안전화, 안전조끼'},
      {ord:2,name:'완성품 출고',desc:'완성된 제품을 포장하여 출하 차량에 상차하는 작업',machines:'지게차, 포장기계, 랩핑기',chems:[],prot:'안전모, 안전화, 안전장갑'},
    ]},
];

function openProcessMgmt() {
  backToProcessList();
  document.getElementById('processOverlay').classList.add('open');
}

function backToProcessList() {
  stopProcHr();
  document.getElementById('procHdrTitle').textContent = '공정(작업)관리';
  document.getElementById('procHdrSub').textContent = '고양시사업장 · 금일 작업 현황 · PROCESS MANAGEMENT';
  document.getElementById('procBackBtn').classList.remove('visible');
  document.getElementById('procListView').style.display = '';
  document.getElementById('procDetailView').style.display = 'none';
  document.querySelector('#processOverlay .modal-body').scrollTop = 0;
}

function showProcessDetail(idx) {
  const p = PROCESS_DATA[idx];
  if (!p) return;

  document.getElementById('procHdrTitle').textContent = p.name;
  document.getElementById('procHdrSub').textContent = p.code + ' · 공정 상세 정보';
  document.getElementById('procBackBtn').classList.add('visible');

  const locTags = p.locations.map(loc =>
    `<span class="proc-loc-tag${loc.includes('밀폐') ? ' danger' : ''}">${loc}</span>`
  ).join('');

  const subRows = p.subs.map(sp => {
    const chemCells = sp.chems.length
      ? sp.chems.map(c => `<button class="chem-btn" onclick="openMSDS('${c.replace(/'/g, "\\'")}')">${c}</button>`).join('')
      : '<span style="color:var(--t-3);">—</span>';
    return `<tr>
      <td class="tc">${sp.ord}</td>
      <td class="tn">${sp.name}</td>
      <td>${sp.desc}</td>
      <td>${sp.machines}</td>
      <td>${chemCells}</td>
      <td>${sp.prot}</td>
    </tr>`;
  }).join('');

  const workerCards = p.workers.map(w => {
    const col = procHrColor(w.hr);
    return `<div class="proc-wcard" data-base="${w.hr}">
      <span class="proc-wname">${w.name}</span>
      <span class="proc-hrt">♥</span>
      <span class="proc-hrv" style="color:${col}">${w.hr} BPM</span>
    </div>`;
  }).join('');

  document.getElementById('procDetailView').innerHTML = `
    <div class="proc-info-grid">
      <div class="proc-ig-lbl">공정 코드</div>
      <div class="proc-ig-val" style="font-weight:700;color:var(--cyan);letter-spacing:.5px">${p.code}</div>
      <div class="proc-ig-lbl">공정명</div>
      <div class="proc-ig-val" style="font-weight:700">${p.name}</div>
      <div class="proc-ig-lbl">현장위치</div>
      <div class="proc-ig-val">${locTags}</div>
      <div class="proc-ig-lbl">설명</div>
      <div class="proc-ig-val" style="line-height:1.6">${p.desc}</div>
    </div>

    <div class="proc-sec-lbl">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      세부 공정(작업)
    </div>

    <div class="proc-sub-wrap">
      <table class="proc-sub-table">
        <thead>
          <tr>
            <th style="width:60px">작업순서</th>
            <th style="width:110px">작업명</th>
            <th class="tl">작업 설명</th>
            <th style="width:180px">기계/기구/설비 등</th>
            <th style="width:130px">사용물질</th>
            <th style="width:155px">보호구</th>
          </tr>
        </thead>
        <tbody>${subRows}</tbody>
      </table>
    </div>

    <div class="proc-mw-sec">
      <div class="proc-mw-lbl">담당자</div>
      <div class="proc-mw-val">
        <span class="proc-mgr-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          ${p.manager}
        </span>
      </div>
      <div class="proc-mw-lbl last">근로자</div>
      <div class="proc-mw-val last">${workerCards}</div>
    </div>
  `;

  document.getElementById('procListView').style.display = 'none';
  document.getElementById('procDetailView').style.display = '';
  document.querySelector('#processOverlay .modal-body').scrollTop = 0;

  startProcHr();
}

// 근로자 심박: 기준값 ±5 범위로 2초마다 랜덤 변동
let procHrTimer = null;
function procHrColor(bpm) { return bpm > 90 ? 'var(--red)' : bpm > 80 ? 'var(--orange)' : 'var(--green)'; }
function startProcHr() {
  stopProcHr();
  procHrTimer = setInterval(updateProcHr, 2000);
}
function stopProcHr() {
  if (procHrTimer) { clearInterval(procHrTimer); procHrTimer = null; }
}
function updateProcHr() {
  const overlay = document.getElementById('processOverlay');
  const detail = document.getElementById('procDetailView');
  // 모달이 닫혔거나 목록 뷰면 타이머 정리
  if (!overlay || !overlay.classList.contains('open') || !detail || detail.style.display === 'none') {
    stopProcHr();
    return;
  }
  detail.querySelectorAll('.proc-wcard').forEach(card => {
    const base = +card.dataset.base;
    const bpm = base + Math.floor(Math.random() * 7) - 3; // -3 ~ +3
    const el = card.querySelector('.proc-hrv');
    if (el) { el.textContent = bpm + ' BPM'; el.style.color = procHrColor(bpm); }
  });
}
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
  // 등록되지 않은 물질은 명칭만 표시하고 항목은 비워둔다.
  const m = MSDS[key] || {};
  const dash = '<span style="color:var(--t-3);">—</span>';
  const v = (x) => (x === undefined || x === null || x === '') ? dash : x;
  const name = m.name || key;
  const hazardRows = (m.hazard && m.hazard.length)
    ? m.hazard.map(h => `<div class="msds-hazard">⚠ ${h}</div>`).join('')
    : `<div class="msds-hazard" style="color:var(--t-3);">등록된 유해·위험 문구가 없습니다.</div>`;

  document.getElementById('msdsSub').textContent = name;
  document.getElementById('msdsBody').innerHTML = `
    <div class="msds-title-row">
      <span class="msds-cas">CAS ${v(m.cas)}</span>
      <span class="msds-name">${name}</span>
    </div>
    <div class="ghs-row">
      <div class="ghs-pic" title="부식성"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l5 5M3 9l4 1 2-3M15 4l-2 6 6-1M20 11l-4 7h-3"/><path d="M6 20h5M14 20h4"/></svg></div>
      <div class="ghs-pic" title="유해/위험"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></div>
    </div>
    <div class="msds-section">
      <div class="msds-section-title">기본 정보</div>
      <dl class="msds-grid">
        <dt>화학식</dt><dd>${v(m.formula)}</dd>
        <dt>UN 번호</dt><dd>${v(m.un)}</dd>
        <dt>신호어</dt><dd style="${m.signal ? 'color:var(--red);font-weight:700;' : ''}">${v(m.signal)}</dd>
      </dl>
    </div>
    <div class="msds-section">
      <div class="msds-section-title">유해·위험 문구 (H-code)</div>
      <div class="msds-hazard-list">
        ${hazardRows}
      </div>
    </div>
    <div class="msds-section">
      <div class="msds-section-title">취급 및 저장</div>
      <dl class="msds-grid">
        <dt>취급</dt><dd>${v(m.handling)}</dd>
        <dt>저장</dt><dd>${v(m.storage)}</dd>
      </dl>
    </div>`;
  document.getElementById('msdsOverlay').classList.add('open');
}
