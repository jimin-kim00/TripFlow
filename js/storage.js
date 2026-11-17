// LocalStorage 읽기/쓰기와 데이터 구조 버전 관리(마이그레이션)를 담당한다.

export const SCHEMA_VERSION = 2;

const STORAGE_KEY = 'tripflow_data'; // v2부터 사용하는 키
const LEGACY_KEY = 'tripflow_trips'; // v1(배열 그대로 저장)에서 쓰던 키
const BACKUP_PREFIX = 'tripflow_backup_';

/**
 * 저장된 데이터를 불러온다.
 * - v2 데이터가 있으면 정규화해서 반환
 * - v1 데이터만 있으면 v2로 변환해 저장하고, 옛 키는 삭제(고아 데이터 방지)
 * - JSON이 깨져 있으면 원본 문자열을 백업 키에 보관하고 빈 상태로 시작
 * @returns {{ trips: object[], error: string|null }}
 */
export function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const legacyRaw = raw === null ? localStorage.getItem(LEGACY_KEY) : null;
  const source = raw ?? legacyRaw;

  if (source === null) return { trips: [], error: null };

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    const backupKey = backupRaw(source, raw === null ? LEGACY_KEY : STORAGE_KEY);
    console.error('[TripFlow] 저장된 데이터를 해석할 수 없습니다.', err);
    return {
      trips: [],
      error: `저장된 데이터가 손상되어 읽을 수 없습니다.\n원본은 '${backupKey}' 키에 백업했고, 빈 상태로 시작합니다.`,
    };
  }

  const trips = migrate(parsed);
  if (trips === null) {
    const backupKey = backupRaw(source, raw === null ? LEGACY_KEY : STORAGE_KEY);
    return {
      trips: [],
      error: `저장된 데이터 형식을 알 수 없습니다.\n원본은 '${backupKey}' 키에 백업했고, 빈 상태로 시작합니다.`,
    };
  }

  // v1 → v2 변환이 일어났다면 새 키로 저장한 뒤 옛 키를 지운다.
  if (raw === null && saveData(trips)) {
    localStorage.removeItem(LEGACY_KEY);
  }

  return { trips, error: null };
}

/** @returns {boolean} 저장 성공 여부 (용량 초과 등으로 실패할 수 있음) */
export function saveData(trips) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, trips }));
    return true;
  } catch (err) {
    console.error('[TripFlow] 저장에 실패했습니다.', err);
    return false;
  }
}

/**
 * 어떤 버전의 데이터든 v2 형식의 trips 배열로 바꾼다.
 * 알 수 없는 형식이면 null.
 */
export function migrate(data) {
  let trips;
  if (Array.isArray(data)) {
    trips = data; // v1: 배열을 그대로 저장했던 형식
  } else if (data && typeof data === 'object' && Array.isArray(data.trips)) {
    trips = data.trips; // v2 이상
  } else {
    return null;
  }
  return trips.map(normalizeTrip).filter(Boolean);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeTrip(trip) {
  if (!trip || typeof trip !== 'object' || typeof trip.id !== 'string') return null;

  const itinerary = {};
  const source = trip.itinerary && typeof trip.itinerary === 'object' ? trip.itinerary : {};
  for (const [date, places] of Object.entries(source)) {
    if (!DATE_RE.test(date)) continue;
    itinerary[date] = Array.isArray(places) ? places.map(normalizePlace).filter(Boolean) : [];
  }

  return {
    id: trip.id,
    title: String(trip.title ?? ''),
    destination: String(trip.destination ?? ''),
    startDate: String(trip.startDate ?? ''),
    endDate: String(trip.endDate ?? ''),
    members: Number(trip.members) || 1,
    updatedAt: Number(trip.updatedAt) || Date.now(),
    itinerary,
  };
}

function normalizePlace(place) {
  if (!place || typeof place !== 'object' || typeof place.id !== 'string') return null;
  return {
    id: place.id,
    time: String(place.time ?? ''),
    name: String(place.name ?? ''),
    memo: String(place.memo ?? ''),
    location: normalizeLocation(place.location),
  };
}

/** 지도 기능(1단계)에서 채울 좌표 정보. 없거나 잘못되었으면 null. */
function normalizeLocation(loc) {
  if (!loc || typeof loc !== 'object') return null;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat,
    lng,
    address: String(loc.address ?? ''),
    source: loc.source === 'manual' ? 'manual' : 'search',
  };
}

/** 손상된 원본을 백업 키로 옮긴다. 원래 키는 지워서 새로고침할 때마다 백업이 쌓이지 않게 한다. */
function backupRaw(raw, sourceKey) {
  const key = BACKUP_PREFIX + Date.now();
  try {
    localStorage.setItem(key, raw);
    localStorage.removeItem(sourceKey);
  } catch {
    // 백업조차 실패하면 콘솔에만 남긴다.
    console.error('[TripFlow] 백업 실패. 원본 데이터:', raw);
  }
  return key;
}
