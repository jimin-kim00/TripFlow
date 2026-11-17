// 장소명 → 좌표 검색 (OpenStreetMap Nominatim).
// 이용 규칙: 초당 1회 이하, 자동완성 금지 → 버튼을 눌렀을 때만 검색하고, 요청 간격을 강제하며, 결과를 캐시한다.
// https://operations.osmfoundation.org/policies/nominatim/

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 10000;

export class GeocodeError extends Error {}

const cache = new Map();
let lastRequestAt = 0;
let queue = Promise.resolve();

/** 요청을 한 줄로 세우고, 앞 요청과 최소 간격을 둔다. */
function throttled(task) {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return task();
  });
  queue = run.catch(() => {}); // 실패해도 다음 요청은 진행
  return run;
}

/**
 * @param {string} query 검색어
 * @param {{ near?: {lat:number,lng:number}, limit?: number }} options near가 있으면 그 주변 결과를 우선
 * @returns {Promise<Array<{ lat:number, lng:number, name:string, address:string }>>}
 */
export function searchPlaces(query, { near = null, limit = 5 } = {}) {
  const q = query.trim();
  if (!q) return Promise.resolve([]);

  const key = `${q}|${limit}|${near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : ''}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));

  const params = new URLSearchParams({ format: 'jsonv2', q, limit: String(limit), 'accept-language': 'ko' });
  if (near) {
    // viewbox = 왼쪽,위,오른쪽,아래. bounded=0이라 범위 밖 결과도 나오지만 범위 안이 우선된다.
    const d = 0.5;
    params.set('viewbox', [near.lng - d, near.lat + d, near.lng + d, near.lat - d].join(','));
    params.set('bounded', '0');
  }

  return throttled(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${ENDPOINT}?${params}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (err) {
      throw new GeocodeError(
        err.name === 'AbortError' ? '검색 응답이 너무 늦습니다. 잠시 후 다시 시도해주세요.' : '네트워크 오류로 검색하지 못했습니다. 인터넷 연결을 확인해주세요.'
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) throw new GeocodeError('검색 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    if (!res.ok) throw new GeocodeError(`검색 서버 오류가 발생했습니다. (HTTP ${res.status})`);

    let data;
    try {
      data = await res.json();
    } catch {
      throw new GeocodeError('검색 결과를 해석하지 못했습니다.');
    }
    if (!Array.isArray(data)) throw new GeocodeError('검색 결과 형식이 올바르지 않습니다.');

    // 좌표가 숫자가 아니거나 범위를 벗어난 결과는 버린다.
    const results = data
      .map((item) => ({
        lat: Number(item.lat),
        lng: Number(item.lon),
        name: String(item.name || item.display_name || '').trim(),
        address: String(item.display_name ?? ''),
      }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180);

    cache.set(key, results);
    return results;
  });
}

/** 여행지 이름으로 지도 중심 좌표를 찾는다. 실패하면 null. */
export async function geocodeDestination(destination) {
  try {
    const [first] = await searchPlaces(destination, { limit: 1 });
    return first ? { lat: first.lat, lng: first.lng } : null;
  } catch {
    return null;
  }
}
