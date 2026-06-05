import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getDatabase, ref, set, push, onValue, remove, update } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

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

let authService = null;
let db = null;
let useFirebase = false;

// Firebase 설정 값 유효성 체크 및 초기화
if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY" && firebaseConfig.apiKey.trim() !== "") {
  try {
    const app = initializeApp(firebaseConfig);
    authService = getAuth(app);
    db = getDatabase(app);
    useFirebase = true;
    console.log("Firebase Auth 및 Realtime Database가 정상 연동되었습니다.");
  } catch (err) {
    console.error("Firebase 초기화 실패, 로컬 임시 인증 모드로 대체합니다:", err);
  }
} else {
  console.log("Firebase API Key가 예시용 값입니다. 브라우저 내부 가상 로그인 모드로 정상 작동합니다.");
}

// -------------------------------------------------------------------------
// 회원 가입 및 로그인 공통 인터페이스 (하이브리드 모드 지원)
// -------------------------------------------------------------------------
function registerUser(nickname, email, password) {
  if (useFirebase && authService) {
    return createUserWithEmailAndPassword(authService, email, password)
      .then((userCredential) => {
        return updateProfile(userCredential.user, {
          displayName: nickname
        }).then(() => userCredential.user);
      });
  } else {
    return new Promise((resolve, reject) => {
      let users = JSON.parse(localStorage.getItem('mock_users') || '[]');
      if (users.find(u => u.email === email)) {
        reject(new Error("이미 가입된 이메일 주소입니다."));
        return;
      }
      const newUser = { nickname, email, password };
      users.push(newUser);
      localStorage.setItem('mock_users', JSON.stringify(users));
      localStorage.setItem('mock_current_user', JSON.stringify(newUser));
      window.dispatchEvent(new Event('local-auth-change'));
      resolve(newUser);
    });
  }
}

function loginUser(email, password) {
  if (useFirebase && authService) {
    return signInWithEmailAndPassword(authService, email, password)
      .then((userCredential) => userCredential.user);
  } else {
    return new Promise((resolve, reject) => {
      let users = JSON.parse(localStorage.getItem('mock_users') || '[]');
      const user = users.find(u => u.email === email && u.password === password);
      if (user) {
        localStorage.setItem('mock_current_user', JSON.stringify(user));
        window.dispatchEvent(new Event('local-auth-change'));
        resolve(user);
      } else {
        reject(new Error("이메일 또는 비밀번호가 잘못되었습니다."));
      }
    });
  }
}

function logoutUser() {
  if (useFirebase && authService) {
    return signOut(authService);
  } else {
    return new Promise((resolve) => {
      localStorage.removeItem('mock_current_user');
      window.dispatchEvent(new Event('local-auth-change'));
      resolve();
    });
  }
}

function setupAuthStateListener(callback) {
  if (useFirebase && authService) {
    onAuthStateChanged(authService, (user) => {
      if (user) {
        callback({
          email: user.email,
          displayName: user.displayName || '회원'
        });
      } else {
        callback(null);
      }
    });
  } else {
    const checkLocal = () => {
      const currentUser = JSON.parse(localStorage.getItem('mock_current_user'));
      if (currentUser) {
        callback({
          email: currentUser.email,
          displayName: currentUser.nickname || '회원'
        });
      } else {
        callback(null);
      }
    };
    checkLocal();
    window.addEventListener('local-auth-change', checkLocal);
  }
}

