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
  // 좌측 하단 위치 라벨은 제거됨(현장 특이사항 로그로 대체). locName/locProc 미사용.
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
    '1': 'CAM-1 · 정밀가공 라인',
    '2': 'CAM-2 · 절단기 작업존',
    '3': 'CAM-3 · 관람객 통로'
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
  // CCTV 탭을 벗어나면 이상현상 미니 팝업/스트림 정리.
  if (view !== 'cctv' && window.hideCctvAlert) window.hideCctvAlert();
}

// ===== Generic modal control =====
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
['hrOverlay','msdsOverlay','photoOverlay','evacOverlay','facilityOverlay','contactOverlay','aiSiteOverlay','envDetailOverlay','processOverlay','issueOverlay','policyOverlay','lawDetailOverlay','riskCriteriaOverlay'].forEach(id => {
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
// 목록 표(processOverlay)는 renderProcessList()가 이 배열에서 자동 생성하므로 순서만 맞추면 됨
const PROCESS_DATA = [
  { code:'PRC-19', name:'정밀가공 라인', manager:'이*학', riskThreshold:8,
    locations:['도장부스','도장작업실','밀폐내부 작업존(밀폐)','밀폐작업구역(밀폐)','원자재 이송구역','절단기 작업존','정비투입구역'],
    desc:'금속 또는 부품을 규격과 도면에 맞게 고정밀로 가공하는 작업',
    workers:[{name:'김*모',hr:72},{name:'박*철',hr:88},{name:'이*준',hr:65}],
    subs:[
      {ord:1,name:'선반 외경 가공',desc:'지름 60mm의 원봉을 선반에 고정한 후, 바깥 지름을 50mm로 깎아내는 작업. 자동차 샤프트의 외경을 일정한 크기로 정밀 가공',machines:'전동식 자주식 고소작업대, 이동식 흄 집진기, 이동차 외벽청소용 곤돌라',chems:['염산','에틸 알코올','황산'],prot:'알루미늄 방열복, 용접용 차광 보안면'},
      {ord:2,name:'홈 가공',desc:'축 중간에 키(key)가 들어갈 수 있도록 깊이 3mm, 폭 5mm의 홈을 파는 작업',machines:'이동식 흄 집진기',chems:['황산'],prot:'용접용 차광 보안면, 안전고리 추락 방지용 라이프라인'},
    ]},
  { code:'PRC-07', name:'금속산세척', manager:'전*조', riskThreshold:8,
    locations:['표면처리실', '산세척 전용 구역'],
    desc:' 금속 부품 표면의 산화막·스케일·이물질을 산 용액에 침지하여 제거하는 작업. 이후 중화·수세 과정 포함',
    workers:[{name:'최*민',hr:80},{name:'정*호',hr:91}],
    subs:[
      {ord:1,name:'산액 준비',desc:'황산 또는 염산을 정해진 농도로 희석하여 산세척조에 투입하는 작업. 발열 반응 주의, 물에 산을 천천히 투입',machines:'산세척조, 계량용기, 교반기, 국소배기장치',chems:['황산', '염산', '0.01N 염산용액'],prot:'내산성 장갑, 전면보호면, 내산성 앞치마, 산성가스용 방독마스크'},
      {ord:2,name:'첨지 세척',desc:'금속 부품을 산 용액에 일정 시간 침지하여 산화막·녹을 용해·제거하는 작업',machines:'산세척조, 부품 고정 집게, 환기장치',chems:['황산', '염산'],prot:'내산성 장갑, 전면보호면, 내산성 앞치마, 방독마스크'},
      {ord:2,name:'첨지 세척',desc:'산세척 완료 후 중화조에서 잔류 산을 중화하고 수세조에서 깨끗한 물로 최종 세척하는 작업',machines:'중화조, 수세조, 에어건',chems:[],prot:'내산성 장갑, 보안경'},
    ]},
  { code: 'PRC-23', name: '도장·코팅',manager:'박*유', riskThreshold:8, locations: ['도장부스', '도장작업실'],
    desc: '금속·구조물 표면에 방청 및 마감 목적의 도료를 스프레이 또는 롤러로 도포하는 작업. 하도→중도→상도 순서 진행',
    workers:[{name: '김*환',hr:76},{name:'김*원', hr:79}],
    subs: [
      {ord: 1,name: '도료 조색 및 희석',desc: '도료와 경화제를 규정 비율로 혼합하고 점도에 맞게 희석하는 작업',machines: '계량저울, 교반기, 점도계',chems: ['에포코트라이닝 투명 동절기용<B부>', 'SC-333', 'BLACSEN BS-1'],prot: '유기증기용 방독마스크, 내화학성 장갑, 보안경'},
      {ord: 2,name: '하도(프라이머) 도포',desc: '소재 표면에 밀착성 향상과 방청을 위한 하도 도료를 스프레이로 도포하는 작업',machines: '스프레이 건, 에어컴프레서, 도장부스',chems: ['SC-333'],prot: '유기증기용 방독마스크, 보호의, 내화학성 장갑, 보안경'},
      {ord: 3,name: '상도 도장',desc: '건조된 하도 위에 색상·광택·내구성을 위한 상도 도료를 도포하는 작업',machines: '스프레이 건, 에어컴프레서, 도장부스, 건조기',chems: ['워타톱(EG)', '락카페인트스프레이(흑색)', 'BLACSEN BS-1'],prot: '유기증기용 방독마스크, 보호의, 내화학성 장갑, 보안경'},
      {ord: 4,name: '건조 및 검사',desc: '도장 완료 후 건조기 또는 자연 건조로 도막을 경화하고 두께·외관을 검사하는 작업',machines: '건조기, 도막두께측정기',chems: [],prot: '안전장갑, 보안경'},
    ]},
  { code:'PRC-31', name:'도장 및 표면처리 공정', manager:'최*재', riskThreshold:8,
    locations:['도장부스'],
    desc:'제품의 부식 방지와 외관 향상을 위해 도장 및 표면처리를 수행하는 작업',
    workers:[{name:'윤*식',hr:85},{name:'서*찬',hr:73}],
    subs:[
      {ord:1,name:'프라이머 도포 분체 도장',desc:'완성된 제품 또는 부품에 도장을 실시하거나 방청/표면강화 처리를 통해 품질과 외관을 향상',machines:'-',chems:['워타톱(EG)','락카페인트스프레이(흑색)'],prot:'-'},
    ]},
];

// 공정 목록을 PROCESS_DATA에서 자동 생성(정적 HTML과 인덱스 어긋남 방지)
function renderProcessList() {
  const body = document.getElementById('procListBody');
  if (!body) return;
  body.innerHTML = PROCESS_DATA.map((p, i) => `
    <tr class="clickable" onclick="showProcessDetail(${i})">
      <td>${escapeHtml(p.code)}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.manager)}</td>
      <td>${p.workers ? p.workers.length : 0}</td>
      <td><span class="risk-badge low">진행중</span></td>
      <td><span class="row-arrow">›</span></td>
    </tr>`).join('');
  const cnt = document.getElementById('procActiveCount');
  if (cnt) cnt.textContent = PROCESS_DATA.length;
}

function openProcessMgmt() {
  renderProcessList();
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

  const subRows = p.subs.map((sp, si) => {
    const chemCells = sp.chems.length
      ? sp.chems.map(c => `<button class="chem-btn" onclick="openMSDS('${c.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}')">${escapeHtml(c)}</button>`).join('')
      : '<span style="color:var(--t-3);">—</span>';
    return `<tr>
      <td class="tc">${sp.ord}</td>
      <td class="tnd"><div class="tnd-name">${sp.name}</div><div class="tnd-desc">${sp.desc}</div></td>
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
    <div class="proc-info-block">
      <button class="btn-proc-risk" onclick="openRiskEval(${idx})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.7 3h16.96a2 2 0 0 0 1.7-3L13.7 3.86a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>
        위험성평가
      </button>
      <div class="proc-info-grid">
        <div class="proc-ig-lbl">공정 코드</div>
        <div class="proc-ig-val" style="font-weight:700;color:var(--cyan);letter-spacing:.5px">${p.code}</div>
        <div class="proc-ig-lbl">공정명</div>
        <div class="proc-ig-val" style="font-weight:700">${p.name}</div>
        <div class="proc-ig-lbl">설명</div>
        <div class="proc-ig-val" style="line-height:1.6">${p.desc}</div>
      </div>
    </div>

    <div class="proc-sec-lbl">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      세부 공정(작업)
    </div>

    <div class="proc-sub-wrap">
      <table class="proc-sub-table">
        <thead>
          <tr>
            <th style="width:56px">작업순서</th>
            <th class="tl" style="width:280px">작업명/설명</th>
            <th style="width:165px">기계/기구/설비 등</th>
            <th style="width:120px">사용물질</th>
            <th style="width:140px">보호구</th>
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

/* ===== 위험성평가 상세 (빈도 × 강도, 4×4 기법) ===== */
// 세부 작업별 유해·위험요인. [공정 인덱스][작업 인덱스] = [{ ...위험성평가 항목 }]
// cat:유해·위험분류, sub:세부분류, factor:유해·위험 요인, cur:현재의 안전보건조치,
// freq/sev:현재 빈도·강도, measure:감소대책, rFreq/rSev:개선후 빈도·강도,
// plan:개선예정일, done:개선완료일('-'=미완료), owner:개선담당자
const HAZARDS = {
  0: [ // PRC-19 정밀가공
    [ { cat:'기계(설비)적 요인', sub:'회전체 말림·협착 위험', factor: '고속 회전체 협착·말림', cur:'방호덮개 부착, 비상정지 스위치 운영', freq: 3, sev: 4, measure: '방호덮개 보강, 비상정지장치 정기점검, 회전부 접근 금지구역 설정', rFreq:1, rSev:4, plan:'2026-05-10', done:'2026-05-08', owner:'이*학' },
      { cat:'기계(설비)적 요인', sub:'절삭칩 비산 위험', factor: '절삭칩 비산 안구 손상', cur:'보안경 비치', freq: 3, sev: 2, measure: '보안경 착용 의무화, 비산 방지 커버 설치', rFreq:1, rSev:2, plan:'2026-05-12', done:'-', owner:'박*철' },
      { cat:'화학물질적 요인', sub:'절삭유 피부 접촉', factor: '절삭유 피부 접촉 피부질환', cur:'면장갑 사용', freq: 2, sev: 2, measure: '내유성 장갑 착용, 세척시설 비치', rFreq:1, rSev:2, plan:'2026-05-15', done:'2026-05-14', owner:'이*준' } ],
    [ { cat:'기계(설비)적 요인', sub:'공구 파손·파편 비산', factor: '공구 파손 파편 비산', cur:'표준 절삭조건 게시', freq: 2, sev: 3, measure: '적정 절삭조건 준수, 차광 보안면 착용', rFreq:1, rSev:3, plan:'2026-05-18', done:'-', owner:'이*학' },
      { cat:'작업환경 요인', sub:'추락위험 부분(개구부 등)', factor: '고소작업 추락', cur:'작업발판 설치', freq: 2, sev: 4, measure: '안전대·작업발판 사용, 라이프라인 체결', rFreq:1, rSev:4, plan:'2026-05-20', done:'2026-05-19', owner:'박*철' } ],
  ],
  1: [ // PRC-07 금속산세척
    [ { cat:'화학물질적 요인', sub:'부식성 물질 취급', factor: '황·염산 취급 중 화학화상', cur:'내산 장갑·앞치마 착용', freq: 3, sev: 4, measure: '내산 PPE 착용, 물에 산을 천천히 투입, 비상샤워기 비치', rFreq:1, rSev:4, plan:'2026-05-01', done:'2026-04-28', owner:'전*조' },
      { cat:'화학물질적 요인', sub:'산성 증기 노출', factor: '산성 증기 흡입 호흡기 손상', cur:'자연환기', freq: 3, sev: 3, measure: '국소배기장치 가동, 산성가스용 방독마스크 착용', rFreq:1, rSev:3, plan:'2026-05-01', done:'-', owner:'최*민' } ],
    [ { cat:'화학물질적 요인', sub:'산 용액 비산', factor: '산 용액 비산 눈·피부 접촉', cur:'보안경 착용', freq: 3, sev: 3, measure: '전면보호면·내산 앞치마 착용, 비산 방지 덮개', rFreq:1, rSev:3, plan:'2026-05-05', done:'2026-05-03', owner:'정*호' },
      { cat:'작업환경 요인', sub:'중량물 인양 부담', factor: '침지물 인양 근골격계 부담', cur:'수동 인양', freq: 2, sev: 2, measure: '인양보조구 사용, 2인 1조 작업', rFreq:1, rSev:2, plan:'2026-05-08', done:'-', owner:'최*민' } ],
    [ { cat:'화학물질적 요인', sub:'잔류 산 접촉', factor: '잔류 산 접촉', cur:'수세 실시', freq: 2, sev: 2, measure: '중화 확인 후 취급, 내산 장갑 착용', rFreq:1, rSev:2, plan:'2026-05-10', done:'2026-05-09', owner:'정*호' } ],
  ],
  2: [ // PRC-23 도장·코팅
    [ { cat:'화학물질적 요인', sub:'유기용제 증기 노출', factor: '유기용제 증기 흡입', cur:'방진마스크 착용', freq: 3, sev: 3, measure: '유기증기용 방독마스크 착용, 환기 유지', rFreq:1, rSev:3, plan:'2026-06-01', done:'2026-05-30', owner:'박*유' },
      { cat:'화학물질적 요인', sub:'인화성 물질 취급(화재·폭발)', factor: '인화성 도료 화재·폭발', cur:'소화기 비치', freq: 2, sev: 4, measure: '점화원 제거, 정전기 방지 접지, 소화기 비치', rFreq:1, rSev:4, plan:'2026-06-01', done:'-', owner:'김*환' } ],
    [ { cat:'화학물질적 요인', sub:'미스트 흡입', factor: '스프레이 미스트 흡입', cur:'마스크 착용', freq: 3, sev: 2, measure: '도장부스 배기 가동, 방독마스크 착용', rFreq:1, rSev:2, plan:'2026-06-03', done:'2026-06-02', owner:'김*원' } ],
    [ { cat:'화학물질적 요인', sub:'유기용제 중독', factor: '유기용제 중독', cur:'방독마스크 착용', freq: 3, sev: 3, measure: '방독마스크·보호의 착용, 작업시간 관리', rFreq:1, rSev:3, plan:'2026-06-05', done:'-', owner:'박*유' },
      { cat:'화학물질적 요인', sub:'폭발 분위기 형성', factor: '분진·미스트 폭발 분위기', cur:'환기 실시', freq: 2, sev: 4, measure: '방폭 설비 사용, 환기·접지 확보', rFreq:1, rSev:4, plan:'2026-06-05', done:'2026-06-04', owner:'김*환' } ],
    [ { cat:'작업환경 요인', sub:'고온 표면 접촉', factor: '건조기 고온 표면 화상', cur:'주의표지 부착', freq: 1, sev: 2, measure: '내열장갑 착용, 접촉 주의표지 부착', rFreq:1, rSev:1, plan:'2026-06-08', done:'-', owner:'김*원' } ],
  ],
  3: [ // PRC-31 도장 및 표면처리
    [ { cat:'화학물질적 요인', sub:'분진 흡입·분진폭발', factor: '분체도료 분진 흡입·분진폭발', cur:'방진마스크 착용', freq: 2, sev: 3, measure: '집진설비 가동, 방진마스크 착용, 접지', rFreq:1, rSev:3, plan:'2026-06-10', done:'2026-06-09', owner:'최*재' },
      { cat:'전기적 요인', sub:'정전기 착화', factor: '정전기에 의한 착화', cur:'접지 설비', freq: 2, sev: 2, measure: '정전기 제거장치, 도전성 작업화 착용', rFreq:1, rSev:2, plan:'2026-06-12', done:'-', owner:'윤*식' } ],
  ],
};
// 위험성 수준 정의 — 빈도강도 기준표 그대로(점수 → 등급/허용범위/개선방안/관리기준).
const RISK_GRADES = [
  { cls: 'rg-vh', label: '매우높음', range: '16',  scores: [16],   allow: '허용불가능', plan: '허용불가 위험',       mgmt: '작업 즉시 중단(작업을 지속하려면 즉시 개선을 실행해야 하는 위험)' },
  { cls: 'rg-h',  label: '높음',     range: '12',  scores: [12],   allow: '허용불가능', plan: '중대한 위험',         mgmt: '긴급 임시안전대책을 세운 후 작업을 하되 정기보수기간에 안전대책을 세워야 하는 위험' },
  { cls: 'rg-sh', label: '약간높음', range: '8~9', scores: [8, 9], allow: '허용가능',   plan: '상당한 위험',         mgmt: '정기보수기간에 안전대책을 세워야 하는 위험' },
  { cls: 'rg-m',  label: '보통',     range: '6',   scores: [6],    allow: '허용가능',   plan: '개선이 필요한 위험',   mgmt: '안전대책을 세워야 하는 위험' },
  { cls: 'rg-l',  label: '낮음',     range: '3~4', scores: [3, 4], allow: '허용가능',   plan: '경미한 위험',         mgmt: '위험표시 부착, 작업절차서 표기 등 관리적 대책이 필요한 위험' },
  { cls: 'rg-vl', label: '매우낮음', range: '1~2', scores: [1, 2], allow: '허용가능',   plan: '무시할 수 있는 위험', mgmt: '추가적인 안전대책이 필요없음' },
];
function gradeForScore(score) {
  return RISK_GRADES.find(g => g.scores.includes(score)) || RISK_GRADES[RISK_GRADES.length - 1];
}
// '2026-05-01' → '26.05.01' (좁은 날짜 칸 대응)
function fmtRiskDate(d) {
  if (!d || d === '-') return '-';
  return escapeHtml(d.slice(2).replace(/-/g, '.'));
}

// 빈도×강도 채점 기준 매트릭스 + 위험성 수준 평가 기준표 HTML(호버 툴팁용)
function buildRiskCriteriaHtml() {
  let matrix = '<table class="risk-mx"><thead>'
    + '<tr><th class="rmx-corner" rowspan="2" colspan="2">빈도 × 강도</th><th colspan="4">중대성 (강도)</th></tr>'
    + '<tr>' + [4, 3, 2, 1].map(s => `<th>${s}</th>`).join('') + '</tr></thead><tbody>';
  [4, 3, 2, 1].forEach((f, i) => {
    matrix += '<tr>';
    if (i === 0) matrix += '<th class="rmx-side" rowspan="4">가능성<br>(빈도)</th>';
    matrix += `<th class="rmx-fn">${f}</th>`;
    [4, 3, 2, 1].forEach(s => {
      const sc = f * s, gg = gradeForScore(sc);
      matrix += `<td class="rmx-cell ${gg.cls}">${gg.label}<span class="rmx-score">(${sc})</span></td>`;
    });
    matrix += '</tr>';
  });
  matrix += '</tbody></table>';

  let levels = '<table class="risk-lv"><thead><tr>'
    + '<th>위험성 수준</th><th>허용가능 범위</th><th>개선 방안</th><th>관리기준</th>'
    + '</tr></thead><tbody>';
  RISK_GRADES.forEach(gr => {
    levels += `<tr>
      <td class="rlv-grade"><span class="rlv-range">${gr.range}</span><span class="rlv-badge ${gr.cls}">${gr.label}</span></td>
      <td>${gr.allow}</td>
      <td>${gr.plan}</td>
      <td class="rlv-mgmt">${gr.mgmt}</td>
    </tr>`;
  });
  levels += '</tbody></table>';

  return `<div class="risk-criteria"><div class="risk-mx-wrap">${matrix}</div>${levels}</div>`;
}

// 공정 단위 위험성평가 — 예시 양식(작업명·분류·현재/개선후 위험성·담당자) 표로 표시
function openRiskEval(pIdx) {
  const p = PROCESS_DATA[pIdx];
  if (!p) return;
  const groups = (p.subs || []).map((sp, si) => ({
    task: sp.name,
    rows: (HAZARDS[pIdx] && HAZARDS[pIdx][si]) || [],
  })).filter(g => g.rows.length);

  let total = 0, maxScore = 0;
  groups.forEach(g => g.rows.forEach(h => { total++; maxScore = Math.max(maxScore, h.freq * h.sev); }));
  const topGrade = gradeForScore(maxScore || 1);
  const threshold = p.riskThreshold || 8;  // 공정별 대책 관리 기준점수(이 점수 이상이면 감소대책 관리)

  document.getElementById('riskEvalSub').textContent = p.code + ' · ' + p.name;

  // 본문: 공정의 모든 세부작업 유해·위험요인을 한 표에(작업명 셀 병합)
  const dash = '<span class="rk-none">―</span>';
  const bodyRows = groups.length ? groups.map(g => g.rows.map((h, i) => {
    const cur = h.freq * h.sev, curG = gradeForScore(cur);
    // 기준점수 이상만 감소대책 관리 대상. 미만은 허용가능 → 대책 없이 현행 유지.
    const needsMeasure = cur >= threshold;
    const imp = h.rFreq * h.rSev, impG = gradeForScore(imp);
    const taskCell = i === 0
      ? `<td class="rk-task" rowspan="${g.rows.length}">${escapeHtml(g.task)}</td>` : '';
    return `<tr>
      ${taskCell}
      <td class="rk-cat">${escapeHtml(h.cat)}</td>
      <td class="rk-sub">${escapeHtml(h.sub)}</td>
      <td class="rk-factor">${escapeHtml(h.factor)}</td>
      <td class="rk-cur">${escapeHtml(h.cur)}</td>
      <td class="tc">${h.freq}</td>
      <td class="tc">${h.sev}</td>
      <td class="tc"><span class="rlv-badge ${curG.cls}">${cur}</span></td>
      <td class="rk-measure">${needsMeasure ? escapeHtml(h.measure) : '<span class="rk-none">현행 유지 (허용가능)</span>'}</td>
      <td class="tc">${needsMeasure ? h.rFreq : dash}</td>
      <td class="tc">${needsMeasure ? h.rSev : dash}</td>
      <td class="tc">${needsMeasure ? `<span class="rlv-badge ${impG.cls}">${imp}</span>` : dash}</td>
      <td class="tc rk-date">${needsMeasure ? fmtRiskDate(h.plan) : dash}</td>
      <td class="tc rk-date">${needsMeasure ? (h.done && h.done !== '-' ? fmtRiskDate(h.done) : '<span class="rk-pending">진행중</span>') : dash}</td>
      <td class="tc rk-owner">${needsMeasure ? escapeHtml(h.owner) : dash}</td>
    </tr>`;
  }).join('')).join('')
    : '<tr><td colspan="15" style="text-align:center;color:var(--t-3);padding:18px;">등록된 유해·위험요인이 없습니다.</td></tr>';

  document.getElementById('riskEvalBody').innerHTML = `
    <div class="risk-eval-summary">
      <div class="res-task">
        <div class="res-task-name">${escapeHtml(p.name)} <span class="res-task-code">${escapeHtml(p.code)}</span></div>
        <div class="res-task-desc">${escapeHtml(p.desc)}</div>
      </div>
      <div class="res-top">
        <span class="res-threshold">허용 가능한 위험성 수준 <b>${threshold}</b></span>
        <span class="res-top-cnt">유해·위험요인 ${total}건 · 평가일 2026-04-01 · 빈도·강도법</span>
      </div>
    </div>

    <div class="rk-sec-bar">
      <div class="proc-sec-lbl" style="margin:0;">유해·위험요인별 위험성평가</div>
      <button type="button" class="rk-criteria-trigger" onclick="openRiskCriteria()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        빈도·강도 평가 기준
      </button>
    </div>

    <div class="rk-table-wrap">
      <table class="rk-table">
        <colgroup>
          <col class="c-task"><col class="c-cat"><col class="c-sub"><col class="c-factor"><col class="c-cur">
          <col class="c-num"><col class="c-num"><col class="c-risk">
          <col class="c-measure">
          <col class="c-num"><col class="c-num"><col class="c-risk">
          <col class="c-date"><col class="c-date"><col class="c-owner">
        </colgroup>
        <thead>
          <tr>
            <th rowspan="2" class="rk-th-task">작업명</th>
            <th rowspan="2">유해·위험분류</th>
            <th rowspan="2">세부분류</th>
            <th rowspan="2">유해·위험 요인</th>
            <th rowspan="2">현재의 안전보건조치</th>
            <th colspan="3" class="rk-th-grp">현재위험성</th>
            <th rowspan="2">감소대책</th>
            <th colspan="3" class="rk-th-grp rk-th-imp">개선후 위험성</th>
            <th rowspan="2">개선<br>예정일</th>
            <th rowspan="2">개선<br>완료일</th>
            <th rowspan="2">개선<br>담당자</th>
          </tr>
          <tr>
            <th class="rk-th-sm">빈도</th><th class="rk-th-sm">강도</th><th class="rk-th-sm">위험성</th>
            <th class="rk-th-sm rk-th-imp">빈도</th><th class="rk-th-sm rk-th-imp">강도</th><th class="rk-th-sm rk-th-imp">위험성</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
  document.getElementById('riskEvalOverlay').classList.add('open');
}

// 빈도·강도 평가 기준을 중앙 팝업으로 표시(터치 키오스크 대응 — 표 레이아웃 안 밀림)
function openRiskCriteria() {
  const body = document.getElementById('riskCriteriaBody');
  if (body) body.innerHTML = buildRiskCriteriaHtml();
  document.getElementById('riskCriteriaOverlay').classList.add('open');
}
// ===== 현장 통합 관리 모달 (공정 특성 + 위험성평가 / 현장 특이사항) =====
// 공정별 위험성평가 더미 데이터
const RISK_ASSESSMENT_DATA = {
  'PRC-19': {
    title: '정밀가공 공정 (PRC-19) 위험성평가 결과',
    meta: '평가일 2026-05-12 · 빈도/강도법',
    stats: { very_high:16, high:12, slightly_high:9, moderate: 6, low:4, very_low:2 },
    list: [
      { factor: '고속 회전체 협착·말림', p: 4, s: 4, r: '16', cls: 'very_high', solution: '방호덮개 설치·연동장치' },
      { factor: '화학물질(염산) 누출 노출', p: 3, s: 4, r: '12', cls: 'high', solution: '국소배기·내산 PPE' },
      { factor: '절삭칩 비산 안구 손상', p: 3, s: 3, r: '9', cls: 'slightly_high', solution: '보안경 착용 의무화' },
      { factor: '소음(76dB) 청력 영향', p: 3, s: 4, r: '12', cls: 'high', solution: '귀마개·소음원 격리' }
    ]
  },
  'PRC-07': {
    title: '용접 공정 (PRC-07) 위험성평가 결과',
    meta: '평가일 2026-06-10 · 빈도/강도법',
    stats: { very_high:16, high:12, slightly_high:9, moderate: 6, low:4, very_low:2 },
    list: [
      { factor: '용접 아크 광선에 의한 안구 화상', p: 4, s: 4, r: '16', cls: 'very_high', solution: '용접 보안면 및 차광 유리 사용 필수' },
      { factor: '흄 및 유해가스 흡입 위험', p: 3, s: 3, r: '9', cls: 'slightly_high', solution: '송풍 마스크 및 국소배기장치 가동 정기 점검' },
      { factor: '용접 불꽃 비산으로 인한 주변 화재', p: 2, s: 3, r: '6', cls: 'moderate', solution: '불티방지패드 설치 및 소화기 전면 배치' }
    ]
  },
  'PRC-12': {
    title: '도장 공정 (PRC-12) 위험성평가 결과',
    meta: '평가일 2026-06-15 · 빈도/강도법',
    stats: { very_high:16, high:12, slightly_high:9, moderate: 6, low:4, very_low:2 },
    list: [
      { factor: '유기용제 증기 폭발 및 화재', p: 3, s: 2, r: '6', cls: 'moderate', solution: '방폭형 설비 도입 및 정전기 제거 패드 설치' },
      { factor: '밀폐공간 내 질식 및 가스중독', p: 2, s: 4, r: '8', cls: 'slightly_high', solution: '작업 전 유해가스 측정 및 송풍기 상시 가동' }
    ]
  }
};

let activeRiskCode = null;

function openIssueMgmt() {
  resetIssueModal();
  document.getElementById('issueOverlay').classList.add('open');
}

// 모달을 열 때마다 기본 상태(현장 특이사항 탭)로 초기화.
// 실제 열기/렌더는 backend.js의 openIssueMgmt가 덮어쓴다(실서버 연동 버전).
function resetIssueModal() {
  switchTab('tab-issues', document.querySelector('#issueOverlay .tab-btn'));
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
    <div class="stat-box"><div class="num red">${data.stats.very_high}</div><div class="label">매우 높음</div></div>
    <div class="stat-box"><div class="num red">${data.stats.high}</div><div class="label">높음</div></div>
    <div class="stat-box"><div class="num red">${data.stats.slightly_high}</div><div class="label">약간 높음</div></div>
    <div class="stat-box"><div class="num orange">${data.stats.moderate}</div><div class="label">보통</div></div>
    <div class="stat-box"><div class="num green">${data.stats.low}</div><div class="label">낮음</div></div>
    <div class="stat-box"><div class="num blue">${data.stats.very_low}</div><div class="label">매우낮음</div></div>

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
  // 좌측 하단 위치 라벨은 제거됨(현장 특이사항 로그로 대체).
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
// 염산·황산·에틸 알코올은 ㈜케미탑/OCI MSDS(참고자료 PDF) 기준. 그 외 물질은 일반 MSDS 기준의 대표 정보.
const MSDS = {
  '염산': { cas:'7647-01-0', formula:'HCl (35~40% 수용액)', name:'염산 (Hydrochloric acid)', un:'UN1789', signal:'위험',
    hazard:['삼키면 유해함 (H302)','흡입하면 유독함 (H331)','피부에 심한 화상과 눈에 손상을 일으킴 (H314)','흡입 시 알레르기성 반응·천식·호흡곤란을 일으킬 수 있음 (H334)','장기간·반복 노출 시 치아·호흡기에 손상 (H372)','수생생물에 매우 유독함 (H400)'],
    handling:'국소배기장치 사용, 미스트·증기 흡입 금지, 보호장갑·보호의·보안경·안면보호구 착용, 환기 잘 되는 곳에서 취급, 장비 접지 (노출기준 TWA 1ppm)',
    storage:'환기 잘 되는 서늘한 곳에 단단히 밀폐, 잠금장치 있는 저장소에 보관, 알칼리·금속·가연성 물질과 격리' },
  '황산': { cas:'7664-93-9', formula:'H₂SO₄ (95~99%)', name:'황산 (Sulfuric acid)', un:'UN1830', signal:'위험',
    hazard:['흡입하면 치명적임 (분진·미스트) (H330)','피부에 심한 화상과 눈에 손상을 일으킴 (H314)','암을 일으킬 수 있음 (H350)','신체(호흡기)에 손상을 일으킴 (H370)','장기간·반복 노출 시 기도·폐에 손상 (H372)','장기적 영향에 의해 수생생물에 유해함 (H412)'],
    handling:'분진·흄·미스트 흡입 금지, 보호장갑·보호의·보안경·안면보호구·호흡기보호구 착용, 국소배기·세안설비 설치, 장비 접지 (노출기준 TWA 0.2mg/㎥)',
    storage:'내부식성 용기에 밀봉, 환기 잘 되는 곳에 단단히 밀폐, 물·산화제·강염기·가연성 물질·음식과 격리' },
  '에틸 알코올': { cas:'64-17-5', formula:'C₂H₅OH', name:'에탄올 (Ethanol)', un:'UN1170', signal:'위험',
    hazard:['고인화성 액체 및 증기 (H225)','눈에 심한 자극을 일으킴 (H319)','호흡기계 자극을 일으킬 수 있음 (H335)','졸음 또는 현기증을 일으킬 수 있음 (H336)','암을 일으킬 수 있음 (H350)','장기간·반복 노출 시 호흡기계에 손상 (H372)'],
    handling:'열·스파크·화염·고열 금지(금연), 폭발방지형 전기·환기·조명 사용, 정전기 방지 및 접지, 증기 흡입 피하고 환기 (노출기준 TWA 1000ppm, 인화점 13℃)',
    storage:'환기 잘 되는 곳에 단단히 밀폐하여 저온 보관, 잠금장치 있는 저장소, 점화원·산화제·음식과 격리' },
  '락카페인트 스프레이 (육각)': { cas:'혼합물', formula:'Mixture', name:'락카페인트 스프레이', un:'UN1950', signal:'위험',
    hazard:['극인화성 에어로졸 (H222)','가열 시 폭발 위험 (H229)','졸음 또는 현기증 유발 가능 (H336)'],
    handling:'화기 엄금, 환기되는 곳에서 사용, 방독마스크 착용', storage:'50°C 이하, 직사광선 피함, 점화원과 격리' },
  '절삭유': { cas:'혼합물', formula:'Mixture (광유계)', name:'절삭유 (Cutting fluid)', un:'-', signal:'경고',
    hazard:['장기간·반복 피부 접촉 시 피부염·유분증을 일으킬 수 있음','오일 미스트 흡입 시 호흡기 자극을 일으킬 수 있음','고온 가공 시 발생하는 흄에 장기 노출 주의'],
    handling:'오일 미스트 발생 시 국소배기 사용, 내유성 보호장갑·보안경 착용, 피부 접촉 최소화 (오일미스트 TWA 5mg/㎥)',
    storage:'서늘하고 환기되는 곳에 밀폐 보관, 강산화제·화기와 격리' },
  '아르곤 가스': { cas:'7440-37-1', formula:'Ar', name:'아르곤 (Argon, 압축가스)', un:'UN1006', signal:'경고',
    hazard:['고압가스: 가열 시 폭발할 수 있음','다량 누출 시 공기 중 산소를 치환하여 질식을 일으킬 수 있음 (단순 질식제)'],
    handling:'환기 잘 되는 곳에서 사용, 밀폐공간 작업 시 산소농도 측정, 실린더 고정·전도 방지',
    storage:'직사광선을 피해 40℃ 이하 환기되는 곳에 직립 보관, 밸브 보호캡 장착, 가연성 가스와 격리' },
  '이산화탄소': { cas:'124-38-9', formula:'CO₂', name:'이산화탄소 (Carbon dioxide, 압축가스)', un:'UN1013', signal:'경고',
    hazard:['고압가스: 가열 시 폭발할 수 있음','다량 누출 시 산소를 치환하여 질식을 일으킬 수 있음','고농도 노출 시 두통·현기증·의식저하'],
    handling:'환기 잘 되는 곳에서 사용, 밀폐공간 산소·CO₂ 농도 측정, 실린더 고정 (노출기준 TWA 5000ppm)',
    storage:'직사광선 피해 40℃ 이하 환기되는 곳에 직립 보관, 밸브 보호캡 장착' },
  '그리스': { cas:'혼합물', formula:'Mixture (광유+증주제)', name:'그리스 (Grease, 윤활제)', un:'-', signal:'',
    hazard:['일반 취급 조건에서 유해성 낮음','장기간·반복 피부 접촉 시 피부염을 일으킬 수 있음','고온 시 발생 흄 흡입 주의'],
    handling:'피부 접촉 최소화, 보호장갑 착용, 취급 후 손 세척',
    storage:'서늘하고 건조한 곳에 밀폐 보관, 강산화제와 격리' },
  '나사 고정제': { cas:'혼합물', formula:'Mixture (메타크릴레이트계)', name:'나사 고정제 (Threadlocker)', un:'-', signal:'경고',
    hazard:['피부에 자극을 일으킬 수 있음 (H315)','눈에 자극을 일으킬 수 있음 (H319)','피부 과민성을 일으킬 수 있음 (H317)'],
    handling:'보호장갑·보안경 착용, 환기, 피부·눈 접촉 방지',
    storage:'서늘하고 환기되는 곳에 밀폐, 직사광선·산화제와 격리' },
  '지게차 배터리액': { cas:'7664-93-9', formula:'H₂SO₄ 희석액 (전해액)', name:'지게차 배터리액 (황산 전해액)', un:'UN2796', signal:'위험',
    hazard:['피부에 심한 화상과 눈에 손상을 일으킴 (H314)','금속을 부식시킬 수 있음 (H290)','미스트 흡입 시 호흡기 자극·손상'],
    handling:'내산성 보호장갑·보안경·안면보호구 착용, 충전 시 발생하는 수소가스 환기, 세안설비 비치, 피부·눈 접촉 방지',
    storage:'환기되는 곳에 직립 보관, 금속·알칼리·가연성 물질과 격리, 누액 방지' },
};

// ===== MSDS 전체 자료 (제품 정보 MSDS 형식: 1·2·3·9·15 섹션) =====
// 도장 및 표면처리 공정(PRC-31) 사용물질 — 출처: 제조사 제공 MSDS 원문
const MSDS_FULL = {
  '워타톱(EG)': {
    product: { name:'워타톱(EG)', maker:'벽산페인트', revised:'2022-09-19', cas:'', ke:'', un:'', eu:'', file:'27.워타톱(EG) 흑색.pdf', submitNo:'-' },
    ghsClass:['발암성 : 구분 1A'],
    pictograms:[{ code:'GHS08', label:'건강유해성', en:'Health Hazards' }],
    signal:'위험', physGrade:'낮음', healthGrade:'',
    hCodes:['[H350] 암을 일으킬 수 있음'],
    pStatements:[
      { cat:'예방', items:['[P201] 사용 전 취급 설명서를 확보하시오.','[P202] 모든 안전 예방조치 문구를 읽고 이해하기 전에는 취급하지 마시오.','[P280] (보호장갑·보호의·보안경·안면보호구)를(을) 착용하시오.'] },
      { cat:'대응', items:['[P308+P313] 노출되거나 노출이 우려되면 의학적인 조치·조언을 구하시오.'] },
      { cat:'저장', items:['[P405] 잠금장치가 있는 저장장소에 저장하시오.'] },
      { cat:'폐기', items:['[P501] (관련 법규에 명시된 내용에 따라) 내용물과 용기를 폐기하시오'] },
    ],
    nfpa:{ health:'-', fire:'-', react:'-', specific:'-' },
    components:[
      { cas:'107-21-1', name:'1,2-Ethanediol; Ethylene glycol', range:'0.1000 ― 5.0000', max:'5' },
      { cas:'141-04-8', name:'Hexanedioic acid bis(2-methylpropyl) ester; Diisobutyl adipate', range:'0.1000 ― 5.0000', max:'5' },
      { cas:'1333-86-4', name:'Carbon black; Acetylene black', range:'0.1000 ― 5.0000', max:'5' },
      { cas:'7732-18-5', name:'Water', range:'52.0000 ― 62.0000', max:'62' },
      { cas:'25767-47-9', name:'2-Propenoic acid butyl ester polymer with ethenylbenzene', range:'28.0000 ― 38.0000', max:'38' },
    ],
    physical:[
      { item:'성상', data:'액상', src:'흑색의 액상' }, { item:'색상', data:'흑색', src:'' },
      { item:'냄새', data:'아민 유사', src:'' }, { item:'냄새역치', data:'', src:'자료없음' },
      { item:'pH', data:'', src:'8 ~ 9' }, { item:'녹는점', data:'-2', src:'-2 ~ 0' },
      { item:'초기끓는점/끓는점 범위', data:'', src:'자료없음' }, { item:'인화점', data:'', src:'자료없음' },
      { item:'증발속도', data:'', src:'자료없음' }, { item:'인화성', data:'해당없음', src:'' },
      { item:'폭발범위', data:'', src:'자료없음' }, { item:'증기압', data:'', src:'' },
      { item:'용해도', data:'', src:'자료없음' }, { item:'비중', data:'', src:'1.01-1.05' },
      { item:'물분배계수', data:'', src:'자료없음' }, { item:'자연발화온도', data:'', src:'자료없음' },
      { item:'분해온도', data:'', src:'자료없음' }, { item:'점도', data:'60', src:'60 이상 K.U' },
      { item:'분자량', data:'', src:'자료없음' },
    ],
    regulations:[
      '화평법 > 기존물질(KECL)','산업안전보건법 > 노출기준설정물질','산업안전보건법 > 관리대상유해물질',
      '산업안전보건법 > 작업환경측정대상유해인자','산업안전보건법 > 특수건강진단대상유해인자','산업안전보건법 > 발암성_노동부고시',
      '위험물안전관리법 > 제4류 인화성액체 > 제3석유류 > 비수용성액체','위험물안전관리법 > 제4류 인화성액체 > 제3석유류 > 수용성액체',
      '폐기물관리법 > 지정폐기물','연구실안전환경조성법 > 건강검진 대상물질','연구실안전환경조성법 > 정밀안전진단 대상물질',
    ],
  },
  '락카페인트스프레이(흑색)': {
    product: { name:'락카페인트스프레이(흑색)', maker:'일신제약', revised:'2020-07-08', cas:'', ke:'', un:'', eu:'', file:'락카 페인트 스프레이 #흑색.pdf', submitNo:'-' },
    ghsClass:['인화성 가스 : 구분 1','인화성 액체 : 구분 2','자기발열성 물질 및 혼합물 : 구분 1','고압가스 : 압축가스','흡인 유해성 : 구분 1','피부 부식성/피부 자극성 : 구분 2','심한 눈 손상성/눈 자극성 : 구분 2','특정표적장기 독성(1회 노출) : 구분 3 (호흡기계 자극)','특정표적장기 독성(1회 노출) : 구분 3 (마취작용)','발암성 : 구분 2','생식독성 : 구분 2','특정표적장기 독성(반복 노출) : 구분 2'],
    pictograms:[
      { code:'GHS02', label:'인화성', en:'Flammable' },{ code:'GHS04', label:'고압가스', en:'High-pressure gas' },
      { code:'GHS07', label:'경고', en:'Alert' },{ code:'GHS08', label:'건강유해성', en:'Health Hazards' },
    ],
    signal:'위험', physGrade:'낮음', healthGrade:'',
    hCodes:['[H220] 극인화성 가스','[H225] 고인화성 액체 및 증기','[H251] 자기발열성: 화재를 일으킬 수 있음','[H280] 고압가스 포함: 가열하면 폭발할 수 있음','[H304] 삼켜서 기도로 유입되면 치명적일 수 있음','[H315] 피부에 자극을 일으킴','[H319] 눈에 심한 자극을 일으킴','[H335] 호흡기계 자극을 일으킬 수 있음','[H336] 졸음 또는 현기증을 일으킬 수 있음','[H351] 암을 일으킬 것으로 의심됨','[H361] 태아 또는 생식능력에 손상을 일으킬 것으로 의심됨','[H373] 장기간 또는 반복노출 되면 신체 중 장기에 손상을 일으킬 수 있음 (11항 독성에 관한 정보 참조)'],
    pStatements:[
      { cat:'예방', items:['[P201] 사용 전 취급 설명서를 확보하시오.','[P202] 모든 안전 예방조치 문구를 읽고 이해하기 전에는 취급하지 마시오.','[P210] 열·스파크·화염·고열로부터 멀리하시오 - 금연','[P233] 용기를 단단히 밀폐하시오.','[P235+P410] 저온으로 유지하고 직사광선을 피하시오.','[P240] 용기와 수용설비를 접합시키거나 접지하시오.','[P241] 폭발 방지용 전기·환기·조명·장비를 사용하시오.','[P242] 스파크가 발생하지 않는 도구만을 사용하시오.','[P243] 정전기 방지 조치를 취하시오.','[P260] (분진·흄·가스·미스트·증기·스프레이)를(을) 흡입하지 마시오.','[P261] (분진·흄·가스·미스트·증기·스프레이)의 흡입을 피하시오.','[P264] 취급 후에는 취급 부위를 철저히 씻으시오.','[P271] 옥외 또는 환기가 잘 되는 곳에서만 취급하시오.','[P280] (보호장갑·보호의·보안경·안면보호구)를(을) 착용하시오.'] },
      { cat:'대응', items:['[P301+P310] 삼켰다면 즉시 의료기관(의사)의 진찰을 받으시오.','[P302+P352] 피부에 묻으면 다량의 비누와 물로 씻으시오.','[P303+P361+P353] 피부(또는 머리카락)에 묻으면 오염된 모든 의복은 벗거나 제거하시오. 피부를 물로 씻으시오/샤워하시오.','[P304+P340] 흡입하면 신선한 공기가 있는 곳으로 옮기고 호흡하기 쉬운 자세로 안정을 취하시오.','[P305+P351+P338] 눈에 묻으면 몇 분간 물로 조심해서 씻으시오. 가능하면 콘택트렌즈를 제거하시오. 계속 씻으시오.','[P308+P313] 노출되거나 노출이 우려되면 의학적인 조치·조언을 구하시오.','[P312] 불편함을 느끼면 의료기관(의사)의 진찰을 받으시오.','[P314] 불편함을 느끼면 의학적인 조치·조언을 구하시오.','[P321] 특별한 처치를 하시오. (4. 응급조치요령을 참조)','[P331] 토하게 하지 마시오.','[P332+P313] 피부 자극이 생기면 의학적인 조치·조언을 구하시오.','[P337+P313] 눈에 자극이 지속되면 의학적인 조치·조언을 구하시오.','[P370+P378] 화재 시 불을 끄기 위해 적절한 소화제를 사용하시오. (5. 폭발·화재시 대처방법을 참조)','[P377] 누출성 가스 화재 시 누출을 안전하게 막을 수 없다면 불을 끄려하지 마시오.','[P381] 안전하게 처리하는 것이 가능하면 모든 점화원을 제거하시오.','[P362+P364] 오염된 의복은 벗고 다시 사용 전 세탁하시오.'] },
      { cat:'저장', items:['[P403] 환기가 잘 되는 곳에 보관하시오.','[P403+P233] 용기는 환기가 잘 되는 곳에 단단히 밀폐하여 저장하시오.','[P403+P235] 환기가 잘 되는 곳에 보관하고 저온으로 유지하시오','[P405] 잠금장치가 있는 저장장소에 저장하시오.','[P407] 적하물 사이에는 간격을 유지하시오.','[P410+P403] 직사광선을 피하고 환기가 잘 되는 곳에 보관하시오.','[P420] 다른 물질과 격리하여 보관하시오.'] },
      { cat:'폐기', items:['[P501] (관련 법규에 명시된 내용에 따라) 내용물과 용기를 폐기하시오'] },
    ],
    nfpa:{ health:'-', fire:'-', react:'-', specific:'-' },
    components:[
      { cas:'1333-86-4', name:'Carbon black; Acetylene black', range:'20', max:'20' },
      { cas:'108-88-3', name:'톨루엔', range:'25', max:'25' },
      { cas:'67-64-1', name:'아세톤', range:'20', max:'20' },
      { cas:'1330-20-7', name:'크실렌', range:'20', max:'20' },
      { cas:'115-10-6', name:'Oxybismethane; Dimethyl ether', range:'10', max:'10' },
      { cas:'74-98-6', name:'Propane', range:'5', max:'5' },
    ],
    physical:[
      { item:'성상', data:'', src:'' },{ item:'색상', data:'', src:'' },{ item:'냄새', data:'', src:'' },
      { item:'냄새역치', data:'', src:'' },{ item:'pH', data:'', src:'' },{ item:'녹는점', data:'', src:'' },
      { item:'초기끓는점/끓는점 범위', data:'', src:'' },{ item:'인화점', data:'', src:'' },{ item:'증발속도', data:'', src:'' },
      { item:'인화성', data:'', src:'' },{ item:'폭발범위', data:'', src:'' },{ item:'증기압', data:'', src:'' },
      { item:'용해도', data:'', src:'' },{ item:'비중', data:'', src:'' },{ item:'물분배계수', data:'', src:'' },
      { item:'자연발화온도', data:'', src:'' },{ item:'분해온도', data:'', src:'' },{ item:'점도', data:'', src:'' },
      { item:'분자량', data:'', src:'' },
    ],
    regulations:[
      '화평법 > 기존물질(KECL)','화평법 > 등록대상기존물질','화관법 > 배출량조사대상물질','산업안전보건법 > 노출기준설정물질',
      '산업안전보건법 > 허용기준설정물질','산업안전보건법 > 관리대상유해물질','산업안전보건법 > 작업환경측정대상유해인자',
      '산업안전보건법 > 특수건강진단대상유해인자','산업안전보건법 > 발암성_노동부고시','위험물안전관리법 > 제4류 인화성액체 > 제1석유류 > 비수용성액체',
      '위험물안전관리법 > 제4류 인화성액체 > 제1석유류 > 수용성액체','위험물안전관리법 > 제4류 인화성액체 > 제2석유류 > 비수용성액체',
      '폐기물관리법 > 지정폐기물','연구실안전환경조성법 > 건강검진 대상물질','연구실안전환경조성법 > 정밀안전진단 대상물질',
      '고압가스안전관리법 > 가연성가스','REACH > REACH 제한대상 물질','화평법 > 중점관리물질',
    ],
  },
  '염산': {
    product: { name:'염산', alias:'', maker:'(주)케미탑', revised:'2017-06-23', cas:'7647-01-0', ke:'', un:'', eu:'', storeClass:'일반보관', storeInfo:'', packing:'4㎏', file:'염산(17.06.23 VER 1).pdf', submitNo:'-' },
    ghsClass:['급성 독성(경구) : 구분 4','피부 부식성/피부 자극성 : 구분 1','심한 눈 손상성/눈 자극성 : 구분 1','급성 독성(흡입: 증기) : 구분 3','호흡기 과민성 : 구분 1','특정표적장기 독성(1회 노출) : 구분 3 (호흡기계 자극)','특정표적장기 독성(1회 노출) : 구분 1','특정표적장기 독성(반복 노출) : 구분 1','급성 수생환경 유해성 : 구분 1'],
    pictograms:[
      { code:'GHS05', label:'부식성', en:'Corrosive' },{ code:'GHS06', label:'급성독성', en:'Acute toxicity' },
      { code:'GHS07', label:'경고', en:'Alert' },{ code:'GHS08', label:'건강유해성', en:'Health Hazards' },
      { code:'GHS09', label:'수생환경유해성', en:'hazards to the aquatic environment' },
    ],
    signal:'위험', physGrade:'낮음', healthGrade:'높음',
    hCodes:['[H302] 삼키면 유해함','[H314] 피부에 심한 화상과 눈에 손상을 일으킴','[H318] 눈에 심한 손상을 일으킴','[H331] 흡입하면 유독함','[H334] 흡입시 알레르기성 반응, 천식 또는 호흡 곤란을 일으킬 수 있음','[H335] 호흡기계 자극을 일으킬 수 있음','[H370] 신체 중 장기에 손상을 일으킴 (11항 독성에 관한 정보 참조)','[H372] 장기간 또는 반복노출 되면 신체 중 장기에 손상을 일으킴 (11항 독성에 관한 정보 참조)','[H400] 수생생물에 매우 유독함'],
    pStatements:[
      { cat:'예방', items:['[P260] (분진·흄·가스·미스트·증기·스프레이)를(을) 흡입하지 마시오.','[P261] (분진·흄·가스·미스트·증기·스프레이)의 흡입을 피하시오.','[P264] 취급 후에는 취급 부위를 철저히 씻으시오.','[P270] 이 제품을 사용할 때에는 먹거나, 마시거나 흡연하지 마시오.','[P271] 옥외 또는 환기가 잘 되는 곳에서만 취급하시오.','[P273] 환경으로 배출하지 마시오.','[P280] (보호장갑·보호의·보안경·안면보호구)를(을) 착용하시오.','[P285] 환기가 잘 되지 않는 곳에서는 호흡기 보호구를 착용하시오.'] },
      { cat:'대응', items:['[P301+P312] 삼켜서 불편함을 느끼면 의료기관(의사)의 진찰을 받으시오.','[P301+P330+P331] 삼켰다면 입을 씻어내시오. 토하게 하려 하지 마시오.','[P303+P361+P353] 피부(또는 머리카락)에 묻으면 오염된 모든 의복은 벗거나 제거하시오. 피부를 물로 씻으시오/샤워하시오.','[P304+P340] 흡입하면 신선한 공기가 있는 곳으로 옮기고 호흡하기 쉬운 자세로 안정을 취하시오.','[P304+P341] 흡입하여 호흡이 어려워지면 신선한 공기가 있는 곳으로 옮기고 호흡하기 쉬운 자세로 안정을 취하시오.','[P305+P351+P338] 눈에 묻으면 몇 분간 물로 조심해서 씻으시오. 가능하면 콘택트렌즈를 제거하시오. 계속 씻으시오.','[P307+P311] 노출되면 의료기관(의사)의 진찰을 받으시오.','[P310] 즉시 의료기관(의사)의 진찰을 받으시오.','[P311] 의료기관(의사)의 진찰을 받으시오.','[P312] 불편함을 느끼면 의료기관(의사)의 진찰을 받으시오.','[P314] 불편함을 느끼면 의학적인 조치·조언을 구하시오.','[P321] 특별한 처치를 하시오. (4. 응급조치요령을 참조)','[P330] 입을 씻어내시오.','[P342+P311] 호흡기 증상이 나타나면 의료기관(의사)의 진찰을 받으시오.','[P363] 다시 사용전 오염된 의복은 세척하시오.','[P391] 누출물을 모으시오.'] },
      { cat:'저장', items:['[P403+P233] 용기는 환기가 잘 되는 곳에 단단히 밀폐하여 저장하시오.','[P405] 잠금장치가 있는 저장장소에 저장하시오.'] },
      { cat:'폐기', items:['[P501] (관련 법규에 명시된 내용에 따라) 내용물과 용기를 폐기하시오'] },
    ],
    nfpa:{ health:'3 - 극도로 위험', fire:'0 - 타지 않음', react:'1 - 가열 시 불안정', specific:'-' },
    components:[
      { cas:'7647-01-0', name:'염산', range:'35~40', max:'40', avg:'37.5' },
      { cas:'7732-18-5', name:'Water', range:'60~65', max:'65', avg:'62.5' },
    ],
    physical:[
      { item:'성상', data:'액체', src:'' },{ item:'색상', data:'', src:'' },{ item:'냄새', data:'', src:'' },
      { item:'냄새역치', data:'', src:'' },{ item:'pH', data:'1.1', src:'(0.1 N 용액)' },{ item:'녹는점', data:'', src:'' },
      { item:'초기끓는점/끓는점 범위', data:'65.6 ℃', src:'' },{ item:'인화점', data:'자료 없음', src:'' },{ item:'증발속도', data:'', src:'' },
      { item:'인화성', data:'', src:'' },{ item:'폭발범위', data:'', src:'' },{ item:'증기압', data:'', src:'' },
      { item:'용해도', data:'', src:'' },{ item:'비중', data:'1.178', src:'' },{ item:'물분배계수', data:'', src:'' },
      { item:'자연발화온도', data:'', src:'' },{ item:'분해온도', data:'', src:'' },{ item:'점도', data:'', src:'' },{ item:'분자량', data:'', src:'' },
    ],
    regulations:[
      '화평법 > 기존물질(KECL)','화평법 > 유독물질','화평법 > 등록대상기존물질','화관법 > 사고대비물질','화관법 > 배출량조사대상물질',
      '산업안전보건법 > 노출기준설정물질','산업안전보건법 > 관리대상유해물질','산업안전보건법 > 작업환경측정대상유해인자','산업안전보건법 > 특수건강진단대상유해인자',
      '폐기물관리법 > 지정폐기물','연구실안전환경조성법 > 건강검진 대상물질','연구실안전환경조성법 > 정밀안전진단 대상물질','고압가스안전관리법 > 독성가스','산업안전보건법 > 도급승인물질',
    ],
  },
  '에틸 알코올': {
    product: { name:'에틸 알코올', alias:'Ethanol Alcohol', maker:'OCI 머트리얼즈', revised:'2019-04-01', cas:'64-17-5', ke:'', un:'', eu:'', storeClass:'일반보관', storeInfo:'', packing:'18ℓ', file:'Ethyl alcohol_anhy_[2].pdf', submitNo:'-' },
    ghsClass:['인화성 액체 : 구분 2','심한 눈 손상성/눈 자극성 : 구분 2','특정표적장기 독성(1회 노출) : 구분 3 (호흡기계 자극)','특정표적장기 독성(1회 노출) : 구분 3 (마취작용)','발암성 : 구분 1A','특정표적장기 독성(반복 노출) : 구분 1'],
    pictograms:[
      { code:'GHS02', label:'인화성', en:'Flammable' },{ code:'GHS07', label:'경고', en:'Alert' },
      { code:'GHS08', label:'건강유해성', en:'Health Hazards' },
    ],
    signal:'위험', physGrade:'낮음', healthGrade:'매우높음',
    hCodes:['[H225] 고인화성 액체 및 증기','[H319] 눈에 심한 자극을 일으킴','[H335] 호흡기계 자극을 일으킬 수 있음','[H336] 졸음 또는 현기증을 일으킬 수 있음','[H350] 암을 일으킬 수 있음','[H372] 장기간 또는 반복노출 되면 신체 중 장기에 손상을 일으킴 (11항 독성에 관한 정보 참조)'],
    pStatements:[
      { cat:'예방', items:['[P201] 사용 전 취급 설명서를 확보하시오.','[P202] 모든 안전 예방조치 문구를 읽고 이해하기 전에는 취급하지 마시오.','[P210] 열·스파크·화염·고열로부터 멀리하시오 - 금연','[P233] 용기를 단단히 밀폐하시오.','[P240] 용기와 수용설비를 접합시키거나 접지하시오.','[P241] 폭발 방지용 전기·환기·조명·장비를 사용하시오.','[P242] 스파크가 발생하지 않는 도구만을 사용하시오.','[P243] 정전기 방지 조치를 취하시오.','[P260] (분진·흄·가스·미스트·증기·스프레이)를(을) 흡입하지 마시오.','[P261] (분진·흄·가스·미스트·증기·스프레이)의 흡입을 피하시오.','[P264] 취급 후에는 취급 부위를 철저히 씻으시오.','[P270] 이 제품을 사용할 때에는 먹거나, 마시거나 흡연하지 마시오.','[P271] 옥외 또는 환기가 잘 되는 곳에서만 취급하시오.','[P280] (보호장갑·보호의·보안경·안면보호구)를(을) 착용하시오.','[P281] 적절한 개인 보호구를 착용하시오.'] },
      { cat:'대응', items:['[P303+P361+P353] 피부(또는 머리카락)에 묻으면 오염된 모든 의복은 벗거나 제거하시오. 피부를 물로 씻으시오/샤워하시오.','[P304+P340] 흡입하면 신선한 공기가 있는 곳으로 옮기고 호흡하기 쉬운 자세로 안정을 취하시오.','[P305+P351+P338] 눈에 묻으면 몇 분간 물로 조심해서 씻으시오. 가능하면 콘택트렌즈를 제거하시오. 계속 씻으시오.','[P308+P313] 노출되거나 노출이 우려되면 의학적인 조치·조언을 구하시오.','[P312] 불편함을 느끼면 의료기관(의사)의 진찰을 받으시오.','[P314] 불편함을 느끼면 의학적인 조치·조언을 구하시오.','[P337+P313] 눈에 자극이 지속되면 의학적인 조치·조언을 구하시오.','[P370+P378] 화재 시 불을 끄기 위해 적절한 소화제를 사용하시오. (5. 폭발·화재시 대처방법을 참조)'] },
      { cat:'저장', items:['[P403+P235] 환기가 잘 되는 곳에 보관하고 저온으로 유지하시오','[P405] 잠금장치가 있는 저장장소에 저장하시오.'] },
      { cat:'폐기', items:['[P501] (관련 법규에 명시된 내용에 따라) 내용물과 용기를 폐기하시오'] },
    ],
    nfpa:{ health:'-', fire:'-', react:'-', specific:'-' },
    components:[
      { cas:'64-17-5', name:'에탄올', range:'99.9', max:'99.9', avg:'99.9' },
      { cas:'7732-18-5', name:'Water', range:'0.01', max:'0.01', avg:'0.01' },
    ],
    physical:[
      { item:'성상', data:'액체', src:'' },{ item:'색상', data:'', src:'' },{ item:'냄새', data:'', src:'' },
      { item:'냄새역치', data:'', src:'' },{ item:'pH', data:'자료 없음', src:'' },{ item:'녹는점', data:'', src:'' },
      { item:'초기끓는점/끓는점 범위', data:'78.5 ℃', src:'' },{ item:'인화점', data:'13 ℃', src:'(c.c.)' },{ item:'증발속도', data:'', src:'' },
      { item:'인화성', data:'', src:'' },{ item:'폭발범위', data:'', src:'' },{ item:'증기압', data:'', src:'' },
      { item:'용해도', data:'', src:'' },{ item:'비중', data:'0.8', src:'(물=1)' },{ item:'물분배계수', data:'', src:'' },
      { item:'자연발화온도', data:'', src:'' },{ item:'분해온도', data:'', src:'' },{ item:'점도', data:'', src:'' },{ item:'분자량', data:'', src:'' },
    ],
    regulations:[
      '화평법 > 기존물질(KECL)','산업안전보건법 > 노출기준설정물질','산업안전보건법 > 발암성_노동부고시',
      '위험물안전관리법 > 제4류 인화성액체 > 알코올류','폐기물관리법 > 지정폐기물','연구실안전환경조성법 > 정밀안전진단 대상물질',
    ],
  },
  '황산': {
    product: { name:'황산', alias:'', maker:'(주)케미탑', revised:'2016-07-17', cas:'7664-93-9', ke:'', un:'', eu:'', storeClass:'일반보관', storeInfo:'', packing:'7㎏', file:'황산 MSDS (16.02.21 ver 2).pdf', submitNo:'-' },
    ghsClass:['피부 부식성/피부 자극성 : 구분 1','심한 눈 손상성/눈 자극성 : 구분 1','급성 독성(흡입: 분진/미스트) : 구분 2','발암성 : 구분 1','특정표적장기 독성(1회 노출) : 구분 1','특정표적장기 독성(반복 노출) : 구분 1','만성 수생환경 유해성 : 구분 3'],
    pictograms:[
      { code:'GHS05', label:'부식성', en:'Corrosive' },{ code:'GHS06', label:'급성독성', en:'Acute toxicity' },
      { code:'GHS08', label:'건강유해성', en:'Health Hazards' },
    ],
    signal:'위험', physGrade:'낮음', healthGrade:'매우높음',
    hCodes:['[H314] 피부에 심한 화상과 눈에 손상을 일으킴','[H318] 눈에 심한 손상을 일으킴','[H330] 흡입하면 치명적임','[H350] 암을 일으킬 수 있음','[H370] 신체 중 장기에 손상을 일으킴 (11항 독성에 관한 정보 참조)','[H372] 장기간 또는 반복노출 되면 신체 중 장기에 손상을 일으킴 (11항 독성에 관한 정보 참조)','[H412] 장기적인 영향에 의해 수생생물에게 유해함'],
    pStatements:[
      { cat:'예방', items:['[P201] 사용 전 취급 설명서를 확보하시오.','[P202] 모든 안전 예방조치 문구를 읽고 이해하기 전에는 취급하지 마시오.','[P260] (분진·흄·가스·미스트·증기·스프레이)를(을) 흡입하지 마시오.','[P264] 취급 후에는 취급 부위를 철저히 씻으시오.','[P270] 이 제품을 사용할 때에는 먹거나, 마시거나 흡연하지 마시오.','[P271] 옥외 또는 환기가 잘 되는 곳에서만 취급하시오.','[P273] 환경으로 배출하지 마시오.','[P280] (보호장갑·보호의·보안경·안면보호구)를(을) 착용하시오.','[P281] 적절한 개인 보호구를 착용하시오.','[P284] 호흡기 보호구를 착용하시오.'] },
      { cat:'대응', items:['[P301+P330+P331] 삼켰다면 입을 씻어내시오. 토하게 하려 하지 마시오.','[P303+P361+P353] 피부(또는 머리카락)에 묻으면 오염된 모든 의복은 벗거나 제거하시오. 피부를 물로 씻으시오/샤워하시오.','[P304+P340] 흡입하면 신선한 공기가 있는 곳으로 옮기고 호흡하기 쉬운 자세로 안정을 취하시오.','[P305+P351+P338] 눈에 묻으면 몇 분간 물로 조심해서 씻으시오. 가능하면 콘택트렌즈를 제거하시오. 계속 씻으시오.','[P307+P311] 노출되면 의료기관(의사)의 진찰을 받으시오.','[P308+P313] 노출되거나 노출이 우려되면 의학적인 조치·조언을 구하시오.','[P310] 즉시 의료기관(의사)의 진찰을 받으시오.','[P314] 불편함을 느끼면 의학적인 조치·조언을 구하시오.','[P320] 긴급히 적절한 처치를 하시오.','[P321] 특별한 처치를 하시오. (4. 응급조치요령을 참조)','[P363] 다시 사용전 오염된 의복은 세척하시오.'] },
      { cat:'저장', items:['[P403+P233] 용기는 환기가 잘 되는 곳에 단단히 밀폐하여 저장하시오.','[P405] 잠금장치가 있는 저장장소에 저장하시오.'] },
      { cat:'폐기', items:['[P501] (관련 법규에 명시된 내용에 따라) 내용물과 용기를 폐기하시오'] },
    ],
    nfpa:{ health:'3 - 극도로 위험', fire:'0 - 타지 않음', react:'2 - 격렬한 화학 변화', specific:'-' },
    components:[
      { cas:'7664-93-9', name:'황산', range:'95-99', max:'99', avg:'97' },
      { cas:'7732-18-5', name:'Water', range:'1-5', max:'5', avg:'3' },
    ],
    physical:[
      { item:'성상', data:'액체', src:'' },{ item:'색상', data:'', src:'' },{ item:'냄새', data:'', src:'' },
      { item:'냄새역치', data:'', src:'' },{ item:'pH', data:'1', src:'<1' },{ item:'녹는점', data:'', src:'' },
      { item:'초기끓는점/끓는점 범위', data:'자료 없음', src:'' },{ item:'인화점', data:'자료 없음', src:'' },{ item:'증발속도', data:'', src:'' },
      { item:'인화성', data:'', src:'' },{ item:'폭발범위', data:'', src:'' },{ item:'증기압', data:'', src:'' },
      { item:'용해도', data:'', src:'' },{ item:'비중', data:'자료없음', src:'' },{ item:'물분배계수', data:'', src:'' },
      { item:'자연발화온도', data:'', src:'' },{ item:'분해온도', data:'', src:'' },{ item:'점도', data:'', src:'' },{ item:'분자량', data:'', src:'' },
    ],
    regulations:[
      '화평법 > 기존물질(KECL)','화평법 > 유독물질','화평법 > 등록대상기존물질','화관법 > 사고대비물질','화관법 > 배출량조사대상물질',
      '산업안전보건법 > 노출기준설정물질','산업안전보건법 > 허용기준설정물질','산업안전보건법 > 관리대상유해물질','산업안전보건법 > 작업환경측정대상유해인자',
      '산업안전보건법 > 특수건강진단대상유해인자','산업안전보건법 > 발암성_노동부고시','산업안전보건법 > 특별관리물질','폐기물관리법 > 지정폐기물',
      '연구실안전환경조성법 > 건강검진 대상물질','연구실안전환경조성법 > 정밀안전진단 대상물질','화평법 > 중점관리물질','산업안전보건법 > 도급승인물질',
    ],
  },
  '0.01N 염산용액': {
    product: { name:'0.01N 염산용액 (0.01mol Hydrochloric acid standard solution(0.01N))', alias:'', maker:'대정화금(주) [DAEJUNG CHEMICALS & METALS]', revised:'2026-06-25', cas:'', ke:'', un:'', eu:'', storeClass:'', storeInfo:'', packing:'', file:'0.01mol Hydrochloric acid standard solution(0.01N)_1.pdf', submitNo:'AA00948-0000000534' },
    ghsClass:['피부 부식성/피부 자극성 : 구분 1'],
    pictograms:[{ code:'GHS05', label:'부식성', en:'Corrosive' }],
    signal:'위험', physGrade:'낮음', healthGrade:'약간높음',
    hCodes:['[H314] 피부에 심한 화상과 눈에 손상을 일으킴'],
    pStatements:[
      { cat:'예방', items:['[P260] (분진·흄·가스·미스트·증기·스프레이)를(을) 흡입하지 마시오.','[P264] 취급 후에는 취급 부위를 철저히 씻으시오.','[P280] (보호장갑·보호의·보안경·안면보호구)를(을) 착용하시오.'] },
      { cat:'대응', items:['[P301+P330+P331] 삼켰다면 입을 씻어내시오. 토하게 하려 하지 마시오.','[P303+P361+P353] 피부(또는 머리카락)에 묻으면 오염된 모든 의복은 벗거나 제거하시오. 피부를 물로 씻으시오/샤워하시오.','[P304+P340] 흡입하면 신선한 공기가 있는 곳으로 옮기고 호흡하기 쉬운 자세로 안정을 취하시오.','[P305+P351+P338] 눈에 묻으면 몇 분간 물로 조심해서 씻으시오. 가능하면 콘택트렌즈를 제거하시오. 계속 씻으시오.','[P310] 즉시 의료기관(의사)의 진찰을 받으시오.','[P321] 특별한 처치를 하시오. (4. 응급조치요령을 참조)','[P363] 다시 사용전 오염된 의복은 세척하시오.'] },
      { cat:'저장', items:['[P405] 잠금장치가 있는 저장장소에 저장하시오.'] },
      { cat:'폐기', items:['[P501] (관련 법규에 명시된 내용에 따라) 내용물과 용기를 폐기하시오'] },
    ],
    nfpa:{ health:'-', fire:'-', react:'-', specific:'-' },
    components:[
      { cas:'7647-01-0', name:'염산', range:'0.01~0.1%', max:'0' },
      { cas:'7732-18-5', name:'Water', range:'99.9~99.99%', max:'0' },
    ],
    physical:[
      { item:'성상', data:'액체', src:'' },{ item:'색상', data:'무색', src:'' },{ item:'냄새', data:'자극적인 냄새', src:'' },
      { item:'냄새역치', data:'자료없음', src:'' },{ item:'pH', data:'2', src:'' },{ item:'녹는점', data:'자료없음', src:'' },
      { item:'초기끓는점/끓는점 범위', data:'자료 없음', src:'' },{ item:'인화점', data:'자료 없음', src:'' },{ item:'증발속도', data:'자료없음', src:'' },
      { item:'인화성', data:'해당없음', src:'' },{ item:'폭발범위', data:'', src:'해당없음' },{ item:'증기압', data:'자료없음', src:'' },
      { item:'용해도', data:'물에 혼합됨', src:'' },{ item:'비중', data:'1.0', src:'' },{ item:'물분배계수', data:'자료없음', src:'' },
      { item:'자연발화온도', data:'해당없음', src:'' },{ item:'분해온도', data:'자료없음', src:'' },{ item:'점도', data:'자료없음', src:'' },{ item:'분자량', data:'자료없음', src:'' },
    ],
    regulations:[
      '화평법 > 기존물질(KECL)','화평법 > 등록대상기존물질','산업안전보건법 > 노출기준설정물질','폐기물관리법 > 지정폐기물',
      '연구실안전환경조성법 > 정밀안전진단 대상물질','고압가스안전관리법 > 독성가스',
    ],
  },
  'SC-333': {
    product: { name:'SC-333', alias:'', maker:'(주)세흥상사', revised:'2019-01-25', cas:'', ke:'', un:'1133', eu:'', storeClass:'', storeInfo:'', packing:'', file:'28.SC-333.pdf', submitNo:'-' },
    ghsClass:['인화성 액체 : 구분 2','흡인 유해성 : 구분 1','심한 눈 손상성/눈 자극성 : 구분 2','특정표적장기 독성(1회 노출) : 구분 3 (마취작용)','만성 수생환경 유해성 : 구분 3'],
    pictograms:[
      { code:'GHS02', label:'인화성', en:'Flammable' },{ code:'GHS07', label:'경고', en:'Alert' },{ code:'GHS08', label:'건강유해성', en:'Health Hazards' },
    ],
    signal:'위험', physGrade:'낮음', healthGrade:'',
    hCodes:['[H225] 고인화성 액체 및 증기','[H304] 삼켜서 기도로 유입되면 치명적일 수 있음','[H319] 눈에 심한 자극을 일으킴','[H336] 졸음 또는 현기증을 일으킬 수 있음','[H412] 장기적인 영향에 의해 수생생물에게 유해함'],
    pStatements:[
      { cat:'예방', items:['[P210] 열·스파크·화염·고열로부터 멀리하시오 - 금연','[P233] 용기를 단단히 밀폐하시오.','[P240] 용기와 수용설비를 접합시키거나 접지하시오.','[P243] 정전기 방지 조치를 취하시오.','[P261] (분진·흄·가스·미스트·증기·스프레이)의 흡입을 피하시오.','[P264] 취급 후에는 취급 부위를 철저히 씻으시오.','[P271] 옥외 또는 환기가 잘 되는 곳에서만 취급하시오.','[P280] (보호장갑·보호의·보안경·안면보호구)를(을) 착용하시오.'] },
      { cat:'대응', items:['[P301+P310] 삼켰다면 즉시 의료기관(의사)의 진찰을 받으시오.','[P303+P361+P353] 피부(또는 머리카락)에 묻으면 오염된 모든 의복은 벗거나 제거하시오. 피부를 물로 씻으시오/샤워하시오.','[P304+P340] 흡입하면 신선한 공기가 있는 곳으로 옮기고 호흡하기 쉬운 자세로 안정을 취하시오.','[P305+P351+P338] 눈에 묻으면 몇 분간 물로 조심해서 씻으시오. 가능하면 콘택트렌즈를 제거하시오. 계속 씻으시오.','[P314] 불편함을 느끼면 의학적인 조치·조언을 구하시오.','[P331] 토하게 하지 마시오.','[P391] 누출물을 모으시오.'] },
      { cat:'저장', items:['[P403+P233] 용기는 환기가 잘 되는 곳에 단단히 밀폐하여 저장하시오.','[P403+P235] 환기가 잘 되는 곳에 보관하고 저온으로 유지하시오','[P405] 잠금장치가 있는 저장장소에 저장하시오.'] },
      { cat:'폐기', items:['[P501] (관련 법규에 명시된 내용에 따라) 내용물과 용기를 폐기하시오'] },
    ],
    nfpa:{ health:'2 - 위험', fire:'3 - 상온에서 점화', react:'0 - 안정', specific:'-' },
    components:[
      { cas:'67-64-1', name:'아세톤', range:'below 45', max:'45' },
      { cas:'141-78-6', name:'아세트산 에틸', range:'below 20', max:'20' },
      { cas:'8032-32-4', name:'Ligroine; Petrodeum ether', range:'below 45', max:'45' },
    ],
    physical:[
      { item:'성상', data:'', src:'' },{ item:'색상', data:'무색', src:'' },{ item:'냄새', data:'휘발유 및 독특한 냄새', src:'' },
      { item:'냄새역치', data:'', src:'자료없음' },{ item:'pH', data:'', src:'자료없음' },{ item:'녹는점', data:'', src:'자료없음' },
      { item:'초기끓는점/끓는점 범위', data:'72°C', src:'' },{ item:'인화점', data:'-17°C', src:'' },{ item:'증발속도', data:'', src:'자료없음' },
      { item:'인화성', data:'고인화성', src:'' },{ item:'폭발범위', data:'', src:'' },{ item:'증기압', data:'', src:'' },
      { item:'용해도', data:'', src:'자료없음' },{ item:'비중', data:'0.76', src:'0.76~0.85' },{ item:'물분배계수', data:'', src:'자료없음' },
      { item:'자연발화온도', data:'', src:'자료없음' },{ item:'분해온도', data:'', src:'자료없음' },{ item:'점도', data:'10', src:'10mPa.s 이하' },{ item:'분자량', data:'', src:'혼합물로 자료없음' },
    ],
    regulations:[
      '화평법 > 기존물질(KECL)','화평법 > 등록대상기존물질','화관법 > 배출량조사대상물질','산업안전보건법 > 노출기준설정물질',
      '산업안전보건법 > 관리대상유해물질','산업안전보건법 > 작업환경측정대상유해인자','산업안전보건법 > 특수건강진단대상유해인자','산업안전보건법 > 발암성_노동부고시',
      '위험물안전관리법 > 제4류 인화성액체 > 제1석유류 > 비수용성액체','위험물안전관리법 > 제4류 인화성액체 > 제1석유류 > 수용성액체',
      '폐기물관리법 > 지정폐기물','연구실안전환경조성법 > 건강검진 대상물질','연구실안전환경조성법 > 정밀안전진단 대상물질',
    ],
  },
  '에포코트라이닝 투명 동절기용<B부>': {
    product: { name:'에포코트라이닝 투명 동절기용<B부>', alias:'', maker:'삼화페인트 [Samhwa Paints Industrial CO. LTD]', revised:'2022-08-17', cas:'', ke:'', un:'', eu:'', storeClass:'', storeInfo:'', packing:'', file:'30.에포코트라이닝 투명 동절기용(B부).PDF', submitNo:'-' },
    ghsClass:['특정표적장기 독성(1회 노출) : 구분 3 (마취작용)','급성 독성(경구) : 구분 4','심한 눈 손상성/눈 자극성 : 구분 1','발암성 : 구분 1B','호흡기 과민성 : 구분 1','급성 독성(경피) : 구분 4','피부 부식성/피부 자극성 : 구분 1'],
    pictograms:[
      { code:'GHS05', label:'부식성', en:'Corrosive' },{ code:'GHS07', label:'경고', en:'Alert' },{ code:'GHS08', label:'건강유해성', en:'Health Hazards' },
    ],
    signal:'위험', physGrade:'낮음', healthGrade:'',
    hCodes:['[H336] 졸음 또는 현기증을 일으킬 수 있음','[H302] 삼키면 유해함','[H318] 눈에 심한 손상을 일으킴','[H350] 암을 일으킬 수 있음','[H334] 흡입시 알레르기성 반응, 천식 또는 호흡 곤란을 일으킬 수 있음','[H312] 피부와 접촉하면 유해함','[H314] 피부에 심한 화상과 눈에 손상을 일으킴'],
    pStatements:[
      { cat:'예방', items:['[P201] 사용 전 취급 설명서를 확보하시오.','[P202] 모든 안전 예방조치 문구를 읽고 이해하기 전에는 취급하지 마시오.','[P260] (분진·흄·가스·미스트·증기·스프레이)를(을) 흡입하지 마시오.','[P261] (분진·흄·가스·미스트·증기·스프레이)의 흡입을 피하시오.','[P264] 취급 후에는 취급 부위를 철저히 씻으시오.','[P270] 이 제품을 사용할 때에는 먹거나, 마시거나 흡연하지 마시오.','[P271] 옥외 또는 환기가 잘 되는 곳에서만 취급하시오.','[P280] (보호장갑·보호의·보안경·안면보호구)를(을) 착용하시오.','[P285] 환기가 잘 되지 않는 곳에서는 호흡기 보호구를 착용하시오.'] },
      { cat:'대응', items:['[P301+P312] 삼켜서 불편함을 느끼면 의료기관(의사)의 진찰을 받으시오.','[P301+P330+P331] 삼켰다면 입을 씻어내시오. 토하게 하려 하지 마시오.','[P302+P352] 피부에 묻으면 다량의 비누와 물로 씻으시오.','[P303+P361+P353] 피부(또는 머리카락)에 묻으면 오염된 모든 의복은 벗거나 제거하시오. 피부를 물로 씻으시오/샤워하시오.','[P304+P340] 흡입하면 신선한 공기가 있는 곳으로 옮기고 호흡하기 쉬운 자세로 안정을 취하시오.','[P305+P351+P338] 눈에 묻으면 몇 분간 물로 조심해서 씻으시오. 가능하면 콘택트렌즈를 제거하시오. 계속 씻으시오.','[P308+P313] 노출되거나 노출이 우려되면 의학적인 조치·조언을 구하시오.','[P310] 즉시 의료기관(의사)의 진찰을 받으시오.','[P312] 불편함을 느끼면 의료기관(의사)의 진찰을 받으시오.','[P330] 입을 씻어내시오.','[P342+P311] 호흡기 증상이 나타나면 의료기관(의사)의 진찰을 받으시오.','[P362] 오염된 의복은 벗고 다시 사용 전 세탁하시오.','[P363] 다시 사용전 오염된 의복은 세척하시오.'] },
      { cat:'저장', items:['[P403+P233] 용기는 환기가 잘 되는 곳에 단단히 밀폐하여 저장하시오.','[P405] 잠금장치가 있는 저장장소에 저장하시오.'] },
      { cat:'폐기', items:['[P501] (관련 법규에 명시된 내용에 따라) 내용물과 용기를 폐기하시오'] },
    ],
    nfpa:{ health:'2 - 위험', fire:'1 - 예열 필요', react:'1 - 가열 시 불안정', specific:'-' },
    components:[
      { cas:'9046-10-0', name:'α-(2-Aminomethylethyl)-ω-(2-aminomethylethoxy)poly[oxy(methyl-1,2-ethanediyl)]', range:'61 이상 ~ 70 % 미만', max:'70' },
      { cas:'90-72-2', name:'2,4,6-Tris[(dimethylamino)methyl]phenol', range:'1 이상 ~ 10 % 미만', max:'10' },
      { cas:'57214-10-5', name:'포름알데히드 1,3-벤젠디메탄아민과 페놀의 중합체', range:'1 이상 ~ 5 % 미만', max:'5' },
      { cas:'2855-13-2', name:'3-Aminomethyl-3,5,5-trimethylcyclohexylamine; Isophorone diamine', range:'1 이상 ~ 10 % 미만', max:'10' },
      { cas:'27193-86-8', name:'도데실페놀', range:'1 이상 ~ 10 % 미만', max:'10' },
      { cas:'1477-55-0', name:'1,3-비스(아미노메틸)벤젠', range:'1 이상 ~ 10 % 미만', max:'10' },
      { cas:'108-95-2', name:'페놀', range:'1 이상 ~ 5 % 미만', max:'5' },
      { cas:'100-51-6', name:'벤질알코올', range:'1 이상 ~ 10 % 미만', max:'10' },
    ],
    physical:[
      { item:'성상', data:'액체', src:'무색 투명 액체' },{ item:'색상', data:'무색', src:'투명' },{ item:'냄새', data:'순한 암모니아 냄새', src:'' },
      { item:'냄새역치', data:'', src:'자료없음' },{ item:'pH', data:'', src:'자료없음' },{ item:'녹는점', data:'', src:'자료없음' },
      { item:'초기끓는점/끓는점 범위', data:'', src:'자료없음' },{ item:'인화점', data:'', src:'자료없음' },{ item:'증발속도', data:'', src:'자료없음' },
      { item:'인화성', data:'', src:'' },{ item:'폭발범위', data:'', src:'' },{ item:'증기압', data:'', src:'' },
      { item:'용해도', data:'불용성', src:'(물)불용성' },{ item:'비중', data:'0.98', src:'' },{ item:'물분배계수', data:'', src:'자료없음' },
      { item:'자연발화온도', data:'', src:'자료없음' },{ item:'분해온도', data:'', src:'자료없음' },{ item:'점도', data:'', src:'16.5sec' },{ item:'분자량', data:'', src:'자료없음' },
    ],
    regulations:[
      '화평법 > 기존물질(KECL)','화평법 > 유독물질','화평법 > 등록대상기존물질','화관법 > 사고대비물질','화관법 > 배출량조사대상물질',
      '산업안전보건법 > 노출기준설정물질','산업안전보건법 > 관리대상유해물질','산업안전보건법 > 작업환경측정대상유해인자','산업안전보건법 > 특수건강진단대상유해인자',
      '산업안전보건법 > 특별관리물질','위험물안전관리법 > 제4류 인화성액체 > 제3석유류 > 비수용성액체','위험물안전관리법 > 제4류 인화성액체 > 제3석유류 > 수용성액체',
      '폐기물관리법 > 지정폐기물','연구실안전환경조성법 > 건강검진 대상물질','연구실안전환경조성법 > 정밀안전진단 대상물질',
    ],
  },
  'BLACSEN BS-1': {
    product: { name:'BLACSEN BS-1 (블락센 비에스-1)', alias:'', maker:'NAMBANG CNA CO., LTD. [NABAKEM / 남방CNA주식회사 / 나바켐]', revised:'2023-02-14', cas:'', ke:'', un:'UN1950', eu:'', storeClass:'', storeInfo:'', packing:'', file:'BLACSEN+BS-1(11)+(GHS).pdf', submitNo:'-' },
    ghsClass:['인화성 가스 : 구분 1','인화성 에어로졸 : 구분 1','인화성 액체 : 구분 2','인화성 에어로졸 : 구분 3','고압가스 : 액화가스','흡인 유해성 : 구분 2','피부 부식성/피부 자극성 : 구분 2','심한 눈 손상성/눈 자극성 : 구분 2','특정표적장기 독성(1회 노출) : 구분 3 (마취작용)','생식독성 : 구분 2'],
    pictograms:[
      { code:'GHS02', label:'인화성', en:'Flammable' },{ code:'GHS04', label:'고압가스', en:'High-pressure gas' },
      { code:'GHS07', label:'경고', en:'Alert' },{ code:'GHS08', label:'건강유해성', en:'Health Hazards' },
    ],
    signal:'위험', physGrade:'낮음', healthGrade:'',
    hCodes:['[H220] 극인화성 가스','[H222] 극인화성 에어로졸','[H225] 고인화성 액체 및 증기','[H229] 압력용기: 가열시 폭발할 수 있음','[H280] 고압가스 포함: 가열하면 폭발할 수 있음','[H305] 삼켜서 기도로 유입되면 유해할 수 있음','[H315] 피부에 자극을 일으킴','[H319] 눈에 심한 자극을 일으킴','[H336] 졸음 또는 현기증을 일으킬 수 있음','[H361] 태아 또는 생식능력에 손상을 일으킬 것으로 의심됨'],
    pStatements:[
      { cat:'예방', items:['[P201] 사용 전 취급 설명서를 확보하시오.','[P202] 모든 안전 예방조치 문구를 읽고 이해하기 전에는 취급하지 마시오.','[P210] 열·스파크·화염·고열로부터 멀리하시오 - 금연','[P211] 화기 또는 다른 점화원에 분사하지 마시오.','[P233] 용기를 단단히 밀폐하시오.','[P240] 용기와 수용설비를 접합시키거나 접지하시오.','[P241] 폭발 방지용 전기·환기·조명·장비를 사용하시오.','[P242] 스파크가 발생하지 않는 도구만을 사용하시오.','[P243] 정전기 방지 조치를 취하시오.','[P251] 압력용기: 사용 후에도 구멍을 뚫거나 태우지 마시오.','[P261] (분진·흄·가스·미스트·증기·스프레이)의 흡입을 피하시오.','[P264] 취급 후에는 취급 부위를 철저히 씻으시오.','[P271] 옥외 또는 환기가 잘 되는 곳에서만 취급하시오.','[P280] (보호장갑·보호의·보안경·안면보호구)를(을) 착용하시오.'] },
      { cat:'대응', items:['[P301+P310] 삼켰다면 즉시 의료기관(의사)의 진찰을 받으시오.','[P302+P352] 피부에 묻으면 다량의 비누와 물로 씻으시오.','[P303+P361+P353] 피부(또는 머리카락)에 묻으면 오염된 모든 의복은 벗거나 제거하시오. 피부를 물로 씻으시오/샤워하시오.','[P304+P340] 흡입하면 신선한 공기가 있는 곳으로 옮기고 호흡하기 쉬운 자세로 안정을 취하시오.','[P305+P351+P338] 눈에 묻으면 몇 분간 물로 조심해서 씻으시오. 가능하면 콘택트렌즈를 제거하시오. 계속 씻으시오.','[P308+P313] 노출되거나 노출이 우려되면 의학적인 조치·조언을 구하시오.','[P312] 불편함을 느끼면 의료기관(의사)의 진찰을 받으시오.','[P321] 특별한 처치를 하시오. (4. 응급조치요령을 참조)','[P331] 토하게 하지 마시오.','[P332+P313] 피부 자극이 생기면 의학적인 조치·조언을 구하시오.','[P337+P313] 눈에 자극이 지속되면 의학적인 조치·조언을 구하시오.','[P370+P378] 화재 시 불을 끄기 위해 적절한 소화제를 사용하시오. (5. 폭발·화재시 대처방법을 참조)','[P377] 누출성 가스 화재 시 누출을 안전하게 막을 수 없다면 불을 끄려하지 마시오.','[P381] 안전하게 처리하는 것이 가능하면 모든 점화원을 제거하시오.','[P362+P364] 오염된 의복은 벗고 다시 사용 전 세탁하시오.'] },
      { cat:'저장', items:['[P403+P233] 용기는 환기가 잘 되는 곳에 단단히 밀폐하여 저장하시오.','[P403+P235] 환기가 잘 되는 곳에 보관하고 저온으로 유지하시오','[P405] 잠금장치가 있는 저장장소에 저장하시오.','[P410+P403] 직사광선을 피하고 환기가 잘 되는 곳에 보관하시오.','[P410+P412] 직사광선을 피하고 50℃ 이상의 온도에 노출시키지 마시오.'] },
      { cat:'폐기', items:['[P501] (관련 법규에 명시된 내용에 따라) 내용물과 용기를 폐기하시오'] },
    ],
    nfpa:{ health:'-', fire:'-', react:'-', specific:'-' },
    components:[
      { cas:'156-60-5', name:'트랜스-1,2-다이클로로에틸렌', range:'20~30%', max:'30', avg:'25' },
      { cas:'7782-42-5', name:'Graphite', range:'1~5%', max:'5', avg:'3' },
      { cas:'1317-33-5', name:'Molybdenum sulfide', range:'1~5%', max:'5', avg:'3' },
      { cas:'96278-69-2', name:'Siloxanes and silicones, di-Me, di-Ph polymers with adipic acids, isophthalic acid, Ph silsesquioxanes, trimethylolethane and trimethylolpropane', range:'10~20%', max:'20', avg:'15' },
      { cas:'108-65-6', name:'프로필렌 글리콜 메틸 에테르 아세테이트', range:'1~5%', max:'5', avg:'3' },
      { cas:'67-64-1', name:'아세톤', range:'10~20%', max:'20', avg:'15' },
      { cas:'115-10-6', name:'Oxybismethane; Dimethyl ether', range:'40~50%', max:'50', avg:'45' },
    ],
    physical:[
      { item:'성상', data:'액체', src:'흑색 불투명한 액' },{ item:'색상', data:'흑색', src:'흑색 불투명' },{ item:'냄새', data:'자극성 냄새', src:'' },
      { item:'냄새역치', data:'', src:'자료없음' },{ item:'pH', data:'', src:'자료없음' },{ item:'녹는점', data:'', src:'자료없음' },
      { item:'초기끓는점/끓는점 범위', data:'', src:'아세톤(Acetone) 기준 56.1 ℃ 이상' },{ item:'인화점', data:'', src:'Aerosol -41 ℃(디메틸에테르), 아세톤 > -17 ℃ (c.c.)' },{ item:'증발속도', data:'', src:'자료없음' },
      { item:'인화성', data:'', src:'인화성' },{ item:'폭발범위', data:'', src:'상한/하한: 27.0 / 3.4 % (디메틸에테르)' },{ item:'증기압', data:'', src:'자료없음' },
      { item:'용해도', data:'', src:'자료없음' },{ item:'비중', data:'1.05 ± 0.05', src:'' },{ item:'물분배계수', data:'', src:'아세톤(-0.24, Log Kow)' },
      { item:'자연발화온도', data:'', src:'디메틸에테르 350 ℃' },{ item:'분해온도', data:'', src:'자료없음' },{ item:'점도', data:'', src:'자료없음' },{ item:'분자량', data:'', src:'혼합물로 자료없음' },
    ],
    regulations:[
      '화평법 > 기존물질(KECL)','산업안전보건법 > 노출기준설정물질','산업안전보건법 > 관리대상유해물질','산업안전보건법 > 작업환경측정대상유해인자',
      '산업안전보건법 > 특수건강진단대상유해인자','위험물안전관리법 > 제4류 인화성액체 > 제1석유류 > 비수용성액체','위험물안전관리법 > 제4류 인화성액체 > 제1석유류 > 수용성액체',
      '위험물안전관리법 > 제4류 인화성액체 > 제2석유류 > 비수용성액체','폐기물관리법 > 지정폐기물','연구실안전환경조성법 > 건강검진 대상물질',
      '연구실안전환경조성법 > 정밀안전진단 대상물질','고압가스안전관리법 > 가연성가스',
    ],
  },
};
// GHS 그림문자 아이콘 — 표준 그림문자 이미지(빨간 마름모 포함) 사용
const GHS_IMG = {
  GHS02: 'images/ghs/ghs02.png', // 인화성
  GHS04: 'images/ghs/ghs04.png', // 고압가스
  GHS05: 'images/ghs/ghs05.png', // 부식성
  GHS06: 'images/ghs/ghs06.png', // 급성독성
  GHS07: 'images/ghs/ghs07.png', // 경고
  GHS08: 'images/ghs/ghs08.png', // 건강유해성
  GHS09: 'images/ghs/ghs09.png', // 수생환경유해성
};
function ghsIcon(code) {
  const src = GHS_IMG[code];
  if (src) return `<img class="msds2-picto-img" src="${src}" alt="${escapeHtml(code)}" />`;
  // 매핑 없는 코드(GHS01/03 등)는 빈 마름모로 폴백
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/></svg>`;
}

// NFPA 704 물리화학적유해등급 — 제공 이미지를 배경으로, 각 분면에 등급 숫자를 오버레이.
function nfpaDiamond(n) {
  const num = (s) => { const mt = String(s == null ? '' : s).match(/^\s*(\d)/); return mt ? mt[1] : '-'; };
  return `
    <div class="nfpa-img-wrap">
      <img class="nfpa-img" src="images/nfpa_diamond.png" alt="NFPA 704 물리화학적유해등급 다이아몬드" />
      <span class="nfpa-n nfpa-n-fire">${num(n.fire)}</span>
      <span class="nfpa-n nfpa-n-health">${num(n.health)}</span>
      <span class="nfpa-n nfpa-n-react">${num(n.react)}</span>
      <span class="nfpa-n nfpa-n-spec">${escapeHtml(num(n.specific))}</span>
    </div>`;
}

function openMSDSFull(key) {
  const m = MSDS_FULL[key];
  const dash = '<span style="color:var(--t-3);">—</span>';
  const v = (x) => (x === undefined || x === null || x === '') ? dash : escapeHtml(String(x));
  const p = m.product;
  document.getElementById('msdsSub').textContent = p.name;

  const infoTable = `
    <table class="msds2-table">
      <tbody>
        <tr><th>CAS No.</th><td>${v(p.cas)}</td><th>KE No.</th><td>${v(p.ke)}</td><th>UN No.</th><td>${v(p.un)}</td><th>EU No.</th><td>${v(p.eu)}</td></tr>
        <tr><th>제품명</th><td colspan="7" class="msds2-strong">${v(p.name)}</td></tr>
        <tr><th>이명</th><td colspan="7">${v(p.alias)}</td></tr>
        <tr><th>제조사</th><td colspan="7">${v(p.maker)}</td></tr>
        <tr><th>보관분류기준</th><td colspan="3">${v(p.storeClass)}</td><th>보관/저장정보</th><td colspan="3">${v(p.storeInfo)}</td></tr>
        <tr><th>MSDS 첨부파일</th><td colspan="3">${v(p.file)}</td><th>MSDS 제·개정일</th><td colspan="3">${v(p.revised)}</td></tr>
        <tr><th>포장단위</th><td colspan="3">${v(p.packing)}</td><th>MSDS 제출번호</th><td colspan="3">${v(p.submitNo)}</td></tr>
      </tbody>
    </table>`;

  const classList = m.ghsClass.map(c => `<div class="msds2-class">${escapeHtml(c)}</div>`).join('');
  const pictos = m.pictograms.map(g => `
    <div class="msds2-picto">
      <div class="msds2-picto-box">${ghsIcon(g.code)}</div>
      <div class="msds2-picto-lbl">${escapeHtml(g.label)}</div>
      <div class="msds2-picto-en">${escapeHtml(g.en)}</div>
    </div>`).join('');
  const hCodes = m.hCodes.map(h => `<div class="msds2-hcode">${escapeHtml(h)}</div>`).join('');
  const pBlocks = m.pStatements.map(b => `
    <div class="msds2-pblock">
      <div class="msds2-pcat">[${escapeHtml(b.cat)}]</div>
      <div class="msds2-plist">${b.items.map(i => `<div>${escapeHtml(i)}</div>`).join('')}</div>
    </div>`).join('');
  const n = m.nfpa;

  const compRows = m.components.map(c => `
    <tr><td class="tc">${escapeHtml(c.cas)}</td><td>${escapeHtml(c.name)}</td><td class="tc">${escapeHtml(c.range)}</td><td class="tc">${escapeHtml(c.max)}</td><td class="tc">${c.avg ? escapeHtml(c.avg) : dash}</td></tr>`).join('');

  const physRows = m.physical.map(r => `
    <tr><th>${escapeHtml(r.item)}</th><td>${r.data ? escapeHtml(r.data) : dash}</td><td>${r.src ? escapeHtml(r.src) : dash}</td></tr>`).join('');

  const regList = m.regulations.map(r => `<div class="msds2-reg">${escapeHtml(r)}</div>`).join('');

  document.getElementById('msdsBody').innerHTML = `
    <div class="msds2">
      <div class="msds2-level">1. 화학제품과 회사에 관한 정보</div>
      ${infoTable}

      <div class="msds2-level">2. 유해성·위험성</div>
      <div class="msds2-subhead">유해성·위험성 분류</div>
      <div class="msds2-class-list">${classList}</div>
      <div class="msds2-subhead">그림문자</div>
      <div class="msds2-pictos">${pictos || '<span style="color:var(--t-3);">해당 없음</span>'}</div>
      <table class="msds2-table"><tbody>
        <tr><th>신호어</th><td colspan="3" class="msds2-signal">${v(m.signal)}</td></tr>
        <tr><th>물리화학적유해등급</th><td>${v(m.physGrade)}</td><th>건강상유해등급</th><td>${v(m.healthGrade)}</td></tr>
      </tbody></table>
      <div class="msds2-subhead">유해위험성문구</div>
      <div class="msds2-hcodes">${hCodes}</div>
      <div class="msds2-subhead">예방조치문구</div>
      <div class="msds2-pstatements">${pBlocks}</div>
      <div class="msds2-subhead">물리화학적유해등급 (NFPA 704)</div>
      <div class="msds2-nfpa-wrap">
        ${nfpaDiamond(n)}
        <table class="msds2-table msds2-nfpa"><tbody>
          <tr><th class="nf-h">HEALTH (건강위험성)</th><td>${escapeHtml(n.health)}</td></tr>
          <tr><th class="nf-f">FLAMMABILITY (화재위험성)</th><td>${escapeHtml(n.fire)}</td></tr>
          <tr><th class="nf-r">REACTIVITY (반응위험성)</th><td>${escapeHtml(n.react)}</td></tr>
          <tr><th class="nf-s">SPECIFIC HAZARD (특수위험성)</th><td>${escapeHtml(n.specific)}</td></tr>
        </tbody></table>
      </div>

      <div class="msds2-level">3. 구성성분의 명칭 및 함유량</div>
      <table class="msds2-table msds2-comp">
        <thead><tr><th>CAS No.</th><th>화학물질명</th><th>함유량</th><th>함유량MAX(%)</th><th>함유량AVG(%)</th></tr></thead>
        <tbody>${compRows}</tbody>
      </table>

      <div class="msds2-level">9. 물리화학적 특성</div>
      <table class="msds2-table msds2-phys">
        <thead><tr><th>항목</th><th>데이터</th><th>추가정보 / 출처</th></tr></thead>
        <tbody>${physRows}</tbody>
      </table>

      <div class="msds2-level">15. 법적규제현황</div>
      <div class="msds2-reg-list">${regList}</div>
    </div>`;
  document.getElementById('msdsOverlay').classList.add('open');
  // 모달을 새로 열 때마다 본문 스크롤을 최상단으로 초기화(이전 물질의 스크롤 위치가
  // innerHTML 교체 후에도 픽셀값으로 유지되는 문제 방지).
  document.getElementById('msdsBody').scrollTop = 0;
}

function openMSDS(key) {
  // 제품 정보 MSDS 전체 자료가 있으면 해당 형식으로 표시
  if (MSDS_FULL[key]) { openMSDSFull(key); return; }
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
  // 모달을 새로 열 때마다 본문 스크롤을 최상단으로 초기화.
  document.getElementById('msdsBody').scrollTop = 0;
}
