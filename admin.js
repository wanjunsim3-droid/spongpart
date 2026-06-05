import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getDatabase, ref, onValue, remove, update } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

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
  alert("Firebase 연결 중 문제가 발생했습니다.");
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

  let activeReservationsListener = null;

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
            alert("🔓 관리자 대시보드 로그인 성공!");
            loginForm.reset();
          })
          .catch((err) => {
            alert(`로그인 실패: 비밀번호 또는 계정 정보를 다시 확인하세요. (${err.message})`);
          });
      } else {
        // 로컬 목업 가상 관리자 로그인 (한글 'ㅁㄴ913689' 및 영타 'as913689' 호환 처리)
        if (password === "ㅁㄴ913689" || password === "as913689") {
          alert("🔓 가상 관리자 대시보드로 진입합니다 (가상 로컬 모드)");
          localStorage.setItem('admin_logged_in', 'true');
          loginOverlay.style.display = 'none';
          loadReservations();
        } else {
          alert("패스워드가 잘못되었습니다. (가상 모드 비밀번호: ㅁㄴ913689)");
        }
      }
    });
  }

  // 2. 로그아웃 처리
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm("대시보드에서 로그아웃 하시겠습니까?")) {
        if (useFirebase && auth) {
          signOut(auth).then(() => {
            alert("로그아웃 되었습니다.");
          });
        } else {
          localStorage.removeItem('admin_logged_in');
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

  // 4. 실시간 예약 목록 및 통계 계산 로드
  function loadReservations() {
    if (useFirebase && db) {
      try {
        const reservationsRef = ref(db, 'reservations');
        // 기존 리스너가 있으면 누적 방지용 클린업
        if (activeReservationsListener) {
          activeReservationsListener();
        }
        
        activeReservationsListener = onValue(reservationsRef, (snapshot) => {
          const data = snapshot.val();
          renderReservations(data);
        });
      } catch (err) {
        console.error("데이터 수신 오류:", err);
      }
    } else {
      // 로컬 가상 예약 데이터 로드
      const localData = JSON.parse(localStorage.getItem('mock_reservations') || '[]');
      // 리스트 렌더링에 적합한 가상 Object 구조로 변환
      const dataObj = {};
      localData.forEach((res, index) => {
        dataObj[`mock_key_${index}`] = res;
      });
      renderReservations(dataObj);
    }
  }

  function renderReservations(data) {
    if (!reservationsBody) return;
    reservationsBody.innerHTML = '';

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
    })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    sortedList.forEach((res) => {
      totalCount++;
      if (res.status === 'confirmed') {
        confirmedCount++;
        // 매출액 산출 (문자열에서 쉼표나 기호를 떼고 계산)
        const numericPrice = parseInt(res.price.replace(/,/g, ''), 10) || 0;
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

      // 신청자 (이름 및 연락처용)
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
      const createDate = new Date(res.createdAt);
      tdCreated.textContent = `${createDate.getFullYear()}-${String(createDate.getMonth()+1).padStart(2,'0')}-${String(createDate.getDate()).padStart(2,'0')} ${String(createDate.getHours()).padStart(2,'0')}:${String(createDate.getMinutes()).padStart(2,'0')}`;
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

  // 5. 예약 확정(status -> confirmed) 변경 트랜잭션
  function confirmReservation(key, date) {
    if (confirm(`${date} 예약을 '확정'하시겠습니까?\n확정 시 메인 캘린더에 예약 완료 마감 표시됩니다.`)) {
      if (useFirebase && db) {
        try {
          const targetRef = ref(db, `reservations/${key}`);
          update(targetRef, { status: "confirmed" })
            .then(() => {
              alert("✅ 해당 예약이 최종 확정되었습니다.");
            })
            .catch(err => alert("확정 실패: " + err.message));
        } catch (err) {
          alert("DB 처리 오류: " + err.message);
        }
      } else {
        // 로컬 모드 상태 변경
        let localRes = JSON.parse(localStorage.getItem('mock_reservations') || '[]');
        const index = parseInt(key.replace('mock_key_', ''), 10);
        if (localRes[index]) {
          localRes[index].status = "confirmed";
          localStorage.setItem('mock_reservations', JSON.stringify(localRes));
          window.dispatchEvent(new Event('local-reservations-change'));
          alert("✅ 해당 예약이 최종 확정되었습니다 (가상 모드).");
          loadReservations();
        }
      }
    }
  }

  // 6. 예약 보류/대기(status -> pending) 변경 트랜잭션
  function pendingReservation(key) {
    if (confirm("해당 예약을 다시 '대기 상태(보류)'로 돌려놓으시겠습니까?")) {
      if (useFirebase && db) {
        try {
          const targetRef = ref(db, `reservations/${key}`);
          update(targetRef, { status: "pending" })
            .then(() => {
              alert("⏰ 예약이 대기 상태로 변경되었습니다.");
            })
            .catch(err => alert("변경 실패: " + err.message));
        } catch (err) {
          alert("DB 처리 오류: " + err.message);
        }
      } else {
        // 로컬 모드 상태 변경
        let localRes = JSON.parse(localStorage.getItem('mock_reservations') || '[]');
        const index = parseInt(key.replace('mock_key_', ''), 10);
        if (localRes[index]) {
          localRes[index].status = "pending";
          localStorage.setItem('mock_reservations', JSON.stringify(localRes));
          window.dispatchEvent(new Event('local-reservations-change'));
          alert("⏰ 예약이 대기 상태로 변경되었습니다 (가상 모드).");
          loadReservations();
        }
      }
    }
  }

  // 7. 예약 취소(데이터 삭제) 트랜잭션
  function deleteReservation(key, date) {
    if (confirm(`⚠️ 경고: [${date}] 예약 내역을 영구 삭제하시겠습니까?\n삭제된 내역은 복구되지 않습니다.`)) {
      if (useFirebase && db) {
        try {
          const targetRef = ref(db, `reservations/${key}`);
          remove(targetRef)
            .then(() => {
              alert("🗑️ 예약 내역이 성공적으로 삭제되었습니다.");
            })
            .catch(err => alert("삭제 실패: " + err.message));
        } catch (err) {
          alert("DB 처리 오류: " + err.message);
        }
      } else {
        // 로컬 모드 삭제 처리
        let localRes = JSON.parse(localStorage.getItem('mock_reservations') || '[]');
        const index = parseInt(key.replace('mock_key_', ''), 10);
        if (index >= 0 && index < localRes.length) {
          localRes.splice(index, 1);
          localStorage.setItem('mock_reservations', JSON.stringify(localRes));
          window.dispatchEvent(new Event('local-reservations-change'));
          alert("🗑️ 예약 내역이 성공적으로 삭제되었습니다 (가상 모드).");
          loadReservations();
        }
      }
    }
  }

  // 8. 파이어베이스 인증 세션 옵저빙 (로그인 시 대시보드 노출 제어)
  if (useFirebase && auth) {
    onAuthStateChanged(auth, (user) => {
      if (user) {
        // 로그인 완료 상태일 때, 관리자 계정 이메일 인증 체크
        if (adminEmails.includes(user.email)) {
          loginOverlay.style.display = 'none';
          loadReservations();
        } else {
          // 관리자가 아닌 일반 유저가 로그인했을 때 로그아웃 유도
          alert("🚨 관리자 이메일로 등록되지 않은 계정입니다. 관리자 전용 대시보드 접근이 제한됩니다.");
          signOut(auth);
        }
      } else {
        // 로그아웃 상태일 때 로그인창 노출
        loginOverlay.style.display = 'flex';
        if (activeReservationsListener) {
          activeReservationsListener();
          activeReservationsListener = null;
        }
      }
    });
  } else {
    // 가상 모드 로그인 세션 영속성 체크
    const adminLoggedIn = localStorage.getItem('admin_logged_in');
    if (adminLoggedIn === 'true') {
      loginOverlay.style.display = 'none';
      loadReservations();
    } else {
      loginOverlay.style.display = 'flex';
    }
  }
});
