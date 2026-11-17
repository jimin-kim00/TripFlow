// 화면 렌더링과 이벤트 처리. 데이터 변경은 반드시 model.js의 함수를 거친다.
// 원칙: 데이터를 바꾼 뒤에는 render 함수로 '데이터 기준'으로 다시 그린다.
//       일정 목록과 지도는 항상 renderPlaces() 한 곳에서 함께 그려서 서로 어긋나지 않게 한다.

import * as model from './model.js';
import * as mapView from './map.js';
import { searchPlaces, geocodeDestination, GeocodeError } from './geocode.js';
import { TRAVEL_MODES, analyzeDay, formatKm, formatMinutes } from './geo.js';
import * as share from './share.js';

const state = {
  currentTripId: null,
  currentDate: null,
  editingTripId: null, // 여행 정보 수정 중이면 그 여행의 id
  editingPlaceId: null, // 일정 수정 중이면 그 일정의 id
  pendingLocation: null, // 장소 폼에서 선택해 둔(아직 저장 전) 위치
  shared: null, // 공유 링크로 보고 있는 여행 { trip } — 내 저장소에는 없음
};

const $ = (id) => document.getElementById(id);

const tripForm = $('trip-form');
const tripSubmitBtn = $('save-trip-btn');
const tripCancelBtn = $('cancel-trip-edit-btn');
const tripList = $('trip-list');
const itineraryContent = $('itinerary-content');
const noTripSelected = $('no-trip-selected');
const dateTabs = $('date-tabs');
const placeForm = $('place-form');
const placeSubmitBtn = $('place-submit-btn');
const placeCancelBtn = $('cancel-place-edit-btn');
const placeList = $('place-list');
const searchResults = $('search-results');
const locationStatus = $('location-status');
const travelModeSelect = $('travel-mode');
const sharedBanner = $('shared-banner');
const shareDialog = $('share-dialog');

const SAVE_FAILED_MSG = '저장에 실패했습니다. 브라우저 저장 공간이 부족하거나 저장이 차단되었을 수 있습니다.';

function warnIfNotSaved(saved) {
  if (saved === false) alert(SAVE_FAILED_MSG);
}

/** 지금 화면에 보이는 여행: 공유 링크로 보는 중이면 그 여행, 아니면 내 여행 */
function activeTrip() {
  return state.shared ? state.shared.trip : model.getTrip(state.currentTripId);
}

function isReadOnly() {
  return state.shared !== null;
}

function currentPlaces() {
  return activeTrip()?.itinerary[state.currentDate] ?? [];
}

// ───────────────────────── 렌더링 ─────────────────────────

function renderAll() {
  renderTripList();
  renderItinerary();
}

function renderTripList() {
  const trips = model.getTrips();
  if (trips.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'trip-empty';
    empty.textContent = '아직 만든 여행이 없습니다.';
    tripList.replaceChildren(empty);
    return;
  }
  tripList.replaceChildren(
    ...trips.map((trip) => {
      const li = document.createElement('li');
      li.className = `trip-item ${!isReadOnly() && trip.id === state.currentTripId ? 'active' : ''}`;
      li.textContent = `${trip.title} (${trip.destination})`;
      li.addEventListener('click', () => selectTrip(trip.id));
      return li;
    })
  );
}

function renderItinerary() {
  const trip = activeTrip();
  document.body.classList.toggle('read-only', isReadOnly());
  sharedBanner.classList.toggle('hidden', !isReadOnly());
  noTripSelected.classList.toggle('hidden', !!trip);
  itineraryContent.classList.toggle('hidden', !trip);
  if (!trip) return;

  $('current-trip-title').textContent = trip.title;
  $('current-trip-info').textContent = `${trip.destination} | ${trip.startDate} ~ ${trip.endDate} (${trip.members}명)`;
  travelModeSelect.value = trip.travelMode;

  const dates = model.getSortedDates(trip);
  if (!dates.includes(state.currentDate)) state.currentDate = dates[0] ?? null;

  renderDateTabs(dates);
  ensureMap();
  renderPlaces();
}

