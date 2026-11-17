// 여행 데이터를 바꾸는 함수 모음. DOM을 전혀 건드리지 않는다.
// 모든 변경 함수는 성공하면 saveData()까지 호출하고, 저장 성공 여부를 반환한다.

import { loadData, saveData } from './storage.js';

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

export function getPlaces(tripId, date) {
  return getTrip(tripId)?.itinerary[date] ?? [];
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
  const curr = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  if (Number.isNaN(curr.getTime()) || Number.isNaN(end.getTime())) return dates;
  while (curr <= end) {
    dates.push(curr.toISOString().slice(0, 10));
    curr.setUTCDate(curr.getUTCDate() + 1);
  }
  return dates;
}

/** 입력값 검증. 문제가 있으면 오류 메시지, 없으면 null. */
export function validateTripInput({ title, destination, startDate, endDate }) {
  if (!title.trim() || !destination.trim()) return '여행 제목과 여행지를 입력해주세요.';
  if (!startDate || !endDate) return '시작일과 종료일을 입력해주세요.';
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

  trip.title = title.trim();
  trip.destination = destination.trim();
  trip.members = Number(members) || 1;
  trip.updatedAt = Date.now();
  return saveData(trips);
}

/** 상위 Trip을 제거하면 그 안에 중첩된 날짜별 일정도 함께 사라진다(연쇄 삭제). */
export function deleteTrip(tripId) {
  trips = trips.filter((t) => t.id !== tripId);
  return saveData(trips);
}

export function addPlace(tripId, date, { time, name, memo }) {
  const trip = getTrip(tripId);
  if (!trip || !trip.itinerary[date]) return false;
  trip.itinerary[date].push({
    id: newId('place'),
    time,
    name: name.trim(),
    memo: memo.trim(),
    location: null, // 지도 기능(1단계)에서 채운다
  });
  trip.updatedAt = Date.now();
  return saveData(trips);
}

export function updatePlace(tripId, date, placeId, { time, name, memo }) {
  const trip = getTrip(tripId);
  const place = trip?.itinerary[date]?.find((p) => p.id === placeId);
  if (!place) return false;
  Object.assign(place, { time, name: name.trim(), memo: memo.trim() });
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

function newId(prefix) {
  const rand = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${rand}`;
}