document.addEventListener('DOMContentLoaded', () => {

  // =========================================================================
  // 1. Header Scroll Effect
  // =========================================================================
  const header = document.getElementById('header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });

  // =========================================================================
  // 2. Interactive Feature Visual Selector
  // =========================================================================
  const featureItems = document.querySelectorAll('.feature-item');
  const featureImgDisplay = document.getElementById('feature-img-display');
  
  const featureVisuals = {
    'feature-1': {
      glowColor: '#9d4edd',
      bg: 'url("./images/photo_18.png") center/cover no-repeat'
    },
    'feature-2': {
      glowColor: '#e0aaff',
      bg: 'url("./images/photo_20.jpg") center/cover no-repeat'
    },
    'feature-3': {
      glowColor: '#ffb703',
      bg: 'url("./images/photo_17.jpg") center/cover no-repeat'
    }
  };

  featureItems.forEach(item => {
    item.addEventListener('click', () => {
      // Remove active from all
      featureItems.forEach(i => i.classList.remove('active'));
      // Add active to clicked
      item.classList.add('active');
      
      // Update visual display
      const imageKey = item.getAttribute('data-image');
      const visual = featureVisuals[imageKey];
      
      if (visual) {
        featureImgDisplay.style.background = visual.bg;
        featureImgDisplay.innerHTML = `
          <div class="blur-glow-effect" style="background-color: ${visual.glowColor}; opacity: 0.15;"></div>
        `;
      }
    });
  });

  // =========================================================================
  // 3. Realtime Rental Price Calculator
  // =========================================================================
  const dayWeekday = document.getElementById('day-weekday');
  const dayWeekend = document.getElementById('day-weekend');
  const timeDay = document.getElementById('time-day');
  const timeNight = document.getElementById('time-night');
  const hoursRange = document.getElementById('rent-hours-range');
  const hoursLabel = document.getElementById('hours-label');
  const priceDisplay = document.getElementById('calculated-price-amount');
  
  // Estimate labels
  const estDayType = document.getElementById('est-day-type');
  const estTimeType = document.getElementById('est-time-type');
  const estHours = document.getElementById('est-hours');
  const modalSummaryPrice = document.getElementById('modal-summary-price');

  // Rules based pricing calculator
  function calculatePrice() {
    const isWeekend = dayWeekend.checked;
    const isNight = timeNight.checked;
    
    // Dynamic slider limits validation
    const rangeHint = document.querySelector('.range-hint');
    let minHours = 2;
    let hintText = "최소 2시간부터 최대 8시간까지 연장 가능";

    if (isWeekend) {
      if (isNight) {
        minHours = 6;
        hintText = "주말 야간은 최소 6시간부터 최대 8시간까지 예약 가능합니다.";
      } else {
        minHours = 5;
        hintText = "주말 주간은 기본 5시간(최대 8시간) 대여 요금제가 적용됩니다.";
      }
    } else {
      if (isNight) {
        minHours = 3;
        hintText = "주중 야간은 최소 3시간부터 3시간 단위(15만원)로 예약 가능합니다.";
      }
    }

    hoursRange.min = minHours;
    if (parseInt(hoursRange.value, 10) < minHours) {
      hoursRange.value = minHours;
    }
    rangeHint.textContent = hintText;

    const hours = parseInt(hoursRange.value, 10);
    let totalPrice = 0;
    
    if (!isWeekend) {
      // Weekday (주중)
      if (!isNight) {
        // Day (주간) - Hourly 25k KRW (2 hours = 50k, 3 hours = 75k, 4 hours = 100k)
        totalPrice = hours * 25000;
        estTimeType.textContent = "이용 시간대: 주간 (10:00 - 18:00)";
      } else {
        // Night (야간) - 3시간 단위 블록 요금제 (3시간=15만, 4시간=30만, 7시간=45만)
        const blocks = Math.ceil(hours / 3);
        totalPrice = blocks * 150000;
        estTimeType.textContent = `이용 시간대: 야간 (3시간 단위 요금제, 총 ${blocks}타임 적용)`;
      }
      estDayType.textContent = "이용 요일: 주중 (월~목)";
    } else {
      // Weekend (주말)
      if (!isNight) {
        // Day (주간) - 5 hours = 180k KRW (Approx 36k per hour)
        totalPrice = hours * 36000;
        estTimeType.textContent = "이용 시간대: 주간 (10:00 - 18:00)";
      } else {
        // Night (야간) - Weekend All Night (6 hours) package flat 300,000 KRW
        if (hours === 6) {
          totalPrice = 300000;
        } else {
          totalPrice = hours * 50000;
        }
        estTimeType.textContent = "이용 시간대: 야간 6시간 자유 이용 (새벽 2시 퇴실)";
      }
      estDayType.textContent = "이용 요일: 주말 (금~일)";
    }
    
    // Formatting values
    hoursLabel.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> 대여 시간: ${hours}시간`;
    estHours.textContent = `총 이용 시간: ${hours}시간`;
    
    const formattedPrice = totalPrice.toLocaleString('ko-KR');
    priceDisplay.textContent = formattedPrice;
    modalSummaryPrice.textContent = formattedPrice;
  }

  // Bind calculation events
  [dayWeekday, dayWeekend, timeDay, timeNight].forEach(input => {
    input.addEventListener('change', calculatePrice);
  });
  hoursRange.addEventListener('input', calculatePrice);

  // Initialize Calculator on load
  calculatePrice();

  // =========================================================================
  // 4. Booking Modal Toggle
  // =========================================================================
  const bookingModal = document.getElementById('booking-modal');
  const modalCloseBtn = document.querySelector('.modal-close-btn');
  const bookingTriggers = document.querySelectorAll('.btn-booking-trigger');
  const bookingForm = document.getElementById('booking-form');

  // 오늘 날짜로 기본값 설정 (YYYY-MM-DD 형식) 및 클릭 시 달력 팝업 노출
  const bookingDateInput = document.getElementById('booking-date');
  if (bookingDateInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    bookingDateInput.value = `${yyyy}-${mm}-${dd}`;

    // 입력란 클릭 시 달력 선택기 강제 호출
    bookingDateInput.addEventListener('click', () => {
      if (typeof bookingDateInput.showPicker === 'function') {
        try {
          bookingDateInput.showPicker();
        } catch (err) {
          console.error("showPicker failed:", err);
        }
      }
    });
  }

  bookingTriggers.forEach(btn => {
    btn.addEventListener('click', () => {
      bookingModal.classList.add('active');
      document.body.style.overflow = 'hidden'; // Lock background scroll
    });
  });

  function closeModal() {
    bookingModal.classList.remove('active');
    document.body.style.overflow = ''; // Unlock scroll
  }

  // =========================================================================
  // 4-2. Auth Modal (Login/Signup) Toggle & Form Handle
  // =========================================================================
  const authModal = document.getElementById('auth-modal');
  const authToggleBtn = document.getElementById('btn-auth-toggle');
  const authCloseBtn = document.getElementById('btn-auth-close');
  const authTabs = document.querySelectorAll('.auth-tab-btn');
  const authContents = document.querySelectorAll('.auth-tab-content');
  
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  
  const userProfileBadge = document.getElementById('user-profile-badge');
  const userNicknameDisplay = document.getElementById('user-nickname-display');
  const userNameInput = document.getElementById('user-name');

  // 모달 열기
  if (authToggleBtn) {
    authToggleBtn.addEventListener('click', () => {
      authModal.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  }

  // 모달 닫기
  function closeAuthModal() {
    authModal.classList.remove('active');
    document.body.style.overflow = '';
  }
  if (authCloseBtn) {
    authCloseBtn.addEventListener('click', closeAuthModal);
  }
  if (authModal) {
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) {
        closeAuthModal();
      }
    });
  }

  // 로그인/회원가입 탭 토글 전환
  authTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      authTabs.forEach(t => t.classList.remove('active'));
      authContents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      const targetContent = document.getElementById(tab.getAttribute('data-tab'));
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });

  // 회원가입 핸들러
  if (signupForm) {
    signupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nickname = document.getElementById('signup-nickname').value;
      const email = document.getElementById('signup-email').value;
      const password = document.getElementById('signup-password').value;
      const passwordConfirm = document.getElementById('signup-password-confirm').value;

      if (password !== passwordConfirm) {
        alert("비밀번호가 일치하지 않습니다. 다시 확인해 주세요.");
        return;
      }
      if (password.length < 6) {
        alert("보안을 위해 비밀번호는 6자리 이상으로 입력해 주세요.");
        return;
      }

      registerUser(nickname, email, password)
        .then(() => {
          alert(`🎉 회원가입 및 로그인이 성공적으로 완료되었습니다!\n${nickname}님, 환영합니다!`);
          signupForm.reset();
          closeAuthModal();
        })
        .catch(err => {
          alert(`가입 중 오류 발생: ${err.message}`);
        });
    });
  }

  // 로그인 핸들러
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;

      loginUser(email, password)
        .then(() => {
          alert("🔓 로그인이 완료되었습니다.");
          loginForm.reset();
          closeAuthModal();
        })
        .catch(err => {
          alert(`로그인 실패: ${err.message}`);
        });
    });
  }

  // 프로필 배지 클릭 시 로그아웃
  if (userProfileBadge) {
    userProfileBadge.style.cursor = 'pointer';
    userProfileBadge.addEventListener('click', () => {
      if (confirm("로그아웃 하시겠습니까?")) {
        logoutUser().then(() => {
          alert("로그아웃 되었습니다.");
        });
      }
    });
  }

  // 실시간 인증 세션 감지 및 UI 렌더링 동기화
  setupAuthStateListener((user) => {
    if (user) {
      if (userProfileBadge) userProfileBadge.style.display = 'flex';
      if (userNicknameDisplay) userNicknameDisplay.textContent = user.displayName;
      if (authToggleBtn) authToggleBtn.style.display = 'none';

      // 예약 모달 오픈 시 성함 자동 채우기
      if (userNameInput) {
        userNameInput.value = user.displayName;
        userNameInput.readOnly = true; // 로그인 정보 연동으로 편집 불가 처리
      }
    } else {
      if (userProfileBadge) userProfileBadge.style.display = 'none';
      if (authToggleBtn) authToggleBtn.style.display = 'block';
      if (userNameInput) {
        userNameInput.value = '';
        userNameInput.readOnly = false;
      }
    }
  });

  modalCloseBtn.addEventListener('click', closeModal);
  
  // Close modal when clicking on the overlay shadow
  bookingModal.addEventListener('click', (e) => {
    if (e.target === bookingModal) {
      closeModal();
    }
  });

  // Initialize Kakao SDK
  const KAKAO_APP_KEY = '508f4903c8bd16d633c6251d8a945ed7'; // User's Kakao developers JS App Key
  if (window.Kakao) {
    try {
      if (!window.Kakao.isInitialized()) {
        window.Kakao.init(KAKAO_APP_KEY);
      }
    } catch (err) {
      console.error("Kakao SDK init failed:", err);
    }
  }

  // Handle Form Submission
  bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const name = document.getElementById('user-name').value;
    const phone = document.getElementById('user-phone').value;
    const date = document.getElementById('booking-date').value;
    const guests = document.getElementById('guest-count').value;
    const note = document.getElementById('booking-note').value || '없음';
    const summaryPrice = modalSummaryPrice.textContent;

    // Realtime Database 예약 데이터 업로드
    if (useFirebase && db) {
      try {
        const reservationsRef = ref(db, 'reservations');
        const newResRef = push(reservationsRef);
        set(newResRef, {
          name: name,
          phone: phone,
          date: date,
          guests: guests,
          note: note,
          price: summaryPrice,
          status: "pending", // 초기 대기 중 상태
          createdAt: new Date().toISOString()
        });
        console.log("예약 정보가 Realtime Database에 저장되었습니다.");
      } catch (err) {
        console.error("Realtime DB 저장 실패:", err);
      }
    } else {
      // 로컬 가상 모드 백업 저장
      let mockReservations = JSON.parse(localStorage.getItem('mock_reservations') || '[]');
      mockReservations.push({
        name, phone, date, guests, note, price: summaryPrice, status: "pending", createdAt: new Date().toISOString()
      });
      localStorage.setItem('mock_reservations', JSON.stringify(mockReservations));
      // 로컬 달력 상태 갱신 이벤트 트리거
      window.dispatchEvent(new Event('local-reservations-change'));
    }
    
    // 클립보드에 복사할 정갈한 예약 템플릿 텍스트 생성
    const clipboardText = `[스폰지 파티룸 예약 신청서]
• 예약자: ${name}님
• 연락처: ${phone}
• 이용 날짜: ${date}
• 이용 인원: ${guests}명
• 예상 금액: ₩${summaryPrice}
• 추가 요청사항: ${note}

※ 카카오톡 채널 채팅방이 열리면 이 내용을 그대로 붙여넣기(Ctrl+V 또는 꾹 눌러 붙여넣기)하여 전송해 주세요.`;

    // 사용자의 클립보드에 예약 텍스트 복사
    navigator.clipboard.writeText(clipboardText).then(() => {
      alert(`🎉 예약 신청서 정보가 클립보드에 자동으로 복사되었습니다!\n\n확인 버튼을 누르시면 [스폰지 파티룸] 카카오톡 채널 1:1 대화방으로 이동합니다. 대화창에 '붙여넣기(Ctrl+V)' 하셔서 전송 버튼을 눌러주세요.`);
      
      // 카카오 채널 1:1 대화방 링크 연결 (Kakao SDK 기반 실행)
      if (window.Kakao && window.Kakao.isInitialized()) {
        try {
          window.Kakao.Channel.chat({
            channelPublicId: '_jxjGxgn'
          });
        } catch (err) {
          console.error("Kakao Channel chat failed, fallback to url", err);
          window.open('http://pf.kakao.com/_jxjGxgn/chat', '_blank');
        }
      } else {
        window.open('http://pf.kakao.com/_jxjGxgn/chat', '_blank');
      }
      
      bookingForm.reset();
      closeModal();
    }).catch(err => {
      console.error('Clipboard copy failed: ', err);
      // 클립보드 복사 실패 시 폴백 처리
      alert(`🎉 예약 신청이 접수되었습니다. 아래 예약 내용을 복사하여 카카오톡 대화방에 전송해 주세요:\n\n${clipboardText}`);
      window.open('http://pf.kakao.com/_jxjGxgn/chat', '_blank');
      
      bookingForm.reset();
      closeModal();
    });
  });

  // =========================================================================
  // 5. 메인 비주얼 히어로 이미지 페이드 슬라이더 (3장 이미지 순환)
  // =========================================================================
  const heroSlides = document.querySelectorAll('.visual-image-slider .slide');
  if (heroSlides.length > 0) {
    let currentSlideIndex = 0;
    setInterval(() => {
      heroSlides[currentSlideIndex].classList.remove('active');
      currentSlideIndex = (currentSlideIndex + 1) % heroSlides.length;
      heroSlides[currentSlideIndex].classList.add('active');
    }, 4000); // 4초 간격 페이드
  }

  // =========================================================================
  // 6. 모바일 메뉴 (햄버거 버튼) 토글 및 링크 자동 닫기
  // =========================================================================
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const mobileNav = document.getElementById('mobile-nav');
  const mobileNavItems = document.querySelectorAll('.mobile-nav-item');

  if (mobileMenuBtn && mobileNav) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mobileNav.classList.toggle('active');
      const icon = mobileMenuBtn.querySelector('i');
      if (mobileNav.classList.contains('active')) {
        icon.className = 'fa-solid fa-xmark';
      } else {
        icon.className = 'fa-solid fa-bars';
      }
    });

    // 외부 영역 클릭 시 드롭다운 닫기
    document.addEventListener('click', (e) => {
      if (!mobileNav.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        mobileNav.classList.remove('active');
        const icon = mobileMenuBtn.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-bars';
      }
    });

    // 메뉴 항목 선택 시 자동으로 메뉴 닫기
    mobileNavItems.forEach(item => {
      item.addEventListener('click', () => {
        mobileNav.classList.remove('active');
        const icon = mobileMenuBtn.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-bars';
      });
    });
  }

  // =========================================================================
  // 7. 실시간 예약 현황 달력 동적 렌더링 및 모달 연동
  // =========================================================================
  const calendarDaysGrid = document.getElementById('calendar-days-grid');
  const currentMonthYearLabel = document.getElementById('current-month-year');
  const prevMonthBtn = document.getElementById('prev-month-btn');
  const nextMonthBtn = document.getElementById('next-month-btn');

  // 예약 마감(완료) 날짜 목록 설정 (기본 수동 지정 날짜들 제거 - DB로 일원화)
  const defaultBookedDates = [];
  let dynamicBookedDates = []; // DB 또는 LocalStorage에서 로드된 예약 확정 날짜들

  let calendarDate = new Date(); // 달력에서 현재 가리키는 날짜 기준

  // 실시간 예약일 정보 감지 및 연동
  function syncBookedDates() {
    if (useFirebase && db) {
      try {
        const reservationsRef = ref(db, 'reservations');
        onValue(reservationsRef, (snapshot) => {
          dynamicBookedDates = [];
          const data = snapshot.val();
          if (data) {
            Object.values(data).forEach(res => {
              if (res.status === "confirmed" && res.date) {
                dynamicBookedDates.push(res.date);
              }
            });
          }
          renderCalendar();
        });
      } catch (err) {
        console.error("실시간 예약 데이터 수신 실패:", err);
      }
    } else {
      // 로컬 가상 예약 데이터 동기화
      const syncLocal = () => {
        dynamicBookedDates = [];
        const localRes = JSON.parse(localStorage.getItem('mock_reservations') || '[]');
        localRes.forEach(res => {
          if (res.status === "confirmed" && res.date) {
            dynamicBookedDates.push(res.date);
          }
        });
        renderCalendar();
      };
      syncLocal();
      window.addEventListener('local-reservations-change', syncLocal);
    }
  }

  function renderCalendar() {
    if (!calendarDaysGrid || !currentMonthYearLabel) return;

    calendarDaysGrid.innerHTML = '';
    const currentYear = calendarDate.getFullYear();
    const currentMonth = calendarDate.getMonth(); // 0 ~ 11

    // 헤더 연/월 표시 업데이트
    currentMonthYearLabel.textContent = `${currentYear}년 ${currentMonth + 1}월`;

    // 이번 달의 첫째 날과 마지막 날 정보
    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay(); // 요일 인덱스 (0:일 ~ 6:토)
    const lastDate = new Date(currentYear, currentMonth + 1, 0).getDate(); // 이번 달 마지막 날짜

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 전체 예약 완료 리스트 = 기본 지정 날짜 + 실시간 로드된 날짜
    const totalBookedDates = [...defaultBookedDates, ...dynamicBookedDates];

    // 1. 첫째 날 이전의 빈 셀 채우기
    for (let i = 0; i < firstDayIndex; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'calendar-day-cell empty-cell';
      calendarDaysGrid.appendChild(emptyCell);
    }

    // 2. 일자별 셀 생성 및 예약 연동
    for (let day = 1; day <= lastDate; day++) {
      const dayCell = document.createElement('div');
      dayCell.className = 'calendar-day-cell';
      dayCell.textContent = day;

      const formattedMonth = String(currentMonth + 1).padStart(2, '0');
      const formattedDay = String(day).padStart(2, '0');
      const dateStr = `${currentYear}-${formattedMonth}-${formattedDay}`;

      // 오늘 날짜인지 체크
      if (dateStr === todayStr) {
        dayCell.classList.add('today-cell');
      }

      // 오늘 날짜 이전이거나 totalBookedDates 배열에 명시되어 있으면 '예약 완료'로 차단
      const cellDateObj = new Date(currentYear, currentMonth, day);
      const todayDateObj = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      if (cellDateObj < todayDateObj || totalBookedDates.includes(dateStr)) {
        dayCell.classList.add('status-booked');
      } else {
        dayCell.classList.add('status-available');
        
        // 예약 가능 날짜 클릭 시 모달창 자동 입력 및 띄우기
        dayCell.addEventListener('click', () => {
          const bookingDateInput = document.getElementById('booking-date');
          const bookingModal = document.getElementById('booking-modal');
          
          if (bookingDateInput) {
            bookingDateInput.value = dateStr;
          }
          if (bookingModal) {
            bookingModal.classList.add('active');
            document.body.style.overflow = 'hidden';
          }
        });
      }

      calendarDaysGrid.appendChild(dayCell);
    }
  }

  // 이전 달/다음 달 버튼 이벤트
  if (prevMonthBtn) {
    prevMonthBtn.addEventListener('click', () => {
      calendarDate.setMonth(calendarDate.getMonth() - 1);
      renderCalendar();
    });
  }
  if (nextMonthBtn) {
    nextMonthBtn.addEventListener('click', () => {
      calendarDate.setMonth(calendarDate.getMonth() + 1);
      renderCalendar();
    });
  }

  // 초기 렌더링 동기화 작동
  syncBookedDates();
});
