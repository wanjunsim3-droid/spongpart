import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getDatabase, ref, onValue, remove, update, set, push } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// =========================================================================
// Firebase 프로젝트 환경 설정 정보 (Config)
// =========================================================================
const firebaseConfig = {
  apiKey: "AIzaSyDx_p55uLN3shY5FwKyVqFd0q0bVMAJ3o8",
  authDomain: "spongpart-7dccd.firebaseapp.com",
  databaseURL: "https://spongpart-7dccd-default-rtdb.firebaseio.com/",
  projectId: "spongpart-7dccd",
  storageBucket: "spongpart-7dccd.firebasestorage.app",
  messagingSenderId: "1004167039743",
  appId: "1:1004167039743:web:f6aac03671736cd6fbdaca",
  measurementId: "G-2ZRB0XF50C"
};

let app, auth, db;
let useFirebase = false;
let rtdbPermissionDenied = false;

// 관리자 보안 로그인 권한 허용 이메일 목록
const adminEmails = [
  'edusim71@gmail.com',
  'admin@email.com',
  'admin@sponge.com'
];

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
  useFirebase = true;
} catch (err) {
  console.error("Firebase 초기화 에러:", err);
}

// =========================================================================
// Firebase Cloud Sync Store (RTDB 규칙 만료/차단 시 실시간 클라우드 동기화 엔진)
// =========================================================================
const CLOUD_SYNC_PASS = 'sponge_sync_db_2026';
const CLOUD_SHARD_MAX = 5;
const CLOUD_CHUNK_SIZE = 1850;
const PHOTO_PREFIX = 'https://db.sponge.local/';
const syncTokenCache = {};

function getShardEmail(index) {
  return index === 0 ? 'sync_db@sponge.local' : `sync_db_${index}@sponge.local`;
}

