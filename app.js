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
    console.warn('클라우드 예약 현황 조회 오류:', err);
    return null;
  }
}

async function appendCloudReservation(newReservation) {
  try {
    const existing = (await fetchCloudReservations()) || {};
    const key = `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    existing[key] = newReservation;

    const packed = packReservations(existing);
    const encoded = encodeBase64Utf8(JSON.stringify(packed));
    const chunks = [];
    for (let i = 0; i < encoded.length; i += CLOUD_CHUNK_SIZE) {
      chunks.push(encoded.slice(i, i + CLOUD_CHUNK_SIZE));
    }
    if (chunks.length > CLOUD_SHARD_MAX) return false;

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
  } catch (err) {
    console.warn('클라우드 예약 등록 백업 오류:', err);
    return false;
  }
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
      featureItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
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
  
  const estDayType = document.getElementById('est-day-type');
  const estTimeType = document.getElementById('est-time-type');
  const estHours = document.getElementById('est-hours');
  const modalSummaryPrice = document.getElementById('modal-summary-price');

  function calculatePrice() {
    const isWeekend = dayWeekend.checked;
    const isNight = timeNight.checked;
    
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
      if (!isNight) {
        totalPrice = hours * 25000;
        estTimeType.textContent = "이용 시간대: 주간 (10:00 - 18:00)";
      } else {
        const blocks = Math.ceil(hours / 3);
        totalPrice = blocks * 150000;
        estTimeType.textContent = `이용 시간대: 야간 (3시간 단위 요금제, 총 ${blocks}타임 적용)`;
      }
      estDayType.textContent = "이용 요일: 주중 (월~목)";
    } else {
      if (!isNight) {
        totalPrice = hours * 36000;
        estTimeType.textContent = "이용 시간대: 주간 (10:00 - 18:00)";
      } else {
        if (hours === 6) {
          totalPrice = 300000;
        } else {
          totalPrice = hours * 50000;
        }
        estTimeType.textContent = "이용 시간대: 야간 6시간 자유 이용 (새벽 2시 퇴실)";
      }
      estDayType.textContent = "이용 요일: 주말 (금~일)";
    }
    
    hoursLabel.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> 대여 시간: ${hours}시간`;
    estHours.textContent = `총 이용 시간: ${hours}시간`;
    
    const formattedPrice = totalPrice.toLocaleString('ko-KR');
    priceDisplay.textContent = formattedPrice;
    modalSummaryPrice.textContent = formattedPrice;
  }

  [dayWeekday, dayWeekend, timeDay, timeNight].forEach(input => {
    input.addEventListener('change', calculatePrice);
  });
  hoursRange.addEventListener('input', calculatePrice);

  calculatePrice();

  // =========================================================================
  // 4. Booking Modal Toggle & Seamless Submission Flow
  // =========================================================================
  const bookingModal = document.getElementById('booking-modal');
  const modalCloseBtn = document.querySelector('.modal-close-btn');
  const bookingTriggers = document.querySelectorAll('.btn-booking-trigger');
  const bookingForm = document.getElementById('booking-form');
  const bookingSuccessView = document.getElementById('booking-success-view');
  const bookingClipboardPreview = document.getElementById('booking-clipboard-preview');
  const btnReCopy = document.getElementById('btn-re-copy');

  const defaultBookedDates = [];
  let dynamicBookedDates = [];

  function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(() => {
        return fallbackCopyTextToClipboard(text);
      });
    } else {
      return fallbackCopyTextToClipboard(text);
    }
  }

  function fallbackCopyTextToClipboard(text) {
    return new Promise((resolve, reject) => {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.top = "-9999px";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful) resolve();
        else reject(new Error('Copy command failed'));
      } catch (err) {
        document.body.removeChild(textArea);
        reject(err);
      }
    });
  }

  const bookingDateInput = document.getElementById('booking-date');
  if (bookingDateInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    bookingDateInput.value = `${yyyy}-${mm}-${dd}`;
    bookingDateInput.min = `${yyyy}-${mm}-${dd}`;

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

  function openBookingModal() {
    if (bookingForm) bookingForm.style.display = 'block';
    if (bookingSuccessView) bookingSuccessView.style.display = 'none';
    bookingModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    bookingModal.classList.remove('active');
    document.body.style.overflow = '';
  }

  bookingTriggers.forEach(btn => {
    btn.addEventListener('click', openBookingModal);
  });

  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeModal);
  }

  bookingModal.addEventListener('click', (e) => {
    if (e.target === bookingModal) {
      closeModal();
    }
  });

  if (btnReCopy && bookingClipboardPreview) {
    btnReCopy.addEventListener('click', () => {
      copyTextToClipboard(bookingClipboardPreview.value).then(() => {
        alert("📋 예약 신청서가 클립보드에 다시 복사되었습니다!");
      }).catch(() => {
        bookingClipboardPreview.select();
        alert("텍스트를 직접 복사(Ctrl+C)해 주세요.");
      });
    });
  }

  bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const agreeRules = document.getElementById('agree-rules');
    if (agreeRules && !agreeRules.checked) {
      alert("이용 규정에 동의하셔야 예약 신청이 가능합니다.");
      return;
    }

    const isDdanddara = window.location.pathname.includes('ddanddara');
    const brandName = isDdanddara ? '딴따라 공간대여' : '스폰지 파티룸';

    const name = document.getElementById('user-name').value;
    const phone = document.getElementById('user-phone').value;
    const date = document.getElementById('booking-date').value;
    const guests = document.getElementById('guest-count').value;
    const note = document.getElementById('booking-note').value || '없음';
    const summaryPrice = modalSummaryPrice.textContent;

    const totalBooked = [...defaultBookedDates, ...dynamicBookedDates];
    if (totalBooked.includes(date)) {
      alert("⚠️ 선택하신 날짜는 이미 예약이 마감되었습니다. 다른 날짜를 선택해 주세요.");
      return;
    }

    const newReservationData = {
      name: name,
      phone: phone,
      date: date,
      guests: guests,
      note: note,
      price: summaryPrice,
      brand: brandName,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    if (useFirebase && db) {
      try {
        const reservationsRef = ref(db, 'reservations');
        const newResRef = push(reservationsRef);
        set(newResRef, newReservationData).catch(() => {
          appendCloudReservation(newReservationData);
        });
      } catch (err) {
        appendCloudReservation(newReservationData);
      }
    } else {
      appendCloudReservation(newReservationData);
    }

    // 로컬 가상 모드 백업 저장
    try {
      let mockReservations = JSON.parse(localStorage.getItem('mock_reservations') || '[]');
      mockReservations.push(newReservationData);
      localStorage.setItem('mock_reservations', JSON.stringify(mockReservations));
      window.dispatchEvent(new Event('local-reservations-change'));
    } catch (e) {
      console.warn("LocalStorage 저장 오류:", e);
    }
    
    const clipboardText = `[${brandName} 예약 신청서]
• 예약자: ${name}님
• 연락처: ${phone}
• 이용 날짜: ${date}
• 이용 인원: ${guests}명
• 예상 금액: ₩${summaryPrice}
• 추가 요청사항: ${note}

※ 카카오톡 채널 채팅방이 열리면 이 내용을 그대로 붙여넣기(Ctrl+V 또는 꾹 눌러 붙여넣기)하여 전송해 주세요.`;

    copyTextToClipboard(clipboardText).finally(() => {
      if (bookingClipboardPreview) {
        bookingClipboardPreview.value = clipboardText;
      }
      bookingForm.style.display = 'none';
      if (bookingSuccessView) {
        bookingSuccessView.style.display = 'block';
      }
      bookingForm.reset();
    });
  });

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

  if (authToggleBtn) {
    authToggleBtn.addEventListener('click', () => {
      authModal.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  }

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

  setupAuthStateListener((user) => {
    if (user) {
      if (userProfileBadge) userProfileBadge.style.display = 'flex';
      if (userNicknameDisplay) userNicknameDisplay.textContent = user.displayName;
      if (authToggleBtn) authToggleBtn.style.display = 'none';

      if (userNameInput) {
        userNameInput.value = user.displayName;
        userNameInput.readOnly = true;
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
    }, 4000);
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

    document.addEventListener('click', (e) => {
      if (!mobileNav.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        mobileNav.classList.remove('active');
        const icon = mobileMenuBtn.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-bars';
      }
    });

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

  let calendarDate = new Date();
  let rtdbBookDates = [];
  let cloudBookDates = [];

  function extractConfirmedDates(dataObjOrArr) {
    const dates = new Set();
    if (!dataObjOrArr) return [];
    const values = Array.isArray(dataObjOrArr) ? dataObjOrArr : Object.values(dataObjOrArr);
    values.forEach((res) => {
      if (res && res.status === 'confirmed' && res.date) {
        dates.add(res.date);
      }
    });
    return Array.from(dates);
  }

  function getLocalConfirmedDates() {
    try {
      const localRes = JSON.parse(localStorage.getItem('mock_reservations') || '[]');
      const objRes = JSON.parse(localStorage.getItem('sponge_reservations_obj') || '{}');
      return Array.from(new Set([
        ...extractConfirmedDates(localRes),
        ...extractConfirmedDates(objRes)
      ]));
    } catch (_) {
      return [];
    }
  }

  function rebuildDynamicBookedDates() {
    const localDates = getLocalConfirmedDates();
    dynamicBookedDates = Array.from(new Set([
      ...rtdbBookDates,
      ...cloudBookDates,
      ...localDates
    ]));
    renderCalendar();
  }

  async function refreshCloudBookedDates() {
    const cloudData = await fetchCloudReservations();
    if (cloudData !== null) {
      cloudBookDates = extractConfirmedDates(cloudData);
      try {
        localStorage.setItem('sponge_reservations_obj', JSON.stringify(cloudData));
      } catch (_) {}
      rebuildDynamicBookedDates();
    }
  }

  function syncBookedDates() {
    rebuildDynamicBookedDates();
    refreshCloudBookedDates();

    if (useFirebase && db) {
      try {
        const reservationsRef = ref(db, 'reservations');
        onValue(
          reservationsRef,
          (snapshot) => {
            const data = snapshot.val();
            rtdbBookDates = extractConfirmedDates(data);
            rebuildDynamicBookedDates();
          },
          () => {
            refreshCloudBookedDates();
          }
        );
      } catch (_) {
        refreshCloudBookedDates();
      }
    }

    window.addEventListener('local-reservations-change', rebuildDynamicBookedDates);
    window.addEventListener('storage', rebuildDynamicBookedDates);
    window.addEventListener('focus', refreshCloudBookedDates);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshCloudBookedDates();
      }
    });
    setInterval(refreshCloudBookedDates, 15000);
  }

  function renderCalendar() {
    if (!calendarDaysGrid || !currentMonthYearLabel) return;

    calendarDaysGrid.innerHTML = '';
    const currentYear = calendarDate.getFullYear();
    const currentMonth = calendarDate.getMonth();

    currentMonthYearLabel.textContent = `${currentYear}년 ${currentMonth + 1}월`;

    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
    const lastDate = new Date(currentYear, currentMonth + 1, 0).getDate();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const totalBookedDates = [...defaultBookedDates, ...dynamicBookedDates];

    for (let i = 0; i < firstDayIndex; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'calendar-day-cell empty-cell';
      calendarDaysGrid.appendChild(emptyCell);
    }

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

      const cellDateObj = new Date(currentYear, currentMonth, day);
      const todayDateObj = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      if (cellDateObj < todayDateObj || totalBookedDates.includes(dateStr)) {
        dayCell.classList.add('status-booked');
      } else {
        dayCell.classList.add('status-available');
        
        dayCell.addEventListener('click', () => {
          const bookingDateInput = document.getElementById('booking-date');
          const bookingModal = document.getElementById('booking-modal');
          
          if (bookingDateInput) {
            bookingDateInput.value = dateStr;
          }
          if (bookingModal) {
            if (bookingForm) bookingForm.style.display = 'block';
            if (bookingSuccessView) bookingSuccessView.style.display = 'none';
            bookingModal.classList.add('active');
            document.body.style.overflow = 'hidden';
          }
        });
      }

      calendarDaysGrid.appendChild(dayCell);
    }
  }

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

  syncBookedDates();
});
