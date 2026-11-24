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

// 예약 신청 시 알림 메일을 받을 Gmail 주소
const BOOKING_NOTIFY_EMAIL = 'edusim71@gmail.com';

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
      return ['M', key, val.date || '', val.createdAt || '', val.timeSlot || '', val.createdByAdmin || '', val.manualName || '', val.phone || '-', val.note || ''];
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
      val.brand || '',
      val.timeSlot || '',
      val.createdByAdmin || '',
      val.manualName || ''
    ];
  }).filter(Boolean);
}

function unpackReservations(packedList) {
  const result = {};
  if (!Array.isArray(packedList)) return result;
  packedList.forEach((item) => {
    if (!Array.isArray(item)) return;
    if (item[0] === 'M') {
      const [, key, date, createdAt, timeSlot, createdByAdmin, manualName, phone, note] = item;
      if (key && date) {
        result[key] = {
          name: '[수동 마감]',
          phone: phone || '-',
          manualName: manualName || '',
          date,
          timeSlot: timeSlot || '',
          createdByAdmin: createdByAdmin || '',
          guests: '0',
          note: note ?? '관리자 페이지 달력에서 수동으로 예약 불가능(마감) 처리한 날짜입니다.',
          price: '0',
          status: 'confirmed',
          createdAt: createdAt || new Date().toISOString()
        };
      }
    } else if (item[0] === 'R') {
      const [, key, date, name, phone, guests, price, status, note, createdAt, brand, timeSlot, createdByAdmin, manualName] = item;
      if (key && date) {
        result[key] = {
          name: name || '예약자',
          manualName: manualName || '',
          phone: phone || '-',
          date,
          timeSlot: timeSlot || '',
          createdByAdmin: createdByAdmin || '',
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

// =========================================================================
// 공통 가격 계산 단일 함수 (계산기 & 예약창 일원화)
// =========================================================================
export function calculatePrice(dayType, timeType, hours) {
  const h = parseInt(hours, 10);
  if (isNaN(h)) return null;

  // ① 주중 주간 — 월~목 / 10:00~18:00 (최소 2시간, 시간당 25,000원)
  if (dayType === 'weekday' && timeType === 'day') {
    if (h < 2) return null;
    return h * 25000;
  }

  // ② 주중 야간 — 월~목 / 18:00 이후 (최소 3시간, 시간당 50,000원 / 기본 3시간 150,000원)
  if (dayType === 'weekday' && timeType === 'night') {
    if (h < 3) return null;
    return h * 50000;
  }

  // ③ 주말 주간 — 금~일 / 10:00~18:00 (최소 2시간, 시간당 40,000원 / 기본 2시간 80,000원)
  if (dayType === 'weekend' && timeType === 'day') {
    if (h < 2) return null;
    return h * 40000;
  }

  // ④ 주말 야간 — 금~일 / 18:00 이후 (최소 6시간, 시간당 50,000원 / 기본 6시간 300,000원)
  if (dayType === 'weekend' && timeType === 'night') {
    if (h < 6) return null;
    return h * 50000;
  }

  return null;
}

export function getMinHours(dayType, timeType) {
  if (dayType === 'weekday') {
    return timeType === 'day' ? 2 : 3;
  } else {
    return timeType === 'day' ? 2 : 6;
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
  // 3. Realtime Rental Price Calculator & Member 50,000 KRW Discount
  // =========================================================================
  const MEMBER_DISCOUNT = 50000; // 회원 가입 5만원 특별 할인 혜택
  let currentAuthUser = null;

  const dayWeekday = document.getElementById('day-weekday');
  const dayWeekend = document.getElementById('day-weekend');
  const timeDay = document.getElementById('time-day');
  const timeNight = document.getElementById('time-night');
  const hoursRange = document.getElementById('rent-hours-range');
  const hoursLabel = document.getElementById('hours-label');
  const priceDisplay = document.getElementById('calculated-price-amount');
  const calcOriginalPrice = document.getElementById('calc-original-price');
  const rangeHint = document.querySelector('.range-hint');
  const calcLockOverlay = document.getElementById('calc-lock-overlay');
  
  const estDayType = document.getElementById('est-day-type');
  const estTimeType = document.getElementById('est-time-type');
  const estHours = document.getElementById('est-hours');
  const modalSummaryPrice = document.getElementById('modal-summary-price');
  const modalSummaryOption = document.getElementById('modal-summary-option');
  const modalOriginalPrice = document.getElementById('modal-original-price');

  function updateCalculator() {
    const dayType = (dayWeekend && dayWeekend.checked) ? 'weekend' : 'weekday';
    const timeType = (timeNight && timeNight.checked) ? 'night' : 'day';
    const slotSelect = document.getElementById('booking-time-slot');
    if (slotSelect) slotSelect.value = timeType === 'night' ? 'pm' : 'am';
    
    const minHours = getMinHours(dayType, timeType);

    if (hoursRange) {
      hoursRange.min = minHours;
      hoursRange.max = 8;
      if (parseInt(hoursRange.value, 10) < minHours) {
        hoursRange.value = minHours;
      }
    }

    const hours = hoursRange ? parseInt(hoursRange.value, 10) : minHours;
    const originalPrice = calculatePrice(dayType, timeType, hours);

    let hintText = "최소 2시간부터 최대 8시간까지 예약 가능";
    if (dayType === 'weekday') {
      if (timeType === 'day') {
        hintText = "주중 주간은 최소 2시간(시간당 25,000원)부터 예약 가능합니다.";
      } else {
        hintText = "주중 야간은 최소 3시간(기본 150,000원 / 추가 시간당 50,000원)부터 예약 가능합니다.";
      }
    } else {
      if (timeType === 'day') {
        hintText = "주말 주간은 최소 2시간(기본 80,000원 / 추가 시간당 40,000원)부터 예약 가능합니다.";
      } else {
        hintText = "주말 야간은 최소 6시간(기본 300,000원 / 추가 시간당 50,000원)부터 예약 가능합니다.";
      }
    }

    if (rangeHint) {
      rangeHint.textContent = hintText;
    }

    const dayLabel = dayType === 'weekday' ? '주중 (월~목)' : '주말 (금~일)';
    const timeLabel = timeType === 'day' ? '주간 (10:00 - 18:00)' : '야간 (18:00 이후)';

    if (hoursLabel) {
      hoursLabel.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> 대여 시간: ${hours}시간`;
    }
    if (estDayType) {
      estDayType.textContent = `이용 요일: ${dayLabel}`;
    }
    if (estTimeType) {
      estTimeType.textContent = `이용 시간대: ${timeLabel}`;
    }
    if (estHours) {
      estHours.textContent = `총 이용 시간: ${hours}시간`;
    }
    
    if (originalPrice === null) {
      if (priceDisplay) priceDisplay.textContent = '-';
      if (calcOriginalPrice) calcOriginalPrice.textContent = '-';
      if (modalSummaryPrice) modalSummaryPrice.textContent = '-';
      if (modalOriginalPrice) modalOriginalPrice.textContent = '';
      if (modalSummaryOption) modalSummaryOption.textContent = `해당 시간대의 최소 이용시간은 ${minHours}시간입니다.`;
    } else {
      const finalPrice = Math.max(0, originalPrice - MEMBER_DISCOUNT);
      const formattedOriginalPrice = originalPrice.toLocaleString('ko-KR');
      const formattedFinalPrice = finalPrice.toLocaleString('ko-KR');

      if (calcOriginalPrice) calcOriginalPrice.textContent = `₩${formattedOriginalPrice}`;
      if (priceDisplay) priceDisplay.textContent = formattedFinalPrice;
      if (modalSummaryPrice) modalSummaryPrice.textContent = formattedFinalPrice;
      if (modalOriginalPrice) modalOriginalPrice.textContent = `(정상가 ₩${formattedOriginalPrice})`;
      if (modalSummaryOption) {
        modalSummaryOption.textContent = `${dayLabel} / ${timeLabel.split(' ')[0]} / ${hours}시간`;
      }
    }
  }

  [dayWeekday, dayWeekend, timeDay, timeNight].forEach(input => {
    if (input) input.addEventListener('change', updateCalculator);
  });
  if (hoursRange) {
    hoursRange.addEventListener('input', updateCalculator);
  }

  updateCalculator();

  // =========================================================================
  // 4. Booking Modal Toggle & Seamless Submission Flow
  // =========================================================================
  const bookingModal = document.getElementById('booking-modal');
  const modalCloseBtn = document.querySelector('.modal-close-btn');
  const bookingTriggers = document.querySelectorAll('.btn-booking-trigger');
  const bookingForm = document.getElementById('booking-form');
  const bookingSuccessView = document.getElementById('booking-success-view');
  const btnSuccessClose = document.getElementById('btn-success-close');
  const successUserName = document.getElementById('success-user-name');
  const successDate = document.getElementById('success-date');
  const successGuests = document.getElementById('success-guests');
  const successPrice = document.getElementById('success-price');

  const defaultBookedDates = [];
  let dynamicBookedDates = [];
  const bookingTimeSlot = document.getElementById('booking-time-slot');
  function isSlotBooked(date, slot) {
    return defaultBookedDates.includes(date) || dynamicBookedDates.includes(`${date}:${slot}`);
  }
  function updateSlotAvailability() {
    if (!bookingTimeSlot) return;
    const dateInput = document.getElementById('booking-date');
    if (!dateInput) return;
    const date = dateInput.value;
    const slot = bookingTimeSlot.value;
    const past = date < dateInput.min;
    const unavailable = past || isSlotBooked(date, slot);
    const message = unavailable ? '선택한 날짜와 시간대는 예약이 마감되었습니다.' : '선택한 시간대는 예약 신청이 가능합니다.';
    const statusEl = document.getElementById('booking-slot-status');
    if (statusEl) statusEl.textContent = message;
    bookingTimeSlot.setCustomValidity(unavailable ? message : '');
    for (const option of bookingTimeSlot.options) {
      option.textContent = `${option.value === 'am' ? '주간 (10:00 - 18:00)' : '야간 (18:00 이후)'}${isSlotBooked(date, option.value) ? ' · 마감' : ''}`;
    }
  }
  if (bookingTimeSlot) {
    bookingTimeSlot.addEventListener('change', () => {
      if (timeDay) timeDay.checked = bookingTimeSlot.value === 'am';
      if (timeNight) timeNight.checked = bookingTimeSlot.value === 'pm';
      updateCalculator();
      updateSlotAvailability();
    });
  }
  [timeDay, timeNight].forEach(input => {
    if (input) input.addEventListener('change', updateSlotAvailability);
  });

  const bookingDateInput = document.getElementById('booking-date');
  if (bookingDateInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    bookingDateInput.value = `${yyyy}-${mm}-${dd}`;
    bookingDateInput.min = `${yyyy}-${mm}-${dd}`;

    bookingDateInput.addEventListener('change', updateSlotAvailability);
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
    updateCalculator();
    updateSlotAvailability();
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

  if (btnSuccessClose) {
    btnSuccessClose.addEventListener('click', closeModal);
  }

  bookingModal.addEventListener('click', (e) => {
    if (e.target === bookingModal) {
      closeModal();
    }
  });

  bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const agreeRules = document.getElementById('agree-rules');
    if (agreeRules && !agreeRules.checked) {
      alert("이용 규정에 동의하셔야 예약 신청이 가능합니다.");
      return;
    }

    const isDdanddara = window.location.pathname.includes('ddanddara');
    const brandName = isDdanddara ? '딴따라 공간대여' : '스폰지 파티룸';

    const dayType = (dayWeekend && dayWeekend.checked) ? 'weekend' : 'weekday';
    const timeType = (timeNight && timeNight.checked) ? 'night' : 'day';
    const hours = hoursRange ? parseInt(hoursRange.value, 10) : 3;
    const originalPrice = calculatePrice(dayType, timeType, hours);
    const minHours = getMinHours(dayType, timeType);

    if (originalPrice === null) {
      alert(`해당 시간대의 최소 이용시간은 ${minHours}시간입니다.`);
      return;
    }

    const finalPrice = Math.max(0, originalPrice - MEMBER_DISCOUNT);
    const dayLabel = dayType === 'weekday' ? '주중(월~목)' : '주말(금~일)';
    const timeLabel = timeType === 'day' ? '주간' : '야간';
    const summaryPrice = finalPrice.toLocaleString('ko-KR');
    const formattedOriginal = originalPrice.toLocaleString('ko-KR');
    const optionSummary = `${dayLabel} / ${timeLabel} / ${hours}시간 / ₩${summaryPrice} (5만원 할인적용)`;

    const name = document.getElementById('user-name').value;
    const phone = document.getElementById('user-phone').value;
    const date = document.getElementById('booking-date').value;
    const guests = document.getElementById('guest-count').value;
    const note = document.getElementById('booking-note').value || '없음';

    const timeSlot = bookingTimeSlot ? bookingTimeSlot.value : (timeType === 'night' ? 'pm' : 'am');
    if (bookingDateInput && (date < bookingDateInput.min || isSlotBooked(date, timeSlot))) {
      alert("⚠️ 선택하신 날짜와 시간대는 예약이 마감되었습니다. 다른 시간대를 선택해 주세요.");
      return;
    }

    const newReservationData = {
      name: name,
      phone: phone,
      date: date,
      timeSlot,
      dayType,
      timeType,
      hours,
      optionSummary,
      originalPrice: formattedOriginal,
      discount: MEMBER_DISCOUNT,
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

    // 예약 즉시 Gmail 알림 발송 (FormSubmit)
    try {
      const fullTimeLabel = timeSlot === 'am' ? '주간 (10:00 - 18:00)' : '야간 (18:00 이후)';
      fetch('https://formsubmit.co/ajax/' + BOOKING_NOTIFY_EMAIL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          _subject: `[${brandName}] 새 예약 신청 - ${name}님 ${date} ${timeSlot === 'am' ? '주간' : '야간'} (${hours}시간)`,
          _template: 'table',
          _captcha: 'false',
          '브랜드': brandName,
          '예약자': name,
          '연락처': phone,
          '이용 날짜': date,
          '이용 조건': `${dayLabel} / ${fullTimeLabel} / ${hours}시간`,
          '이용 인원': `${guests}명`,
          '결제 예상 금액': `₩${summaryPrice} (정상가 ₩${formattedOriginal}, 회원 5만원 할인 적용)`,
          '추가 요청사항': note,
          '신청 시각': new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
        }),
        keepalive: true
      }).catch(err => console.warn('예약 메일 알림 실패:', err));
    } catch (err) {
      console.warn('예약 메일 알림 오류:', err);
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

    const successOption = document.getElementById('success-option');
    if (successUserName) successUserName.textContent = name;
    if (successDate) successDate.textContent = date;
    if (successOption) successOption.textContent = `${dayLabel} ${timeLabel} ${hours}시간`;
    if (successGuests) successGuests.textContent = `${guests}명`;
    if (successPrice) successPrice.textContent = `₩${summaryPrice}`;

    if (bookingForm) bookingForm.style.display = 'none';
    if (bookingSuccessView) bookingSuccessView.style.display = 'block';
    bookingForm.reset();
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

  function openAuthModal() {
    if (authModal) {
      authModal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeAuthModal() {
    if (authModal) {
      authModal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  if (authToggleBtn) {
    authToggleBtn.addEventListener('click', openAuthModal);
  }
  document.querySelectorAll('.btn-auth-trigger').forEach(btn => {
    btn.addEventListener('click', openAuthModal);
  });

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
          alert(`🎉 축하합니다! 회원가입 완료로 50,000원 추가 할인 혜택이 적용됩니다!\n${nickname}님, 환영합니다!`);
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
          alert("🔓 로그인이 완료되었습니다. 50,000원 회원 할인이 적용됩니다.");
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
    const mobileAuthBtn = document.getElementById('mobile-auth-btn');
    if (user) {
      currentAuthUser = user;
      if (calcLockOverlay) calcLockOverlay.classList.add('hidden');
      if (userProfileBadge) userProfileBadge.style.display = 'flex';
      if (userNicknameDisplay) userNicknameDisplay.textContent = user.displayName;
      if (authToggleBtn) authToggleBtn.style.display = 'none';
      if (mobileAuthBtn) mobileAuthBtn.style.display = 'none';

      if (userNameInput) {
        userNameInput.value = user.displayName;
        userNameInput.readOnly = true;
      }
    } else {
      currentAuthUser = null;
      if (calcLockOverlay) calcLockOverlay.classList.remove('hidden');
      if (userProfileBadge) userProfileBadge.style.display = 'none';
      if (authToggleBtn) authToggleBtn.style.display = 'inline-flex';
      if (mobileAuthBtn) mobileAuthBtn.style.display = 'block';
      if (userNameInput) {
        userNameInput.value = '';
        userNameInput.readOnly = false;
      }
    }
    updateCalculator();
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
        const slots = res.timeSlot === 'am' || res.timeSlot === 'pm' ? [res.timeSlot] : ['am', 'pm'];
        slots.forEach(slot => dates.add(`${res.date}:${slot}`));
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
    updateSlotAvailability();
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


    for (let i = 0; i < firstDayIndex; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'calendar-day-cell empty-cell';
      calendarDaysGrid.appendChild(emptyCell);
    }

    for (let day = 1; day <= lastDate; day++) {
      const dayCell = document.createElement('div');
      dayCell.className = 'calendar-day-cell booking-day-cell';
      const dayLabel = document.createElement('span');
      dayLabel.textContent = day;
      dayCell.appendChild(dayLabel);

      const formattedMonth = String(currentMonth + 1).padStart(2, '0');
      const formattedDay = String(day).padStart(2, '0');
      const dateStr = `${currentYear}-${formattedMonth}-${formattedDay}`;

      if (dateStr === todayStr) {
        dayCell.classList.add('today-cell');
      }

      const cellDateObj = new Date(currentYear, currentMonth, day);
      const todayDateObj = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      for (const [slot, label] of [['am', '주간'], ['pm', '야간']]) {
        const button = document.createElement('button');
        const unavailable = cellDateObj < todayDateObj || isSlotBooked(dateStr, slot);
        button.type = 'button';
        button.className = 'booking-calendar-slot ' + (unavailable ? 'slot-booked' : 'slot-available');
        button.textContent = `${label} · ${unavailable ? '마감' : '가능'}`;
        button.disabled = unavailable;
        button.setAttribute('aria-label', `${dateStr} ${button.textContent}`);
        button.addEventListener('click', () => {
          bookingDateInput.value = dateStr;
          timeDay.checked = slot === 'am';
          timeNight.checked = slot === 'pm';
          openBookingModal();
        });
        dayCell.appendChild(button);
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