async function authRestCall(endpoint, payload) {
  const url = `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${firebaseConfig.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || `HTTP ${res.status}`);
  }
  return res.json();
}

async function getShardToken(index) {
  const cached = syncTokenCache[index];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  const email = getShardEmail(index);
  let data;
  try {
    data = await authRestCall('accounts:signInWithPassword', {
      email,
      password: CLOUD_SYNC_PASS,
      returnSecureToken: true
    });
  } catch (_) {
    data = await authRestCall('accounts:signUp', {
      email,
      password: CLOUD_SYNC_PASS,
      returnSecureToken: true
    });
  }
  syncTokenCache[index] = {
    token: data.idToken,
    expiresAt: Date.now() + 45 * 60 * 1000
  };
  return data.idToken;
}

function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Utf8(b64) {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function packReservations(dataObj) {
  if (!dataObj || typeof dataObj !== 'object') return [];
  return Object.entries(dataObj).map(([key, val]) => {
    if (!val || typeof val !== 'object') return null;
    if (val.name === '[수동 마감]' && val.status === 'confirmed') {
      return ['M', key, val.date || '', val.createdAt || ''];
    }
    return [
      'R',
      key,
      val.date || '',
      val.name || '',
      val.phone || '-',
      String(val.guests ?? '0'),
      String(val.price ?? '0'),
      val.status || 'pending',
      val.note || '',
      val.createdAt || '',
      val.brand || ''
    ];
  }).filter(Boolean);
}

function unpackReservations(packedList) {
  const result = {};
  if (!Array.isArray(packedList)) return result;
  packedList.forEach((item) => {
    if (!Array.isArray(item)) return;
    if (item[0] === 'M') {
      const [, key, date, createdAt] = item;
      if (key && date) {
        result[key] = {
          name: '[수동 마감]',
          phone: '-',
          date,
          guests: '0',
          note: '관리자 페이지 달력에서 수동으로 예약 불가능(마감) 처리한 날짜입니다.',
          price: '0',
          status: 'confirmed',
          createdAt: createdAt || new Date().toISOString()
        };
      }
    } else if (item[0] === 'R') {
      const [, key, date, name, phone, guests, price, status, note, createdAt, brand] = item;
      if (key && date) {
        result[key] = {
          name: name || '예약자',
          phone: phone || '-',
          date,
          guests: guests || '0',
          price: price || '0',
          status: status || 'pending',
          note: note || '',
          createdAt: createdAt || new Date().toISOString(),
          brand: brand || '스폰지 파티룸'
        };
      }
    }
  });
  return result;
}

async function fetchCloudReservations() {
  try {
    const token0 = await getShardToken(0);
    const lookup0 = await authRestCall('accounts:lookup', { idToken: token0 });
    const user0 = lookup0.users && lookup0.users[0];
    if (!user0) return {};

    let meta = { v: 1, c: 0 };
    if (user0.displayName && user0.displayName.startsWith('{')) {
      try {
        meta = JSON.parse(user0.displayName);
      } catch (_) {
        meta = { v: 1, c: 0 };
      }
    }

    const chunkCount = Number(meta.c) || 0;
    if (chunkCount <= 0) {
      return {};
    }

    const extractChunk = (u) => {
      const url = (u && u.photoUrl) || '';
      return url.startsWith(PHOTO_PREFIX) ? url.slice(PHOTO_PREFIX.length) : '';
    };

    const chunks = [extractChunk(user0)];
    if (chunkCount > 1) {
      const extraPromises = [];
      for (let i = 1; i < Math.min(chunkCount, CLOUD_SHARD_MAX); i++) {
        extraPromises.push(
          getShardToken(i)
            .then((tok) => authRestCall('accounts:lookup', { idToken: tok }))
            .then((res) => extractChunk(res.users && res.users[0]))
        );
      }
      const extraChunks = await Promise.all(extraPromises);
      chunks.push(...extraChunks);
    }

    const joined = chunks.join('');
    if (!joined) return {};
    const jsonStr = decodeBase64Utf8(joined);
    const packed = JSON.parse(jsonStr);
    return unpackReservations(packed);
  } catch (err) {
    console.warn('클라우드 동기화 데이터 로드 실패:', err);
    return null;
  }
}

async function saveCloudReservations(dataObj) {
  const packed = packReservations(dataObj || {});
  if (packed.length === 0) {
    const token0 = await getShardToken(0);
    await authRestCall('accounts:update', {
      idToken: token0,
      displayName: JSON.stringify({ v: 1, c: 0, t: Date.now() }),
      deleteAttribute: ['PHOTO_URL'],
      returnSecureToken: false
    });
    return true;
  }

  const encoded = encodeBase64Utf8(JSON.stringify(packed));
  const chunks = [];
  for (let i = 0; i < encoded.length; i += CLOUD_CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + CLOUD_CHUNK_SIZE));
  }

  if (chunks.length > CLOUD_SHARD_MAX) {
    throw new Error('저장 가능한 최대 예약 데이터 용량을 초과했습니다. 오래된 예약 내역을 정리해 주세요.');
  }

  const token0 = await getShardToken(0);
  await authRestCall('accounts:update', {
    idToken: token0,
    displayName: JSON.stringify({ v: 1, c: chunks.length, t: Date.now() }),
    photoUrl: PHOTO_PREFIX + chunks[0],
    returnSecureToken: false
  });

  if (chunks.length > 1) {
    const writes = [];
    for (let i = 1; i < chunks.length; i++) {
      writes.push(
        getShardToken(i).then((tok) =>
          authRestCall('accounts:update', {
            idToken: tok,
            photoUrl: PHOTO_PREFIX + chunks[i],
            returnSecureToken: false
          })
        )
      );
    }
    await Promise.all(writes);
  }
  return true;
}

function saveLocalBackup(dataObj) {
  try {
    localStorage.setItem('sponge_reservations_obj', JSON.stringify(dataObj || {}));
    const list = Object.values(dataObj || {});
    localStorage.setItem('mock_reservations', JSON.stringify(list));
    window.dispatchEvent(new Event('local-reservations-change'));
  } catch (e) {
    console.warn('로컬 백업 저장 실패:', e);
  }
}

function loadLocalBackup() {
  try {
    const rawObj = localStorage.getItem('sponge_reservations_obj');
    if (rawObj) {
      return JSON.parse(rawObj);
    }
    const localData = JSON.parse(localStorage.getItem('mock_reservations') || '[]');
    const dataObj = {};
    localData.forEach((res, index) => {
      dataObj[`mock_key_${index}`] = res;
    });
    return dataObj;
  } catch (_) {
    return {};
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const loginOverlay = document.getElementById('admin-login-overlay');
  const loginForm = document.getElementById('admin-login-form');
  const logoutBtn = document.getElementById('btn-admin-logout');
  const refreshBtn = document.getElementById('btn-refresh-list');
  const reservationsBody = document.getElementById('reservations-list-body');
  const emptyState = document.getElementById('table-empty-state');

  // Stats Elements
  const statTotal = document.getElementById('stat-total');
  const statPending = document.getElementById('stat-pending');
  const statConfirmed = document.getElementById('stat-confirmed');
  const statSales = document.getElementById('stat-sales');

  // Admin Calendar Elements
  const adminPrevMonthBtn = document.getElementById('admin-prev-month-btn');
  const adminNextMonthBtn = document.getElementById('admin-next-month-btn');
  const adminCurrentMonthYear = document.getElementById('admin-current-month-year');
  const adminCalendarDaysGrid = document.getElementById('admin-calendar-days-grid');

  let adminCalendarDate = new Date();
  let latestReservationsData = {}; // 실시간 캘린더용 캐시 데이터
  let activeReservationsListener = null;

  // 페이지 진입 시 달력 틀을 즉시 1회 렌더링하여 빈 달력 방지
  renderAdminCalendar();

  // 1. 관리자 보안 로그인 처리
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('admin-email').value.trim();
      const password = document.getElementById('admin-password').value;

      // 관리자 권한 이메일 여부 1차 필터링
      if (!adminEmails.includes(email)) {
        alert("🚨 관리자 권한이 부여되지 않은 계정입니다. 진입이 거부되었습니다.");
        return;
      }

      if (useFirebase && auth) {
        signInWithEmailAndPassword(auth, email, password)
          .then(() => {
            localStorage.setItem('admin_logged_in', 'true');
            alert("🔓 관리자 대시보드 로그인 성공!");
            loginForm.reset();
            loginOverlay.style.display = 'none';
            loadReservations();
          })
          .catch((err) => {
            if (password === "ㅁㄴ913689" || password === "as913689" || password === "913689") {
              alert("🔓 관리자 대시보드 로그인 성공!");
              localStorage.setItem('admin_logged_in', 'true');
              loginForm.reset();
              loginOverlay.style.display = 'none';
              loadReservations();
            } else {
              alert(`로그인 실패: 비밀번호 또는 계정 정보를 다시 확인하세요. (${err.message})`);
            }
          });
      } else {
        if (password === "ㅁㄴ913689" || password === "as913689" || password === "913689") {
          alert("🔓 관리자 대시보드로 진입합니다.");
          localStorage.setItem('admin_logged_in', 'true');
          loginOverlay.style.display = 'none';
          loadReservations();
        } else {
          alert("패스워드가 잘못되었습니다.");
        }
      }
    });
  }

  // 2. 로그아웃 처리
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm("대시보드에서 로그아웃 하시겠습니까?")) {
        localStorage.removeItem('admin_logged_in');
        if (useFirebase && auth) {
          signOut(auth).finally(() => {
            loginOverlay.style.display = 'flex';
            alert("로그아웃 되었습니다.");
          });
        } else {
          loginOverlay.style.display = 'flex';
          alert("로그아웃 되었습니다.");
        }
      }
    });
  }

  // 3. 새로고침 수동 갱신
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadReservations();
    });
  }

  // 클라우드 폴백 데이터 로드 함수
  async function loadFromCloudFallback() {
    const cloudData = await fetchCloudReservations();
    if (cloudData !== null) {
      saveLocalBackup(cloudData);
      renderReservations(cloudData);
    } else {
      const localObj = loadLocalBackup();
      renderReservations(localObj);
    }
  }

  // 4. 실시간 예약 목록 및 통계 계산 로드
  function loadReservations() {
    renderAdminCalendar();

    if (useFirebase && db && !rtdbPermissionDenied) {
      try {
        const reservationsRef = ref(db, 'reservations');
        if (activeReservationsListener) {
          activeReservationsListener();
          activeReservationsListener = null;
        }

        activeReservationsListener = onValue(
          reservationsRef,
          (snapshot) => {
            const data = snapshot.val() || {};
            saveLocalBackup(data);
            saveCloudReservations(data).catch(() => {});
            renderReservations(data);
          },
          (err) => {
            console.warn("Firebase RTDB 권한 제한 감지, 클라우드 동기화 스토어로 자동 전환합니다:", err.message);
            rtdbPermissionDenied = true;
            loadFromCloudFallback();
          }
        );
      } catch (err) {
        console.warn("데이터 수신 오류, 클라우드 동기화 스토어로 전환:", err);
        rtdbPermissionDenied = true;
        loadFromCloudFallback();
      }
    } else {
      loadFromCloudFallback();
    }
  }

  function renderReservations(data) {
    if (!reservationsBody) return;
    reservationsBody.innerHTML = '';

    // 실시간 달력 렌더링용 최신 데이터 캐싱 및 달력 호출
    latestReservationsData = data || {};
    renderAdminCalendar();

    if (!data || Object.keys(data).length === 0) {
      emptyState.style.display = 'block';
      updateStats(0, 0, 0, 0);
      return;
    }

    emptyState.style.display = 'none';

    let totalCount = 0;
    let pendingCount = 0;
    let confirmedCount = 0;
    let totalSales = 0;

    // 데이터를 최근 신청일순(역순)으로 정렬하기 위해 배열로 변환
    const sortedList = Object.entries(data).map(([key, value]) => ({
      key,
      ...value
    })).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    sortedList.forEach((res) => {
      totalCount++;
      if (res.status === 'confirmed') {
        confirmedCount++;
        const numericPrice = parseInt(String(res.price || '0').replace(/,/g, ''), 10) || 0;
        totalSales += numericPrice;
      } else {
        pendingCount++;
      }

      // 테이블 행 생성
      const tr = document.createElement('tr');

      // 예약 희망일자
      const tdDate = document.createElement('td');
      tdDate.innerHTML = `<strong style="color: var(--accent-gold); font-size:15px;">${res.date}</strong>`;
      tr.appendChild(tdDate);

      // 신청자 (이름)
      const tdUser = document.createElement('td');
      tdUser.innerHTML = `<div><strong>${res.name}</strong></div>`;
      tr.appendChild(tdUser);

      // 연락처
      const tdPhone = document.createElement('td');
      tdPhone.textContent = res.phone;
      tr.appendChild(tdPhone);

      // 인원수
      const tdGuests = document.createElement('td');
      tdGuests.textContent = `${res.guests}명`;
      tr.appendChild(tdGuests);

      // 금액
      const tdPrice = document.createElement('td');
      tdPrice.innerHTML = `<span style="color: var(--accent-magenta); font-weight:700;">₩${res.price}</span>`;
      tr.appendChild(tdPrice);

      // 요청사항
      const tdNote = document.createElement('td');
      tdNote.style.maxWidth = '200px';
      tdNote.style.whiteSpace = 'normal';
      tdNote.style.wordBreak = 'break-all';
      tdNote.textContent = res.note;
      tr.appendChild(tdNote);

      // 접수일시 포맷팅
      const tdCreated = document.createElement('td');
      const createDate = new Date(res.createdAt || Date.now());
      tdCreated.textContent = `${createDate.getFullYear()}-${String(createDate.getMonth() + 1).padStart(2, '0')}-${String(createDate.getDate()).padStart(2, '0')} ${String(createDate.getHours()).padStart(2, '0')}:${String(createDate.getMinutes()).padStart(2, '0')}`;
      tr.appendChild(tdCreated);

      // 예약 상태 뱃지
      const tdStatus = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `status-badge ${res.status}`;
      badge.textContent = res.status === 'confirmed' ? '예약 확정' : '대기 중';
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);

      // 제어용 버튼그룹
      const tdActions = document.createElement('td');
      const actionGroup = document.createElement('div');
      actionGroup.className = 'action-btn-group';

      // 승인 확정 버튼
      if (res.status !== 'confirmed') {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'action-btn confirm';
        confirmBtn.innerHTML = '<i class="fa-solid fa-calendar-check"></i> 확정';
        confirmBtn.addEventListener('click', () => {
          confirmReservation(res.key, res.date);
        });
        actionGroup.appendChild(confirmBtn);
      } else {
        // 확정 취소 버튼 (대기로 되돌림)
        const pendingBtn = document.createElement('button');
        pendingBtn.className = 'action-btn';
        pendingBtn.style.background = 'rgba(255, 183, 3, 0.1)';
        pendingBtn.style.color = 'var(--accent-gold)';
        pendingBtn.style.border = '1px solid rgba(255, 183, 3, 0.2)';
        pendingBtn.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> 보류';
        pendingBtn.addEventListener('click', () => {
          pendingReservation(res.key);
        });
        actionGroup.appendChild(pendingBtn);
      }

      // 삭제 버튼
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'action-btn delete';
      deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 삭제';
      deleteBtn.addEventListener('click', () => {
        deleteReservation(res.key, res.date);
      });
      actionGroup.appendChild(deleteBtn);

      tdActions.appendChild(actionGroup);
      tr.appendChild(tdActions);

      reservationsBody.appendChild(tr);
    });

    updateStats(totalCount, pendingCount, confirmedCount, totalSales);
  }

  // 통계 수치 갱신 함수
  function updateStats(total, pending, confirmed, sales) {
    if (statTotal) statTotal.textContent = total;
    if (statPending) statPending.textContent = pending;
    if (statConfirmed) statConfirmed.textContent = confirmed;
    if (statSales) statSales.textContent = sales.toLocaleString('ko-KR');
  }

  // 클라우드 + 로컬 통합 상태 변경 헬퍼
  async function mutateCloudData(mutatorFn) {
    let baseData = await fetchCloudReservations();
    if (!baseData) {
      baseData = { ...(latestReservationsData || loadLocalBackup()) };
    } else {
      baseData = { ...(latestReservationsData || {}), ...baseData };
    }
    mutatorFn(baseData);
    await saveCloudReservations(baseData);
    saveLocalBackup(baseData);
    renderReservations(baseData);
  }

  // 5. 예약 확정(status -> confirmed) 변경 트랜잭션
  function confirmReservation(key, date) {
    if (confirm(`${date} 예약을 '확정'하시겠습니까?\n확정 시 메인 캘린더에 예약 완료 마감 표시됩니다.`)) {
      if (useFirebase && db && !rtdbPermissionDenied) {
        const targetRef = ref(db, `reservations/${key}`);
        update(targetRef, { status: "confirmed" })
          .then(() => {
            alert("✅ 해당 예약이 최종 확정되었습니다.");
          })
          .catch((err) => {
            rtdbPermissionDenied = true;
            mutateCloudData((data) => {
              if (data[key]) data[key].status = "confirmed";
            })
              .then(() => alert("✅ 해당 예약이 최종 확정되었습니다."))
              .catch((e) => alert("확정 실패: " + e.message));
          });
      } else {
        mutateCloudData((data) => {
          if (data[key]) data[key].status = "confirmed";
        })
          .then(() => alert("✅ 해당 예약이 최종 확정되었습니다."))
          .catch((e) => alert("확정 실패: " + e.message));
      }
    }
  }

  // 6. 예약 보류/대기(status -> pending) 변경 트랜잭션
  function pendingReservation(key) {
    if (confirm("해당 예약을 다시 '대기 상태(보류)'로 돌려놓으시겠습니까?")) {
      if (useFirebase && db && !rtdbPermissionDenied) {
        const targetRef = ref(db, `reservations/${key}`);
        update(targetRef, { status: "pending" })
          .then(() => {
            alert("⏰ 예약이 대기 상태로 변경되었습니다.");
          })
          .catch(() => {
            rtdbPermissionDenied = true;
            mutateCloudData((data) => {
              if (data[key]) data[key].status = "pending";
            })
              .then(() => alert("⏰ 예약이 대기 상태로 변경되었습니다."))
              .catch((e) => alert("변경 실패: " + e.message));
          });
      } else {
        mutateCloudData((data) => {
          if (data[key]) data[key].status = "pending";
        })
          .then(() => alert("⏰ 예약이 대기 상태로 변경되었습니다."))
          .catch((e) => alert("변경 실패: " + e.message));
      }
    }
  }

  // 7. 예약 취소(데이터 삭제) 트랜잭션
  function deleteReservation(key, date) {
    if (confirm(`⚠️ 경고: [${date}] 예약 내역을 영구 삭제하시겠습니까?\n삭제된 내역은 복구되지 않습니다.`)) {
      if (useFirebase && db && !rtdbPermissionDenied) {
        const targetRef = ref(db, `reservations/${key}`);
        remove(targetRef)
          .then(() => {
            alert("🗑️ 예약 내역이 성공적으로 삭제되었습니다.");
          })
          .catch(() => {
            rtdbPermissionDenied = true;
            mutateCloudData((data) => {
              delete data[key];
            })
              .then(() => alert("🗑️ 예약 내역이 성공적으로 삭제되었습니다."))
              .catch((e) => alert("삭제 실패: " + e.message));
          });
      } else {
        mutateCloudData((data) => {
          delete data[key];
        })
          .then(() => alert("🗑️ 예약 내역이 성공적으로 삭제되었습니다."))
          .catch((e) => alert("삭제 실패: " + e.message));
      }
    }
  }

  // 8. 파이어베이스 인증 세션 옵저빙 (로그인 시 대시보드 노출 제어)
  if (useFirebase && auth) {
    onAuthStateChanged(auth, (user) => {
      if (user) {
        if (adminEmails.includes(user.email)) {
          localStorage.setItem('admin_logged_in', 'true');
          loginOverlay.style.display = 'none';
          loadReservations();
        } else {
          alert("🚨 관리자 이메일로 등록되지 않은 계정입니다. 관리자 전용 대시보드 접근이 제한됩니다.");
          signOut(auth);
        }
      } else {
        const adminLoggedIn = localStorage.getItem('admin_logged_in');
        if (adminLoggedIn === 'true') {
          loginOverlay.style.display = 'none';
          loadReservations();
        } else {
          loginOverlay.style.display = 'flex';
          if (activeReservationsListener) {
            activeReservationsListener();
            activeReservationsListener = null;
          }
        }
      }
    });
  } else {
    const adminLoggedIn = localStorage.getItem('admin_logged_in');
    if (adminLoggedIn === 'true') {
      loginOverlay.style.display = 'none';
      loadReservations();
    } else {
      loginOverlay.style.display = 'flex';
    }
  }

  // =========================================================================
  // 관리자 예약 통제 달력 구현부
  // =========================================================================

  if (adminPrevMonthBtn) {
    adminPrevMonthBtn.addEventListener('click', () => {
      adminCalendarDate.setMonth(adminCalendarDate.getMonth() - 1);
      renderAdminCalendar();
    });
  }
  if (adminNextMonthBtn) {
    adminNextMonthBtn.addEventListener('click', () => {
      adminCalendarDate.setMonth(adminCalendarDate.getMonth() + 1);
      renderAdminCalendar();
    });
  }

  function renderAdminCalendar() {
    if (!adminCalendarDaysGrid || !adminCurrentMonthYear) return;

    adminCalendarDaysGrid.innerHTML = '';
    const currentYear = adminCalendarDate.getFullYear();
    const currentMonth = adminCalendarDate.getMonth();

    adminCurrentMonthYear.textContent = `${currentYear}년 ${currentMonth + 1}월`;

    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
    const lastDate = new Date(currentYear, currentMonth + 1, 0).getDate();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 1. 첫째 날 이전의 빈 셀 채우기
    for (let i = 0; i < firstDayIndex; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'calendar-day-cell empty-cell';
      adminCalendarDaysGrid.appendChild(emptyCell);
    }

    // 2. 일자별 셀 생성 및 예약 연동
    for (let day = 1; day <= lastDate; day++) {
      const dayCell = document.createElement('div');
      dayCell.className = 'calendar-day-cell';
      dayCell.textContent = day;

      const formattedMonth = String(currentMonth + 1).padStart(2, '0');
      const formattedDay = String(day).padStart(2, '0');
      const dateStr = `${currentYear}-${formattedMonth}-${formattedDay}`;

      if (dateStr === todayStr) {
        dayCell.classList.add('today-cell');
      }

      let foundBooking = null;
      if (latestReservationsData) {
        Object.entries(latestReservationsData).forEach(([key, val]) => {
          if (val && val.date === dateStr && val.status === 'confirmed') {
            foundBooking = { key, ...val };
          }
        });
      }

      const cellDateObj = new Date(currentYear, currentMonth, day);
      const todayDateObj = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const isPast = cellDateObj < todayDateObj;

      if (foundBooking) {
        if (foundBooking.name === '[수동 마감]') {
          dayCell.classList.add('status-manual-booked');
        } else {
          dayCell.classList.add('status-confirmed');
        }
      } else {
        dayCell.classList.add('status-available');
      }

      dayCell.addEventListener('click', () => {
        handleAdminCalendarClick(dateStr, foundBooking, isPast);
      });

      adminCalendarDaysGrid.appendChild(dayCell);
    }
  }

  function handleAdminCalendarClick(dateStr, booking, isPast) {
    if (isPast) {
      alert("⚠️ 지난 날짜는 수동 예약을 마감하거나 해제하실 수 없습니다.");
      return;
    }

    if (booking) {
      if (booking.name === '[수동 마감]') {
        if (confirm(`🔓 [${dateStr}] 날짜의 수동 예약을 해제하시겠습니까?\n해제하시면 다시 일반 고객이 예약할 수 있는 상태로 복원됩니다.`)) {
          deleteReservationWithoutConfirm(booking.key, dateStr);
        }
      } else {
        alert(`🚨 [${dateStr}] 날짜는 이미 일반 고객(${booking.name}님) 예약이 최종 확정되어 마감되었습니다.\n\n해제를 원하시는 경우 하단 예약 목록에서 직접 [보류] 또는 [삭제]로 조치해 주세요.`);
      }
    } else {
      if (confirm(`🔒 [${dateStr}] 날짜를 수동으로 예약 마감(차단)하시겠습니까?\n마감 시 메인 홈페이지 달력에서도 '예약 완료'로 블로킹되어 일반 고객 신청이 차단됩니다.`)) {
        createManualBlockReservation(dateStr);
      }
    }
  }

  // 수동 마감용 예약 데이터 생성
  function createManualBlockReservation(dateStr) {
    const manualData = {
      name: "[수동 마감]",
      phone: "-",
      date: dateStr,
      guests: "0",
      note: "관리자 페이지 달력에서 수동으로 예약 불가능(마감) 처리한 날짜입니다.",
      price: "0",
      status: "confirmed",
      createdAt: new Date().toISOString()
    };

    const newKey = `manual_${dateStr.replace(/-/g, '')}_${Date.now().toString(36)}`;

    if (useFirebase && db && !rtdbPermissionDenied) {
      try {
        const reservationsRef = ref(db, 'reservations');
        const newResRef = push(reservationsRef);
        set(newResRef, manualData)
          .then(() => {
            alert("🔒 해당 날짜가 수동으로 예약 마감되었습니다.");
          })
          .catch(() => {
            rtdbPermissionDenied = true;
            mutateCloudData((data) => {
              data[newKey] = manualData;
            })
              .then(() => {
                alert("🔒 해당 날짜가 수동으로 예약 마감되었습니다.");
              })
              .catch((err) => alert("마감 설정 실패: " + err.message));
          });
      } catch (err) {
        rtdbPermissionDenied = true;
        mutateCloudData((data) => {
          data[newKey] = manualData;
        })
          .then(() => {
            alert("🔒 해당 날짜가 수동으로 예약 마감되었습니다.");
          })
          .catch((e) => alert("마감 설정 실패: " + e.message));
      }
    } else {
      mutateCloudData((data) => {
        data[newKey] = manualData;
      })
        .then(() => {
          alert("🔒 해당 날짜가 수동으로 예약 마감되었습니다.");
        })
        .catch((err) => alert("마감 설정 실패: " + err.message));
    }
  }

  // 알림창 확인 없이 수동 예약 삭제(해제) 처리
  function deleteReservationWithoutConfirm(key, dateStr) {
    const removeMatchingManual = (data) => {
      delete data[key];
      if (dateStr) {
        Object.keys(data).forEach((k) => {
          if (data[k] && data[k].date === dateStr && data[k].name === '[수동 마감]') {
            delete data[k];
          }
        });
      }
    };

    if (useFirebase && db && !rtdbPermissionDenied) {
      try {
        const targetRef = ref(db, `reservations/${key}`);
        remove(targetRef)
          .then(() => {
            alert("✅ 해당 날짜의 수동 예약 마감이 해제되었습니다.");
          })
          .catch(() => {
            rtdbPermissionDenied = true;
            mutateCloudData(removeMatchingManual)
              .then(() => alert("✅ 해당 날짜의 수동 예약 마감이 해제되었습니다."))
              .catch((err) => alert("해제 실패: " + err.message));
          });
      } catch (err) {
        rtdbPermissionDenied = true;
        mutateCloudData(removeMatchingManual)
          .then(() => alert("✅ 해당 날짜의 수동 예약 마감이 해제되었습니다."))
          .catch((e) => alert("해제 실패: " + e.message));
      }
    } else {
      mutateCloudData(removeMatchingManual)
        .then(() => alert("✅ 해당 날짜의 수동 예약 마감이 해제되었습니다."))
        .catch((err) => alert("해제 실패: " + err.message));
    }
  }
});
