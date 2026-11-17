// 거리·이동시간 추정과 일정 충돌 검사. 외부 API 없이 좌표만으로 계산한다.
// 실제 도로가 아니라 직선거리 기반의 '추정치'이므로 화면에도 추정치라고 표시한다.

export const TRAVEL_MODES = {
  walk: { label: '도보', icon: '🚶', speedKmh: 4.5, detour: 1.3, overheadMin: 0 },
  transit: { label: '대중교통', icon: '🚇', speedKmh: 25, detour: 1.4, overheadMin: 10 },
  car: { label: '자동차', icon: '🚗', speedKmh: 30, detour: 1.4, overheadMin: 5 },
};

const EARTH_RADIUS_KM = 6371;

/** 두 좌표 사이의 직선(대원) 거리, km */
export function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function minutesFor(km, mode) {
  const m = TRAVEL_MODES[mode];
  return (km * m.detour) / m.speedKmh * 60 + m.overheadMin;
}

/**
 * 예상 이동 거리와 시간.
 * 대중교통은 가까운 거리라면 걷는 편이 빠르므로 둘 중 짧은 시간을 쓴다.
 */
export function estimateTravel(from, to, mode = 'transit') {
  const km = haversineKm(from, to);
  let minutes = minutesFor(km, mode);
  let usedMode = mode;
  if (mode === 'transit') {
    const walk = minutesFor(km, 'walk');
    if (walk <= minutes) {
      minutes = walk;
      usedMode = 'walk';
    }
  }
  return { km, minutes: Math.max(1, Math.round(minutes)), mode: usedMode };
}

/** 'HH:MM' → 자정부터의 분. 형식이 틀리면 null */
export function toMinutes(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * 하루 일정의 각 장소에 대해 이전 장소와의 관계를 분석한다.
 * @returns {Array<{ travel: object|null, gap: number|null, warnings: string[] }>}
 *   travel  이전 장소 → 이 장소 예상 이동 (둘 다 좌표가 있을 때만)
 *   gap     이전 일정 시각과의 간격(분)
 *   warnings 'time-order' (시간이 순서와 반대) | 'tight' (간격 < 예상 이동시간)
 */
export function analyzeDay(places, mode = 'transit') {
  return places.map((place, i) => {
    const result = { travel: null, gap: null, warnings: [] };
    if (i === 0) return result;

    const prev = places[i - 1];
    if (prev.location && place.location) {
      result.travel = estimateTravel(prev.location, place.location, mode);
    }

    const prevMin = toMinutes(prev.time);
    const currMin = toMinutes(place.time);
    if (prevMin !== null && currMin !== null) {
      result.gap = currMin - prevMin;
      if (result.gap < 0) result.warnings.push('time-order');
      else if (result.travel && result.gap < result.travel.minutes) result.warnings.push('tight');
    }
    return result;
  });
}

export function formatKm(km) {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

export function formatMinutes(min) {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}
