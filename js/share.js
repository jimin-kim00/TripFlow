// 여행 공유(링크)와 JSON 내보내기/가져오기.
// 서버가 없으므로 여행 데이터를 URL의 해시(#) 부분에 압축해서 담는다.
// 해시는 서버로 전송되지 않으므로 GitHub Pages 서버에도 여행 내용이 남지 않는다.
//
// 링크 형식: <페이지 주소>#share=<형식 1글자><base64url 데이터>
//   z = deflate-raw 압축 / j = 압축 없음(CompressionStream을 지원하지 않는 브라우저)

import { migrate } from './storage.js';

export class ShareError extends Error {}

const SHARE_PREFIX = '#share=';
const PAYLOAD_VERSION = 1;
const MAX_DECODED_BYTES = 1_000_000; // 압축 해제 후 최대 크기 (압축 폭탄 방지)
const MAX_IMPORT_FILE_BYTES = 5_000_000;
export const LONG_URL_WARNING = 8000; // 메신저 등에서 잘릴 수 있는 길이

// ───────────────────────── 공유 링크 ─────────────────────────

export function hasShareHash(hash = location.hash) {
  return hash.startsWith(SHARE_PREFIX);
}

export async function createShareUrl(trip) {
  const json = JSON.stringify({ app: 'TripFlow', v: PAYLOAD_VERSION, trip: toPortable(trip) });
  let bytes = new TextEncoder().encode(json);
  let flag = 'j';
  if (typeof CompressionStream !== 'undefined') {
    bytes = await transform(bytes, new CompressionStream('deflate-raw'));
    flag = 'z';
  }
  return `${location.origin}${location.pathname}${SHARE_PREFIX}${flag}${toBase64Url(bytes)}`;
}

/**
 * 해시에서 공유된 여행을 꺼낸다. 형식·내용이 잘못되면 ShareError.
 * 반환값은 storage.migrate()로 정규화된 여행 객체다. (내 저장소에는 아직 저장되지 않음)
 */
export async function parseShareHash(hash = location.hash) {
  const match = /^#share=([zj])([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) throw new ShareError('공유 링크 형식이 올바르지 않습니다. 링크가 잘리지 않았는지 확인해주세요.');
  const [, flag, data] = match;

  let bytes;
  try {
    bytes = fromBase64Url(data);
    if (flag === 'z') {
      if (typeof DecompressionStream === 'undefined') {
        throw new ShareError('이 브라우저는 압축된 공유 링크를 열 수 없습니다. 최신 브라우저에서 열어주세요.');
      }
      bytes = await transform(bytes, new DecompressionStream('deflate-raw'), MAX_DECODED_BYTES);
    }
  } catch (err) {
    if (err instanceof ShareError) throw err;
    throw new ShareError('공유 링크가 손상되어 열 수 없습니다. 링크가 잘리지 않았는지 확인해주세요.');
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ShareError('공유 데이터를 해석할 수 없습니다.');
  }
  if (!payload || payload.app !== 'TripFlow' || !payload.trip) {
    throw new ShareError('TripFlow 공유 링크가 아닙니다.');
  }
  if (payload.v > PAYLOAD_VERSION) {
    throw new ShareError('더 새로운 버전의 TripFlow에서 만든 링크입니다. 페이지를 새로고침해보세요.');
  }

  const trips = migrate({ trips: [payload.trip] });
  if (!trips || trips.length !== 1) throw new ShareError('공유된 여행 데이터가 올바르지 않습니다.');
  return trips[0];
}

// ───────────────────────── JSON 파일 ─────────────────────────

export function exportTripFile(trip) {
  const data = { app: 'TripFlow', version: 2, exportedAt: new Date().toISOString(), trips: [toPortable(trip)] };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TripFlow_${safeFileName(trip.title)}_${trip.startDate}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 가져온 파일에서 여행 목록을 꺼낸다.
 * 허용 형식: 내보내기 파일({trips:[...]}), 여행 배열, 여행 객체 하나
 * @returns {Promise<object[]>} 정규화된 여행 배열 (1개 이상)
 */
export async function readImportFile(file) {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new ShareError('파일이 너무 큽니다. (최대 5MB)');

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new ShareError('JSON 파일이 아니거나 내용이 손상되었습니다.');
  }

  const isSingleTrip = data && !Array.isArray(data) && typeof data === 'object' && !data.trips && data.itinerary;
  const trips = migrate(isSingleTrip ? [data] : data);
  if (!trips) throw new ShareError('TripFlow 여행 데이터 형식이 아닙니다.');
  if (trips.length === 0) throw new ShareError('파일에 가져올 수 있는 여행이 없습니다.');
  return trips;
}

// ───────────────────────── 내부 함수 ─────────────────────────

/** 공유·내보내기에 필요한 필드만 남긴다. */
function toPortable(trip) {
  const { id, title, destination, startDate, endDate, members, travelMode, center, itinerary } = trip;
  return { id, title, destination, startDate, endDate, members, travelMode, center, itinerary };
}

/** 스트림 변환(압축/해제). maxBytes를 넘으면 중단한다. */
async function transform(bytes, stream, maxBytes = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ShareError('공유 데이터가 너무 큽니다.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function safeFileName(name) {
  return (name || 'trip').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
}
