// Leaflet 지도 래퍼. 지도 '그리기'만 Leaflet에 맡기고, 무엇을 그릴지는 항상 여행 데이터에서 계산한다.
// Leaflet은 index.html에서 전역 L로 불러온다.

const DEFAULT_VIEW = { center: [20, 0], zoom: 2 };

let map = null;
let markerLayer = null;
let routeLayer = null;
let pendingLayer = null;
let containerEl = null;
let markersById = new Map();
let pickHandler = null;
let onMarkerClick = () => {};

export function isMapAvailable() {
  return typeof window.L !== 'undefined';
}

/** @returns {boolean} 지도 초기화 성공 여부 */
export function initMap(el, { onMarkerClick: handler } = {}) {
  containerEl = el;
  if (!isMapAvailable()) {
    el.classList.add('map-error');
    el.textContent = '지도 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침해주세요. (일정 관리는 계속 사용할 수 있습니다.)';
    return false;
  }
  if (handler) onMarkerClick = handler;

  map = L.map(el).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  routeLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  pendingLayer = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    if (!pickHandler) return;
    const handlerFn = pickHandler;
    cancelPick();
    handlerFn({ lat: round(e.latlng.lat), lng: round(e.latlng.lng) });
  });
  return true;
}

/** 지도가 숨겨져 있다가 보이게 되면 크기를 다시 계산해야 타일이 제대로 그려진다. */
export function refreshSize() {
  map?.invalidateSize();
}

/**
 * 하루 일정을 지도에 그린다.
 * - 번호는 일정 목록의 순서(1부터)와 같다. 좌표가 없는 장소는 건너뛰지만 번호는 유지한다.
 * - 좌표가 있는 장소끼리 방문 순서대로 선을 잇는다.
 */
export function renderMap({ places, center }) {
  if (!map) return;
  markerLayer.clearLayers();
  routeLayer.clearLayers();
  markersById = new Map();

  const points = [];
  places.forEach((place, i) => {
    if (!place.location) return;
    const latlng = [place.location.lat, place.location.lng];
    points.push(latlng);

    const marker = L.marker(latlng, {
      icon: L.divIcon({ className: 'num-marker', html: `<span>${i + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
      keyboard: false,
    });
    // 툴팁 내용은 사용자 입력이므로 HTML 문자열 대신 textContent로 만든 요소를 넘긴다.
    const tip = document.createElement('span');
    tip.textContent = `${i + 1}. ${place.name}`;
    marker.bindTooltip(tip, { direction: 'top', offset: [0, -14] });
    marker.on('click', () => onMarkerClick(place.id));
    marker.addTo(markerLayer);
    markersById.set(place.id, marker);
  });

  if (points.length >= 2) {
    L.polyline(points, { color: '#3182ce', weight: 3, opacity: 0.75, dashArray: '6 8' }).addTo(routeLayer);
  }

  if (points.length > 0) {
    map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
  } else if (center) {
    map.setView([center.lat, center.lng], 12);
  } else {
    map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
  }
}

export function highlightMarker(placeId, on) {
  const marker = markersById.get(placeId);
  if (!marker) return;
  marker.getElement()?.classList.toggle('highlight', on);
  if (on) marker.openTooltip();
  else marker.closeTooltip();
}

export function focusPlace(placeId) {
  const marker = markersById.get(placeId);
  if (!marker) return false;
  map.panTo(marker.getLatLng());
  marker.openTooltip();
  return true;
}

/** 아직 저장하지 않은 '선택 중인 위치'를 별도 표시한다. null이면 지운다. */
export function showPending(location) {
  if (!map) return;
  pendingLayer.clearLayers();
  if (!location) return;
  L.circleMarker([location.lat, location.lng], { radius: 10, color: '#dd6b20', weight: 3, fillOpacity: 0.3 }).addTo(pendingLayer);
  map.setView([location.lat, location.lng], Math.max(map.getZoom(), 14));
}

/** 다음 지도 클릭 한 번을 위치 선택으로 사용한다. */
export function startPick(handler) {
  if (!map) return false;
  pickHandler = handler;
  containerEl.classList.add('picking');
  return true;
}

export function cancelPick() {
  pickHandler = null;
  containerEl?.classList.remove('picking');
}

export function isPicking() {
  return pickHandler !== null;
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}