function renderDateTabs(dates) {
  dateTabs.replaceChildren(
    ...dates.map((date, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tab-btn ${date === state.currentDate ? 'active' : ''}`;
      btn.textContent = `Day ${index + 1} (${date.slice(5)})`;
      btn.addEventListener('click', () => {
        if (state.currentDate === date) return;
        cancelPlaceEdit();
        state.currentDate = date;
        renderItinerary();
      });
      return btn;
    })
  );
}

/** 일정 목록 + 지도 + 요약을 함께 다시 그린다. */
function renderPlaces() {
  const trip = activeTrip();
  const places = currentPlaces();
  const analysis = analyzeDay(places, trip?.travelMode);

  if (places.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'place-empty';
    empty.textContent = isReadOnly() ? '이 날은 등록된 일정이 없습니다.' : '아직 등록된 일정이 없습니다. 위에서 장소를 추가해보세요.';
    placeList.replaceChildren(empty);
  } else {
    placeList.replaceChildren(...places.map((place, i) => createPlaceItem(place, i, analysis[i])));
  }

  renderDaySummary(places, analysis);
  mapView.renderMap({ places, center: trip?.center });
  mapView.showPending(isReadOnly() ? null : state.pendingLocation);
}

function renderDaySummary(places, analysis) {
  const located = places.filter((p) => p.location).length;
  const totalKm = analysis.reduce((sum, a) => sum + (a.travel?.km ?? 0), 0);
  const totalMin = analysis.reduce((sum, a) => sum + (a.travel?.minutes ?? 0), 0);
  const warnings = analysis.reduce((sum, a) => sum + a.warnings.length, 0);

  const parts = [];
  if (places.length) parts.push(`위치 지정 ${located}/${places.length}곳`);
  if (totalKm > 0) parts.push(`총 이동 약 ${formatKm(totalKm)} · ${formatMinutes(totalMin)}`);
  if (warnings) parts.push(`⚠️ 확인 필요 ${warnings}건`);
  $('day-summary').textContent = parts.join('  |  ');
}

function createPlaceItem(place, index, info) {
  const readOnly = isReadOnly();
  const li = document.createElement('li');
  li.className = 'place-item';
  if (place.id === state.editingPlaceId) li.classList.add('editing');
  if (info.warnings.length) li.classList.add('has-warning');
  li.draggable = !readOnly;
  li.dataset.id = place.id;

  const num = document.createElement('span');
  num.className = `place-num ${place.location ? '' : 'no-location'}`;
  num.textContent = String(index + 1);
  num.title = place.location ? '지도에서 보기' : '위치 정보 없음';

  const body = document.createElement('div');
  body.className = 'place-body';

  if (info.travel) {
    const mode = TRAVEL_MODES[info.travel.mode];
    const travel = document.createElement('div');
    travel.className = 'travel-line';
    travel.textContent = `${mode.icon} 이전 장소에서 ${formatKm(info.travel.km)} · 약 ${formatMinutes(info.travel.minutes)}`;
    body.append(travel);
  }

  // 사용자 입력은 모두 textContent로 넣는다 (innerHTML 사용 시 XSS 위험)
  const main = document.createElement('div');
  main.className = 'place-info';
  const time = document.createElement('strong');
  time.textContent = place.time;
  const name = document.createElement('span');
  name.textContent = place.name;
  main.append(time, name);
  if (!place.location) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = '📍 위치 없음';
    main.append(badge);
  }
  body.append(main);

  if (place.memo) {
    const memo = document.createElement('small');
    memo.className = 'place-memo';
    memo.textContent = place.memo;
    body.append(memo);
  }

  for (const w of info.warnings) {
    const warn = document.createElement('div');
    warn.className = 'place-warning';
    warn.textContent =
      w === 'time-order'
        ? '⚠️ 이전 일정보다 시간이 빠릅니다. 순서나 시간을 확인해주세요.'
        : `⚠️ 이동시간 부족: 이전 일정과 ${formatMinutes(info.gap)} 간격인데 이동에 약 ${formatMinutes(info.travel.minutes)}이 걸려요.`;
    body.append(warn);
  }

  li.append(num, body);

  if (!readOnly) {
    const actions = document.createElement('div');
    actions.className = 'place-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'text-btn';
    editBtn.textContent = '수정';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startPlaceEdit(place);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'text-btn danger';
    deleteBtn.textContent = '삭제';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`'${place.name}' 일정을 삭제하시겠습니까?`)) return;
      if (state.editingPlaceId === place.id) cancelPlaceEdit();
      warnIfNotSaved(model.deletePlace(state.currentTripId, state.currentDate, place.id));
      renderPlaces();
    });

    actions.append(editBtn, deleteBtn);
    li.append(actions);

    li.addEventListener('dragstart', (e) => {
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', place.id);
    });

    // 목록 밖에 놓거나 ESC로 취소하면 drop이 발생하지 않는다.
    // dragover에서 DOM만 옮겨진 상태로 남지 않도록, 항상 데이터 기준으로 다시 그린다.
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      renderPlaces();
    });
  }

  // 목록 ↔ 지도 연동
  li.addEventListener('mouseenter', () => mapView.highlightMarker(place.id, true));
  li.addEventListener('mouseleave', () => mapView.highlightMarker(place.id, false));
  li.addEventListener('click', () => mapView.focusPlace(place.id));

  return li;
}

/** 지도 마커를 클릭하면 해당 일정 카드로 스크롤하고 잠깐 강조한다. */
function focusPlaceCard(placeId) {
  const card = [...placeList.querySelectorAll('.place-item')].find((el) => el.dataset.id === placeId);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  card.classList.remove('flash');
  void card.offsetWidth; // 애니메이션 재시작
  card.classList.add('flash');
}

let mapReady = false;
function ensureMap() {
  if (!mapReady) {
    mapReady = true;
    mapView.initMap($('map'), { onMarkerClick: focusPlaceCard });
  }
  // 숨겨져 있던 지도가 보이게 된 직후에는 크기를 다시 계산해야 한다.
  mapView.refreshSize();
}

// ───────────────────────── 여행 ─────────────────────────

function selectTrip(tripId) {
  if (isReadOnly()) exitSharedView();
  if (state.currentTripId !== tripId) {
    cancelPlaceEdit();
    state.currentDate = null;
  }
  state.currentTripId = tripId;
  renderAll();
  ensureTripCenter(tripId);
}

/** 여행지의 중심 좌표가 없으면 한 번 찾아서 저장한다. (지도 기본 위치·검색 우선 범위로 사용) */
const centerRequests = new Set();
async function ensureTripCenter(tripId) {
  const trip = model.getTrip(tripId);
  if (!trip || trip.center || centerRequests.has(tripId)) return;
  centerRequests.add(tripId);
  const center = await geocodeDestination(trip.destination);
  centerRequests.delete(tripId);
  if (!center || !model.getTrip(tripId)) return;
  model.setTripCenter(tripId, center);
  if (!isReadOnly() && state.currentTripId === tripId && !currentPlaces().some((p) => p.location)) {
    renderPlaces();
  }
}

function readTripForm() {
  return {
    title: $('trip-title').value,
    destination: $('trip-destination').value,
    startDate: $('trip-start').value,
    endDate: $('trip-end').value,
    members: $('trip-members').value,
  };
}

tripForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = readTripForm();

  const error = model.validateTripInput(input);
  if (error) {
    alert(error);
    return;
  }

  let tripId;
  if (state.editingTripId) {
    tripId = state.editingTripId;
    const { droppedDays, droppedPlaces } = model.previewPeriodChange(tripId, input.startDate, input.endDate);
    if (
      droppedPlaces > 0 &&
      !confirm(
        `여행 기간이 줄어들어 마지막 ${droppedDays}일의 일정 ${droppedPlaces}개가 삭제됩니다.\n` +
          `(일정은 날짜가 아닌 'N일차' 기준으로 옮겨집니다.)\n계속하시겠습니까?`
      )
    ) {
      return;
    }
    warnIfNotSaved(model.updateTrip(tripId, input));
    cancelTripEdit();
  } else {
    const { trip, saved } = model.createTrip(input);
    warnIfNotSaved(saved);
    tripForm.reset();
    tripId = trip.id;
    state.currentDate = null;
  }
  if (isReadOnly()) exitSharedView();
  cancelPlaceEdit();
  state.currentTripId = tripId;
  renderAll();
  ensureTripCenter(tripId);
});

function startTripEdit() {
  const trip = model.getTrip(state.currentTripId);
  if (!trip || isReadOnly()) return;
  state.editingTripId = trip.id;
  $('trip-title').value = trip.title;
  $('trip-destination').value = trip.destination;
  $('trip-start').value = trip.startDate;
  $('trip-end').value = trip.endDate;
  $('trip-members').value = trip.members;
  tripSubmitBtn.textContent = '여행 정보 저장';
  tripCancelBtn.classList.remove('hidden');
  tripForm.classList.add('editing');
  $('trip-title').focus();
}

function cancelTripEdit() {
  state.editingTripId = null;
  tripForm.reset();
  tripSubmitBtn.textContent = '여행 만들기';
  tripCancelBtn.classList.add('hidden');
  tripForm.classList.remove('editing');
}

$('edit-trip-btn').addEventListener('click', startTripEdit);
tripCancelBtn.addEventListener('click', cancelTripEdit);

$('delete-trip-btn').addEventListener('click', () => {
  if (!confirm('이 여행과 연관된 모든 날짜별 일정이 함께 삭제됩니다. 정말 삭제하시겠습니까?')) return;
  if (state.editingTripId === state.currentTripId) cancelTripEdit();
  warnIfNotSaved(model.deleteTrip(state.currentTripId));
  state.currentTripId = null;
  state.currentDate = null;
  cancelPlaceEdit();
  renderAll();
});

travelModeSelect.addEventListener('change', () => {
  const mode = travelModeSelect.value;
  if (isReadOnly()) {
    state.shared.trip.travelMode = mode; // 공유 보기에서는 화면에만 반영 (저장하지 않음)
  } else {
    warnIfNotSaved(model.setTravelMode(state.currentTripId, mode));
  }
  renderPlaces();
});

// ───────────────────────── 일정 ─────────────────────────

function readPlaceForm() {
  return {
    time: $('place-time').value,
    name: $('place-name').value,
    memo: $('place-memo').value,
    location: state.pendingLocation,
  };
}

placeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (isReadOnly() || !state.currentTripId || !state.currentDate) return;

  const input = readPlaceForm();
  if (!input.name.trim()) {
    alert('장소명을 입력해주세요.');
    return;
  }

  const trip = model.getTrip(state.currentTripId);
  const dup = model.findDuplicatePlace(trip, state.currentDate, input.name, state.editingPlaceId);
  if (dup && !confirm(`이 날에 이미 '${dup.name}' 일정(${dup.time})이 있습니다. 그래도 추가하시겠습니까?`)) return;

  const saved = state.editingPlaceId
    ? model.updatePlace(state.currentTripId, state.currentDate, state.editingPlaceId, input)
    : model.addPlace(state.currentTripId, state.currentDate, input);
  warnIfNotSaved(saved);

  cancelPlaceEdit();
  renderPlaces();
});

function startPlaceEdit(place) {
  state.editingPlaceId = place.id;
  $('place-time').value = place.time;
  $('place-name').value = place.name;
  $('place-memo').value = place.memo;
  setPendingLocation(place.location);
  placeSubmitBtn.textContent = '수정 완료';
  placeCancelBtn.classList.remove('hidden');
  placeForm.classList.add('editing');
  renderPlaces();
  $('place-name').focus();
}

function cancelPlaceEdit() {
  const hadState = state.editingPlaceId !== null || state.pendingLocation !== null;
  state.editingPlaceId = null;
  placeForm.reset();
  placeSubmitBtn.textContent = '장소 추가';
  placeCancelBtn.classList.add('hidden');
  placeForm.classList.remove('editing');
  hideSearchResults();
  stopPicking();
  setLocationStatus('');
  setPendingLocation(null);
  if (hadState && activeTrip()) renderPlaces();
}

placeCancelBtn.addEventListener('click', cancelPlaceEdit);

// ───────────────────────── 위치 지정 (검색 / 지도 클릭) ─────────────────────────

function setPendingLocation(loc) {
  state.pendingLocation = loc ? { ...loc } : null;
  const chip = $('pending-location');
  chip.classList.toggle('hidden', !loc);
  if (loc) {
    $('pending-location-text').textContent =
      loc.source === 'manual' ? `📍 지도에서 지정 (${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)})` : `📍 ${shorten(loc.address, 40)}`;
    chip.title = loc.address || '';
  }
  mapView.showPending(state.pendingLocation);
}

function setLocationStatus(text, isError = false) {
  locationStatus.textContent = text;
  locationStatus.classList.toggle('error', isError);
}

function hideSearchResults() {
  searchResults.classList.add('hidden');
  searchResults.replaceChildren();
}

$('clear-location-btn').addEventListener('click', () => setPendingLocation(null));

let searchSeq = 0;
$('search-location-btn').addEventListener('click', async () => {
  const query = $('place-name').value.trim();
  if (!query) {
    alert('장소명을 먼저 입력한 뒤 위치를 검색해주세요.');
    $('place-name').focus();
    return;
  }
  stopPicking();
  const trip = activeTrip();
  const seq = ++searchSeq;
  setLocationStatus('검색 중…');
  hideSearchResults();

  try {
    const results = await searchPlaces(query, { near: trip?.center });
    if (seq !== searchSeq) return; // 그 사이 다른 검색을 시작했다면 무시
    if (results.length === 0) {
      setLocationStatus(`'${query}' 검색 결과가 없습니다. 다른 이름으로 검색하거나 '지도에서 선택'을 사용해주세요.`, true);
      return;
    }
    setLocationStatus(`${results.length}개의 결과 중 하나를 선택하세요.`);
    searchResults.replaceChildren(
      ...results.map((r) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        const title = document.createElement('strong');
        title.textContent = r.name;
        const addr = document.createElement('small');
        addr.textContent = r.address;
        btn.append(title, addr);
        btn.addEventListener('click', () => {
          setPendingLocation({ lat: r.lat, lng: r.lng, address: r.address, source: 'search' });
          hideSearchResults();
          setLocationStatus('위치를 선택했습니다. 저장하려면 장소 추가(수정 완료)를 눌러주세요.');
        });
        li.append(btn);
        return li;
      })
    );
    searchResults.classList.remove('hidden');
  } catch (err) {
    if (seq !== searchSeq) return;
    setLocationStatus(err instanceof GeocodeError ? err.message : '위치 검색 중 오류가 발생했습니다.', true);
  }
});

$('pick-location-btn').addEventListener('click', () => {
  if (mapView.isPicking()) {
    stopPicking();
    setLocationStatus('');
    return;
  }
  hideSearchResults();
  const started = mapView.startPick((loc) => {
    $('pick-location-btn').classList.remove('active');
    setPendingLocation({ ...loc, address: '', source: 'manual' });
    setLocationStatus('위치를 지정했습니다. 저장하려면 장소 추가(수정 완료)를 눌러주세요.');
  });
  if (!started) {
    setLocationStatus('지도를 사용할 수 없어 위치를 지정할 수 없습니다.', true);
    return;
  }
  $('pick-location-btn').classList.add('active');
  setLocationStatus('지도에서 위치를 클릭하세요. (ESC: 취소)');
});

function stopPicking() {
  mapView.cancelPick();
  $('pick-location-btn').classList.remove('active');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mapView.isPicking()) {
    stopPicking();
    setLocationStatus('');
  }
});

// ───────────────────────── 드래그 앤 드롭 ─────────────────────────

placeList.addEventListener('dragover', (e) => {
  const draggingItem = placeList.querySelector('.place-item.dragging');
  if (!draggingItem) return; // 파일 등 외부에서 끌어온 것은 무시
  e.preventDefault();

  // clientY는 화면(viewport) 기준이므로, 비교 대상도 같은 기준인 getBoundingClientRect()를 쓴다.
  const siblings = [...placeList.querySelectorAll('.place-item:not(.dragging)')];
  const nextSibling = siblings.find((sibling) => {
    const rect = sibling.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2;
  });

  if (nextSibling) placeList.insertBefore(draggingItem, nextSibling);
  else placeList.appendChild(draggingItem);
});

placeList.addEventListener('drop', (e) => {
  if (!placeList.querySelector('.place-item.dragging')) return;
  e.preventDefault();
  const orderedIds = [...placeList.querySelectorAll('.place-item')].map((item) => item.dataset.id);
  const result = model.reorderPlaces(state.currentTripId, state.currentDate, orderedIds);
  if (result === false) alert(SAVE_FAILED_MSG); // null은 '변경 없음'이므로 경고하지 않는다
  // 다시 그리기(목록 번호·이동시간·지도)는 dragend에서 한다.
});

// ───────────────────────── 공유 링크 ─────────────────────────

$('share-trip-btn').addEventListener('click', async () => {
  const trip = model.getTrip(state.currentTripId);
  if (!trip) return;
  let url;
  try {
    url = await share.createShareUrl(trip);
  } catch (err) {
    console.error(err);
    alert('공유 링크를 만들지 못했습니다.');
    return;
  }
  $('share-url').value = url;
  $('share-note').textContent =
    url.length > share.LONG_URL_WARNING
      ? `⚠️ 링크가 깁니다(${url.length.toLocaleString()}자). 일부 메신저에서는 잘릴 수 있으니 'JSON 내보내기'도 함께 고려해주세요.`
      : `링크 길이: ${url.length.toLocaleString()}자 · 링크에 여행 내용이 담겨 있으니 공개된 곳에는 올리지 마세요.`;
  shareDialog.showModal();
  $('share-url').select();
});

$('copy-share-url-btn').addEventListener('click', async () => {
  const input = $('share-url');
  try {
    await navigator.clipboard.writeText(input.value);
    $('copy-share-url-btn').textContent = '복사됨 ✓';
  } catch {
    input.select();
    $('copy-share-url-btn').textContent = 'Ctrl+C로 복사하세요';
  }
  setTimeout(() => ($('copy-share-url-btn').textContent = '링크 복사'), 2000);
});

$('close-share-dialog-btn').addEventListener('click', () => shareDialog.close());

async function openSharedFromHash() {
  if (!share.hasShareHash()) return;
  try {
    const trip = await share.parseShareHash();
    const invalid = model.validateTripInput(trip);
    if (invalid) throw new share.ShareError(`공유된 여행 정보가 올바르지 않습니다. (${invalid})`);
    cancelTripEdit();
    cancelPlaceEdit();
    state.shared = { trip };
    state.currentDate = null;
    renderAll();
  } catch (err) {
    alert(err instanceof share.ShareError ? err.message : '공유 링크를 여는 중 오류가 발생했습니다.');
    clearHash();
    if (isReadOnly()) exitSharedView();
  }
}

function exitSharedView() {
  state.shared = null;
  state.currentDate = null;
  clearHash();
}

function clearHash() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

$('copy-shared-btn').addEventListener('click', () => {
  if (!state.shared) return;
  const { trip, saved, error } = model.importTrip(state.shared.trip);
  if (error) {
    alert(`복사하지 못했습니다: ${error}`);
    return;
  }
  warnIfNotSaved(saved);
  exitSharedView();
  state.currentTripId = trip.id;
  renderAll();
  alert(`'${trip.title}' 여행을 내 여행 목록에 복사했습니다. 이제 자유롭게 수정할 수 있어요.`);
});

$('close-shared-btn').addEventListener('click', () => {
  exitSharedView();
  renderAll();
});

window.addEventListener('hashchange', openSharedFromHash);

// ───────────────────────── JSON 내보내기 / 가져오기 ─────────────────────────

$('export-trip-btn').addEventListener('click', () => {
  const trip = model.getTrip(state.currentTripId);
  if (trip) share.exportTripFile(trip);
});

$('import-btn').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // 같은 파일을 다시 고를 수 있게
  if (!file) return;

  let trips;
  try {
    trips = await share.readImportFile(file);
  } catch (err) {
    alert(err instanceof share.ShareError ? err.message : '파일을 읽지 못했습니다.');
    return;
  }

  const imported = [];
  const failed = [];
  for (const t of trips) {
    const { trip, saved, error } = model.importTrip(t);
    if (error) failed.push(`${t.title || '(제목 없음)'}: ${error}`);
    else {
      imported.push(trip);
      warnIfNotSaved(saved);
    }
  }

  if (imported.length) {
    if (isReadOnly()) exitSharedView();
    cancelPlaceEdit();
    state.currentTripId = imported[imported.length - 1].id;
    state.currentDate = null;
    renderAll();
  }
  let msg = `${imported.length}개의 여행을 가져왔습니다.`;
  if (failed.length) msg += `\n\n가져오지 못한 여행 ${failed.length}개:\n${failed.join('\n')}`;
  alert(msg);
});

// ───────────────────────── 시작 ─────────────────────────

function shorten(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// 404.html이 옛 주소에서 보내준 경우(?from=404) 주소창을 깔끔하게 정리한다. (공유 해시는 유지)
if (new URLSearchParams(location.search).has('from')) {
  history.replaceState(null, '', location.pathname + location.hash);
}

if (model.loadError) alert(model.loadError);
renderAll();
openSharedFromHash();
