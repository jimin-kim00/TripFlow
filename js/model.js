// 여행 데이터를 바꾸는 함수 모음. DOM을 전혀 건드리지 않는다.
// 모든 변경 함수는 성공하면 saveData()까지 호출하고, 저장 성공 여부를 반환한다.

import { loadData, saveData, DATE_RE } from './storage.js';

const loaded = loadData();
let trips = loaded.trips;

/** 앱 시작 시 데이터 로딩 오류 메시지 (없으면 null) */
export const loadError = loaded.error;

export function getTrips() {
  return trips;
}

export function getTrip(tripId) {
  return trips.find((t) => t.id === tripId) ?? null;
}

export function getSortedDates(trip) {
  return Object.keys(trip.itinerary).sort();
}

/**
 * 'YYYY-MM-DD' 두 개 사이의 모든 날짜를 반환한다.
 * UTC 기준으로만 계산해서 시간대나 서머타임의 영향을 받지 않는다.
 */
export function getDatesInRange(startDate, endDate) {
  const dates = [];
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) return dates;
  const curr = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  if (Number.isNaN(curr.getTime()) || Number.isNaN(end.getTime())) return dates;
  while (curr <= end && dates.length <= 366) {
    dates.push(curr.toISOString().slice(0, 10));
    curr.setUTCDate(curr.getUTCDate() + 1);
  }
  return dates;
}

/** 입력값 검증. 문제가 있으면 오류 메시지, 없으면 null. */
export function validateTripInput({ title, destination, startDate, endDate }) {
  if (!title.trim() || !destination.trim()) return '여행 제목과 여행지를 입력해주세요.';
  if (!startDate || !endDate) return '시작일과 종료일을 입력해주세요.';
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) return '날짜 형식이 올바르지 않습니다.';
  if (startDate > endDate) return '종료일은 시작일보다 빠를 수 없습니다.';
  if (getDatesInRange(startDate, endDate).length > 365) return '여행 기간은 최대 365일까지 설정할 수 있습니다.';
  return null;
}

export function createTrip({ title, destination, startDate, endDate, members }) {
  const trip = {
    id: newId('trip'),
    title: title.trim(),
    destination: destination.trim(),
    startDate,
    endDate,
    members: Number(members) || 1,
    updatedAt: Date.now(),
    travelMode: 'transit',
    center: null,
    itinerary: {},
  };
  getDatesInRange(startDate, endDate).forEach((date) => (trip.itinerary[date] = []));
  trips.push(trip);
  return { trip, saved: saveData(trips) };
}

/**
 * 기간을 바꿨을 때 사라지는 일정 수를 미리 계산한다.
 * 규칙: 날짜가 아니라 'N일차' 기준으로 옮긴다. (Day 1의 일정 → 새 Day 1)
 *       새 기간이 더 짧으면 넘치는 날의 일정은 삭제된다.
 */
export function previewPeriodChange(tripId, startDate, endDate) {
  const trip = getTrip(tripId);
  const oldDates = getSortedDates(trip);
  const newCount = getDatesInRange(startDate, endDate).length;
  const droppedDays = oldDates.slice(newCount).filter((d) => trip.itinerary[d].length > 0);
  const droppedPlaces = droppedDays.reduce((sum, d) => sum + trip.itinerary[d].length, 0);
  return { droppedDays: droppedDays.length, droppedPlaces };
}

export function updateTrip(tripId, { title, destination, startDate, endDate, members }) {
  const trip = getTrip(tripId);
  if (!trip) return false;

  if (startDate !== trip.startDate || endDate !== trip.endDate) {
    const oldDates = getSortedDates(trip);
    const newDates = getDatesInRange(startDate, endDate);
    const itinerary = {};
    newDates.forEach((date, i) => {
      itinerary[date] = i < oldDates.length ? trip.itinerary[oldDates[i]] : [];
    });
    trip.itinerary = itinerary;
    trip.startDate = startDate;
    trip.endDate = endDate;
  }

  // 여행지가 바뀌면 지도 중심 좌표를 다시 찾아야 한다.
  if (destination.trim() !== trip.destination) trip.center = null;

  trip.title = title.trim();
  trip.destination = destination.trim();
  trip.members = Number(members) || 1;
  trip.updatedAt = Date.now();
  return saveData(trips);
}

export function setTripCenter(tripId, center) {
  const trip = getTrip(tripId);
  if (!trip) return false;
  trip.center = center ? { lat: center.lat, lng: center.lng } : null;
  return saveData(trips);
}

