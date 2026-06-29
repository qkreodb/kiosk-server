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
['hrOverlay','msdsOverlay','photoOverlay','evacOverlay','facilityOverlay','contactOverlay','aiSiteOverlay','envDetailOverlay','processOverlay','issueOverlay','policyOverlay','lawDetailOverlay'].forEach(id => {
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
// 산업안전보건법령요지 (2025.1 기준). content/penalty는 개행 유지를 위해 템플릿 리터럴 사용.
const LAW_ITEMS = [
  { law: '제14조[이사회 보고 및 승인 등]',
    content: `「상법」 제170조에 따른 주식회사 중 상시근로자 500명 이상을 사용하는 회사, 건설산업기본법 제23조에 따라 시공능력의 순위 상위 1천위 이내의 건설회사의 대표이사는 매년 회사의 안전 및 보건에 관한 계획을 수립하여 이사회에 보고하고 승인을 받아야 함`,
    penalty: `1천만원 이하의 과태료` },
  { law: '제15조[안전보건관리책임자]',
    content: `사업주는 산업재해를 실질적으로 총괄하여 관리하는 사람에게 해당 사업장에 해당계획 수립, 안전관리감독(강진감 등), 산업재해의 원인 조사, 재발 방지대책 수립, 통계의 기록 유지 등 산업장의 안전 보건 업무를 총괄하여 관리하도록 하여야 함`,
    penalty: `500만원 이하의 과태료` },
  { law: '제16조[관리감독자]',
    content: `관리감독자는 근로자의 작업배분, 보호구 및 방호장치의 점검, 작동 교육/작업의 지위 감독, 교육 등을 실시하여야 함`,
    penalty: `500만원 이하의 과태료` },
  { law: '제17조[안전관리자] / 제18조[보건관리자] / 제19조[안전보건담당자]',
    content: `상시근로자의 인원과 건설공사의 규모 별 안전관리자, 보건관리자, 안전보건관리담당자를 선임 또는 보건(안전)관리전문기관에 위탁하여 사업주를 보좌하고 관리감독자에게 지도, 조언 업무수행
※ 건설업의 상시근로자 300인 이상 사업장은 보건관리전문기관 위탁 불가`,
    penalty: `500만원 이하의 과태료 (각 조항별)` },
  { law: '제24조[산업안전보건위원회]',
    content: `(해당 시) 노사 동수로 구성되는 산업안전보건위원회를 구성 운영`,
    penalty: `500만원 이하의 과태료` },
  { law: '제26조[안전보건관리규정의 작성]',
    content: `(해당 시) 사업장의 안전 및 보건을 유지하기 위하여 안전보건관리규정 작성 (시행규칙 [별표 3] 안전보건관리규정의 세부 내용 참조)`,
    penalty: `500만원 이하의 과태료` },
  { law: '제29조[근로자에 대한 안전보건교육]',
    content: `▷ 정기교육: 비사무직(12시간 이상/매반기), 사무직(6시간 이상/매반기)
▷ 관리감독자 교육: 방문, 포장, 생산직장, 생산부장 등 관리감독자 (연간 16시간 이상)
▷ 채용 시 교육: 일용근로자 및 근로계약기간이 1주일 이하인 기간제근로자(1시간 이상), 근로계약기간이 1주일 초과 1개월 이하인 기간제근로자(4시간 이상), 그 밖의 근로자(8시간 이상)
▷ 작업내용 변경 시: 일용근로자 및 근로계약기간이 1주일 이하인 기간제근로자(1시간 이상), 그 밖의 근로자(2시간 이상)
▷ 특별안전보건교육: 일용근로자 및 근로계약기간이 1주일 이하인 기간제근로자(2시간 이상) ※ 타워크레인 작업 시 신호업무 작업자는 8시간 이상, 그 밖의 근로자에 대한 작업에 준하는 교육(16시간 이상)
▷ 건설업 기초안전보건교육: 건설 일용근로자(4시간 이상)`,
    penalty: `500만원 이하의 과태료 (특별안전보건교육 미실시 시 3천만원 이하의 과태료)` },
  { law: '제32조[안전보건관리책임자 등에 대한 직무교육]',
    content: `사업주는 안전보건관리책임자, 안전관리자, 보건관리자, 안전보건관리담당자 및 안전 보건 전문기관 등에서 안전과 보건에 관련된 업무에 종사하는 사람 등에게 직무에 관한 안전보건교육을 이수하도록 해야 함`,
    penalty: `500만원 이하의 과태료` },
  { law: '제34조[법령 요지 등의 게시 등]',
    content: `법령요지 및 안전보건관리규정을 각 사업장의 근로자가 쉽게 볼 수 있는 장소에 게시하거나 갖추어 두어 근로자에게 널리 알려야 함`,
    penalty: `500만원 이하의 과태료` },
  { law: '제36조[위험성평가의 실시]',
    content: `사업장의 위험요인을 찾아내어 평가하고 이 법에 따른 조치를 하고 기록 보존 하여야 함
(안전보건관리책임자가 총괄관리 : 해당 작업장의 근로자 참여 필수)`,
    penalty: `안전보건관리책임자, 보건(안전)관리자 등 업무 500만원 이하의 과태료` },
  { law: '제37조[안전보건표지의 설치, 부착]',
    content: `사업주는 유해하거나 위험한 장소·시설·물질에 대한 경고 비상시 대피 등 안전의식 보건의식 고취를 위한 표지를 부착하여야 함
('산업안전보건법', 시행규칙 [별표 7, 8, 9] 기준) [금지표지/경고표지/지시표지/안내표지/관계자외 출입금지]
※ 외국인근로자를 사용하는 경우는 외국인근로자의 모국어로 별도 작성하여 설치 및 부착`,
    penalty: `500만원 이하의 과태료` },
  { law: '제38조[안전조치] / 제39조[보건조치] / 제40조[근로자의 안전조치 및 보건조치의 이행]',
    content: `▷ 기계/폭발성물질/전기 및 굴착/터파기/중량물 취급 금지 또는 제한·예방을 위하여 적절한 조치를 하여야 함
▷ 증기/폭발/미스트 및 방사선/분진 등의 발생으로 인한 건강의 적절한 조치를 하여야 함
▷ 근로자는 제38조[안전조치] 및 제39조[보건조치]에 따라 사업주가 한 조치에 따라야 할 사항을 이행하여야 함`,
    penalty: `근로자 사망시 7년 이하의 징역 또는 1억원 이하의 벌금 / 15만원 이하의 과태료(행위별)` },
  { law: '제41조[고객의 폭언 등으로 인한 건강장해 예방조치 등]',
    content: `사업주는 주로 고객을 직접 대면하거나 정보통신망을 통한 서비스 업무에 종사하는 고객응대근로자에 대하여 고객의 폭언 등으로 인한 건강장해를 예방하기 위하여 필요한 조치를 하여야 함`,
    penalty: `(근로자 해고, 불리한 처우) 1년 이하의 징역 또는 1천만원 이하의 벌금
(필요한 조치 불이행) 1천만원 이하의 과태료` },
  { law: '제42조[유해위험방지계획서의 작성·제출 등]',
    content: `유해위험방지계획서 제출 대상(시행령 42조)에 해당하는 사업으로서 해당 물질의 생산 공정과 직접적으로 관련된 건설물 기계 기구 및 설비 등 전부를 설치 이전 구조변경을 하려는 경우 작성하여 고용노동부장관에게 제출 심사를 받아야 함`,
    penalty: `1천만원 이하의 과태료 또는 5년 이하의 징역 또는 5천만원 이하의 벌금` },
  { law: '제44조[공정안전보고서의 작성·제출]',
    content: `유해하거나 위험한 설비를 보유한 사업주는 고용노동부령에 따라 공정안전관리보고서(PSM)을 작성하고 고용노동부장관에게 제출하여 심사를 받아야 함
(공정안전보고서의 적정통보 전에는 유해하거나 위험한 설비를 가동 불가)`,
    penalty: `공정안전보고서 미적정: 3년 이하의 징역 또는 3천만원 이하의 벌금
미제출: 1천만원 이하의 과태료` },
  { law: '제51조[사업주의 작업중지]',
    content: `사업주는 산업재해가 발생할 급박한 위험이 있을 때에는 즉시 작업을 중지시키고 근로자를 작업장소에서 대피시키는 등 안전 및 보건에 관하여 필요한 조치를 하여야 함`,
    penalty: `위반 시: 5년 이하의 징역 또는 5천만원 이하의 벌금` },
  { law: '제52조[근로자의 작업중지]',
    content: `▷ 산업재해가 발생할 급박한 위험이 있는 경우에는 즉시 해당 작업을 중지시키고 대피시키는 등 안전 및 보건에 관하여 필요한 조치를 하여야 하며, 지체 없이 작업공동노동자의 경우에 전화·팩스 등의 적절한 방법으로 보고하여야 함
▷ 근로자는 산업재해가 발생할 급박한 위험이 있는 경우에는 작업을 중지하고 대피할 수 있으며, 지체 없이 그 사실을 관리감독자 또는 그 밖에 부서의 장에게 보고하여야 함
▷ 사업주는 합리적인 이유가 있을 때에는 해당 근로자에 대하여 해고나 그 밖의 불리한 처우를 하여서는 아니 됨`,
    penalty: `미기소료·3천만원 이하의 과태료` },
  { law: '제57조[산업재해 발생 은폐 금지 및 보고 등]',
    content: `▷ 산업재해발생 은폐하지 않으며, 발생현황 등을 기록하여 3년간 보존하여야 함
▷ 사망자가 발생하거나 3일 이상의 휴업이 필요한 부상을 입거나 질병에 관한 사항 발생 시 산업재해가 발생한 날부터 1개월 이내에 산업재해조사표 작성 제출`,
    penalty: `은폐: 1년 이하의 징역 또는 1천만원 이하의 벌금
미기록·미각, 1천 500만원 이하의 과태료` },
  { law: '제58조[유해한 작업의 도급금지]',
    content: `근로자의 안전 및 보건에 유해하거나 위험한 작업 도급 금지`,
    penalty: `10억원 이하의 과징금` },
  { law: '제59조[도급인의 안전조치 및 보건조치]',
    content: `도급인은 관계수급인 근로자가 도급인 사업장에서 작업을 하는 경우 근무 모두의 산재를 예방하기 위하여 안전 및 보건 시설의 설치 등 필요한 조치를 해야 함 (보호구 착용 등 직접 지시 사례)`,
    penalty: `근로자 사망시 7년 이하의 징역 또는 1억원 이하의 벌금` },
  { law: '제64조[도급에 따른 산업재해 예방조치]',
    content: `도급인은 관계수급인 근로자가 도급인의 사업장에서 작업을 하는 경우
· 도급인과 수급인을 구성원으로 하는 안전 및 보건에 관한 협의체의 구성 및 운영
· 작업장 순회점검
· 안전보건교육의 실시 확인 및 장소, 자재 지원
· 정보체계 대비방안 제출
· 위생시설 이용, 설치 협조
· 관계수급인 등에 대한 작업개시, 내용, 안전조치 및 보건조치 확인`,
    penalty: `1년 이하의 징역 또는 1천만원 이하의 벌금
위생시설 미설치: 1500만원 이하의 과태료` },
  { law: '제65조[도급인의 안전 및 보건에 관한 정보 제공 등]',
    content: `도급인은 자신 해당 작업 시작 전에 수급인에게 안전 및 보건에 관한 정보를 문서로 제공
유해성·위험성이 있는 화학물질 또는 그 화학물질을 포함한 혼합물을 제조·사용·운반·취급 또는 보관의 위험이 있는 작업 등`,
    penalty: `1년 이하의 징역 또는 1천만원 이하의 벌금` },
  { law: '제80조[유해하거나 위험한 기계·기구]',
    content: `누구든지 형식에 맞지 않는 기계·기구 등을 대통령령으로 정하는 것을 고용노동부장관으로 정하는 유해 위험 방지를 위한 방호조치를 하지 아니하고는, 양도, 대여, 설치 또는 사용에 제공하거나 이들의 목적으로 화시하지 않아야 함`,
    penalty: `1년 이하의 징역 또는 1천만원 이하의 벌금` },
  { law: '제93조[안전검사]',
    content: `프레스(크랭크), 크레인(2톤 이상), 리프트, 압력용기, 곤돌라, 소기계기계(이동식 제외), 원심기(산업용 한정), 롤러기(밀폐형 구조 제외), 사출성형기(형 체결력 294킬로뉴턴 이상), 고소작업대(화물 적재 포함 등 특수 작업을 위한 장치로 결합), 컨베이어, 산업용 로봇
검사 주기: 「산업안전보건법 시행령」 제126조 참고`,
    penalty: `1천만원 이하의 과태료` },
  { law: '제114조[물질안전보건자료의 게시 및 교육] / 제115조[물질안전보건자료 대상물질의 경고표시]',
    content: `▷ 물질안전보건자료 대상 물질을 취급하는 작업장 내에 이를 취급하는 근로자가 쉽게 볼 수 있는 장소에 게시하거나 갖추어 두어야 하며, 취급하는 작업공정별 물질안전보건자료 관리 요령 게시 및 해당 근로자 교육
▷ 물질안전보건자료 대상물질을 담은 용기 및 포장에 경고표시`,
    penalty: `미게시: 500만원 이하의 과태료(게시/게5분)
미교육: 300만원 이하의 과태료(미실시 1분당)
미경고표시: 300만원 이하의 과태료` },
  { law: '제119조[석면조사] / 제119조[석면해체·제거]',
    content: `▷ 건축물 등을 철거 시 지정기관에서 석면조사를 실시하고 작업 기준을 준수하여야 함
▷ 일정 면적 이상 석면함유 건축물 철거 시 석면해체제거자에 인가를 득하여 해체하여야 함`,
    penalty: `3년 이하의 징역 또는 3천만원 이하의 벌금
미석면조사: 1년 이하의 징역 또는 1천만원 이하의 벌금` },
  { law: '제125조[작업환경측정]',
    content: `소음(80dB 이상), 화학물질, 분진, 고열 등에 근로자가 노출되는 사업장은 작업환경측정 실시 및 결과보고 ('산업안전보건법', 시행규칙 [별표21])
해당 시설 설비의 설치 개선 또는 건강진단의 실시 등의 조치를 하지 아니한 시`,
    penalty: `1천만원 이하의 벌금` },
  { law: '제128조의2[휴게시설의 설치]',
    content: `사업주는 근로자(관계수급인의 근로자 포함)가 신체적 피로와 정신적 스트레스를 해소할 수 있도록 휴식시간에 이용할 수 있는 휴게시설을 갖추어야 하며 해당 시설의 청결, 위생, 온도 등을 위하여 관리기준을 준수하여야 함`,
    penalty: `미설치: 1천5백만원 이하의 과태료
기준위반: 1천만원 이하의 과태료` },
  { law: '제129조[일반건강진단] / 제130조[특수수건강진단 등]',
    content: `▷ 일반건강진단: 사무직(1회 이상/2년), 비사무직(1회 이상/1년)
▷ 특수건강진단: 소음, 화학물질 등 노출 근로자(오기/마감일별로 1회 이상/6~24개월, 「산업안전보건법」, 시행규칙 [별표22, 23])
▷ 배치전건강진단: 특수건강진단 해당 작업 배치하기 전, 작업전환 시 작업 전 실시`,
    penalty: `1천만원 이하의 과태료` },
  { law: '제164조[자료의 보존]',
    content: `사업주는 다음의 서류를 3년 보존:
· 안전보건관리책임자·안전관리자·보건관리자
· 안전보건관리담당자 및 산업보건의의 선임에 관한 서류
· 산업안전보건위원회, 노사협의체 회의록(2년)
· 안전조치 및 보건조치에 관한 사항을 기록한 서류
· 화학물질의 유해성 검사에 관한 서류
· 작업환경측정에 관한 서류
· 건강진단에 관한 서류
· 산업재해발생기록에 대한 기재 및 그에 관하여 기록한 서류`,
    penalty: `300만원 이하의 과태료 (각 서류마다 적용)` },
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function openLawDetail(i) {
  const it = LAW_ITEMS[i];
  if (!it) return;
  document.getElementById('lawDetailTitle').textContent = (i + 1) + '. ' + it.law;
  document.getElementById('lawDetailContent').textContent = it.content;   // 개행은 CSS white-space:pre-wrap 로 유지
  document.getElementById('lawDetailPenalty').textContent = it.penalty;
  document.getElementById('lawDetailOverlay').classList.add('open');
}

function openPolicy(type) {
  const title = document.getElementById('policyTitle');
  const body = document.getElementById('policyBody');
  const box = document.querySelector('#policyOverlay .modal-box');
  if (!title || !body) return;

  if (type === 'management') {
    // 문서형(document) 레이아웃 — 참고: 안전보건경영방침.dc.html
    if (box) { box.classList.add('policy-doc-mode'); box.style.maxWidth = '780px'; }
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
    if (box) { box.classList.remove('policy-doc-mode'); box.style.maxWidth = '1040px'; }
    title.textContent = '산업안전보건 법령요지';
    const rows = LAW_ITEMS.map((it, i) => {
      const flat = it.content.replace(/\s+/g, ' ').trim();
      const preview = flat.length > 50 ? flat.slice(0, 50) + '…' : flat;
      return `<tr class="law-row" onclick="openLawDetail(${i})">
        <td class="law-no">${i + 1}</td>
        <td class="law-name">${escapeHtml(it.law)}</td>
        <td class="law-preview">${escapeHtml(preview)}</td>
        <td class="law-penalty">${escapeHtml(it.penalty.replace(/\s+/g, ' ').trim())}</td>
      </tr>`;
    }).join('');
    body.innerHTML = `
      <div class="law-caption">기준일: 2025.1 기준 · 행을 클릭하면 조항 상세를 볼 수 있습니다.</div>
      <div class="law-wrap">
        <table class="law-table">
          <thead>
            <tr>
              <th style="width:52px;">순번</th>
              <th style="width:260px;">산업안전보건법</th>
              <th>주요내용</th>
              <th style="width:200px;">벌칙</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }
  document.getElementById('policyOverlay').classList.add('open');
}

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
// ===== 현장 통합 관리 모달 (공정 특성 + 위험성평가 / 현장 특이사항) =====
// 공정별 위험성평가 더미 데이터
const RISK_ASSESSMENT_DATA = {
  'PRC-19': {
    title: '정밀가공 공정 (PRC-19) 위험성평가 결과',
    meta: '평가일 2026-05-12 · 4M 기법',
    stats: { high: 2, mid: 3, low: 4, total: 9 },
    list: [
      { factor: '고속 회전체 협착·말림', p: 3, s: 5, r: '15 높음', cls: 'high', solution: '방호덮개 설치·연동장치' },
      { factor: '화학물질(염산) 누출 노출', p: 3, s: 5, r: '15 높음', cls: 'high', solution: '국소배기·내산 PPE' },
      { factor: '절삭칩 비산 안구 손상', p: 4, s: 3, r: '12 중간', cls: 'mid', solution: '보안경 착용 의무화' },
      { factor: '소음(76dB) 청력 영향', p: 3, s: 3, r: '9 중간', cls: 'mid', solution: '귀마개·소음원 격리' }
    ]
  },
  'PRC-07': {
    title: '용접 공정 (PRC-07) 위험성평가 결과',
    meta: '평가일 2026-06-10 · 4M 기법',
    stats: { high: 1, mid: 4, low: 2, total: 7 },
    list: [
      { factor: '용접 아크 광선에 의한 안구 화상', p: 4, s: 4, r: '16 높음', cls: 'high', solution: '용접 보안면 및 차광 유리 사용 필수' },
      { factor: '흄 및 유해가스 흡입 위험', p: 3, s: 3, r: '9 중간', cls: 'mid', solution: '송풍 마스크 및 국소배기장치 가동 정기 점검' },
      { factor: '용접 불꽃 비산으로 인한 주변 화재', p: 2, s: 4, r: '8 중간', cls: 'mid', solution: '불티방지패드 설치 및 소화기 전면 배치' }
    ]
  },
  'PRC-12': {
    title: '도장 공정 (PRC-12) 위험성평가 결과',
    meta: '평가일 2026-06-15 · 4M 기법',
    stats: { high: 3, mid: 2, low: 3, total: 8 },
    list: [
      { factor: '유기용제 증기 폭발 및 화재', p: 3, s: 5, r: '15 높음', cls: 'high', solution: '방폭형 설비 도입 및 정전기 제거 패드 설치' },
      { factor: '밀폐공간 내 질식 및 가스중독', p: 2, s: 5, r: '10 중간', cls: 'mid', solution: '작업 전 유해가스 측정 및 송풍기 상시 가동' }
    ]
  }
};

let activeRiskCode = null;

function openIssueMgmt() {
  resetIssueModal();
  document.getElementById('issueOverlay').classList.add('open');
}

// 모달을 열 때마다 기본 상태(공정 탭 + 위험성평가 접힘)로 초기화
function resetIssueModal() {
  switchTab('tab-process', document.querySelector('#issueOverlay .tab-btn'));
  const section = document.getElementById('integratedRiskSection');
  if (section) section.classList.remove('active');
  document.querySelectorAll('#issueOverlay .btn-table-risk').forEach(b => b.classList.remove('active'));
  activeRiskCode = null;
}

function switchTab(tabId, btnEl) {
  document.querySelectorAll('#issueOverlay .tab-pane').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#issueOverlay .tab-btn').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById(tabId);
  if (pane) pane.classList.add('active');
  if (btnEl) btnEl.classList.add('active');
}

// 테이블 내 위험성평가 버튼 → 하단 인라인 상세 섹션 토글
function toggleRiskAssessment(code, btn) {
  const section = document.getElementById('integratedRiskSection');

  // 같은 공정 버튼을 다시 누르면 접기
  if (activeRiskCode === code) {
    section.classList.remove('active');
    btn.classList.remove('active');
    activeRiskCode = null;
    return;
  }

  document.querySelectorAll('#issueOverlay .btn-table-risk').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activeRiskCode = code;

  const data = RISK_ASSESSMENT_DATA[code];
  if (!data) return;

  document.getElementById('riskTargetTitle').textContent = data.title;
  document.getElementById('riskTargetMeta').textContent = data.meta;
  document.getElementById('riskStatsContainer').innerHTML = `
    <div class="stat-box"><div class="num red">${data.stats.high}</div><div class="label">높음 (15+)</div></div>
    <div class="stat-box"><div class="num orange">${data.stats.mid}</div><div class="label">중간 (8~12)</div></div>
    <div class="stat-box"><div class="num green">${data.stats.low}</div><div class="label">낮음 (1~6)</div></div>
    <div class="stat-box"><div class="num blue">${data.stats.total}</div><div class="label">총 위험요인</div></div>
  `;
  document.getElementById('riskTableBody').innerHTML = data.list.map(item => `
    <tr>
      <td><strong>${item.factor}</strong></td>
      <td>${item.p}</td>
      <td>${item.s}</td>
      <td><span class="risk-score-badge ${item.cls}">${item.r}</span></td>
      <td>${item.solution}</td>
    </tr>
  `).join('');

  section.classList.add('active');
  setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

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