export function setTravelMode(tripId, mode) {
  const trip = getTrip(tripId);
  if (!trip) return false;
  trip.travelMode = mode;
  trip.updatedAt = Date.now();
  return saveData(trips);
}

/** 상위 Trip을 제거하면 그 안에 중첩된 날짜별 일정도 함께 사라진다(연쇄 삭제). */
export function deleteTrip(tripId) {
  trips = trips.filter((t) => t.id !== tripId);
  return saveData(trips);
}

/** 같은 날에 이름이 같은 장소가 있는지 (공백·대소문자 무시) */
export function findDuplicatePlace(trip, date, name, exceptId = null) {
  const key = name.trim().toLowerCase();
  return (trip?.itinerary[date] ?? []).find((p) => p.id !== exceptId && p.name.trim().toLowerCase() === key) ?? null;
}

export function addPlace(tripId, date, { time, name, memo, location }) {
  const trip = getTrip(tripId);
  if (!trip || !trip.itinerary[date]) return false;
  trip.itinerary[date].push({
    id: newId('place'),
    time,
    name: name.trim(),
    memo: memo.trim(),
    location: copyLocation(location),
  });
  trip.updatedAt = Date.now();
  return saveData(trips);
}

export function updatePlace(tripId, date, placeId, { time, name, memo, location }) {
  const trip = getTrip(tripId);
  const place = trip?.itinerary[date]?.find((p) => p.id === placeId);
  if (!place) return false;
  Object.assign(place, { time, name: name.trim(), memo: memo.trim(), location: copyLocation(location) });
  trip.updatedAt = Date.now();
  return saveData(trips);
}

export function deletePlace(tripId, date, placeId) {
  const trip = getTrip(tripId);
  if (!trip?.itinerary[date]) return false;
  trip.itinerary[date] = trip.itinerary[date].filter((p) => p.id !== placeId);
  trip.updatedAt = Date.now();
  return saveData(trips);
}

/**
 * 화면에서 정해진 id 순서대로 일정을 재배열한다.
 * 인덱스 대신 id를 쓰기 때문에, id 목록이 실제 데이터와 맞지 않으면 아무것도 바꾸지 않는다.
 */
export function reorderPlaces(tripId, date, orderedIds) {
  const trip = getTrip(tripId);
  const places = trip?.itinerary[date];
  if (!places) return false;

  const byId = new Map(places.map((p) => [p.id, p]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  if (reordered.length !== places.length || new Set(orderedIds).size !== places.length) {
    console.warn('[TripFlow] 순서 변경 데이터가 일치하지 않아 무시합니다.', orderedIds);
    return null; // 변경 없음 (저장 실패와 구분)
  }

  trip.itinerary[date] = reordered;
  trip.updatedAt = Date.now();
  return saveData(trips);
}

/**
 * 공유 링크나 JSON 파일에서 가져온 여행을 내 여행 목록에 추가한다.
 * - 기존 데이터와 겹치지 않도록 여행·장소 id를 모두 새로 발급한다.
 * - 일정은 시작일~종료일 범위로 다시 맞춘다. (범위 밖 날짜의 일정은 버리고, 빠진 날짜는 빈 배열로 채움)
 * 이미 storage.migrate()로 정규화된 trip을 받는다고 가정한다.
 * @returns {{ trip: object|null, saved: boolean, error: string|null }}
 */
export function importTrip(source) {
  const error = validateTripInput(source);
  if (error) return { trip: null, saved: false, error };

  const itinerary = {};
  for (const date of getDatesInRange(source.startDate, source.endDate)) {
    itinerary[date] = (source.itinerary[date] ?? []).map((p) => ({
      ...p,
      id: newId('place'),
      location: copyLocation(p.location),
    }));
  }

  const trip = {
    id: newId('trip'),
    title: source.title,
    destination: source.destination,
    startDate: source.startDate,
    endDate: source.endDate,
    members: source.members,
    updatedAt: Date.now(),
    travelMode: source.travelMode,
    center: source.center ? { ...source.center } : null,
    itinerary,
  };
  trips.push(trip);
  return { trip, saved: saveData(trips), error: null };
}

function copyLocation(loc) {
  if (!loc) return null;
  return { lat: loc.lat, lng: loc.lng, address: loc.address ?? '', source: loc.source === 'manual' ? 'manual' : 'search' };
}

function newId(prefix) {
  const rand = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${rand}`;
}
