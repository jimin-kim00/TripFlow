// 화면 렌더링과 이벤트 처리. 데이터 변경은 반드시 model.js의 함수를 거친다.
// 원칙: 데이터를 바꾼 뒤에는 renderAll()(또는 필요한 render 함수)로 데이터 기준으로 다시 그린다.

import * as model from './model.js';

const state = {
  currentTripId: null,
  currentDate: null,
  editingTripId: null, // 여행 정보 수정 중이면 그 여행의 id
  editingPlaceId: null, // 일정 수정 중이면 그 일정의 id
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

const SAVE_FAILED_MSG = '저장에 실패했습니다. 브라우저 저장 공간이 부족하거나 저장이 차단되었을 수 있습니다.';

function warnIfNotSaved(saved) {
  if (!saved) alert(SAVE_FAILED_MSG);
}

// ───────────────────────── 렌더링 ─────────────────────────

function renderAll() {
  renderTripList();
  renderItinerary();
}

function renderTripList() {
  tripList.replaceChildren(
    ...model.getTrips().map((trip) => {
      const li = document.createElement('li');
      li.className = `trip-item ${trip.id === state.currentTripId ? 'active' : ''}`;
      li.textContent = `${trip.title} (${trip.destination})`;
      li.addEventListener('click', () => selectTrip(trip.id));
      return li;
    })
  );
}

function renderItinerary() {
  const trip = model.getTrip(state.currentTripId);
  noTripSelected.classList.toggle('hidden', !!trip);
  itineraryContent.classList.toggle('hidden', !trip);
  if (!trip) return;

  $('current-trip-title').textContent = trip.title;
  $('current-trip-info').textContent = `${trip.destination} | ${trip.startDate} ~ ${trip.endDate} (${trip.members}명)`;

  const dates = model.getSortedDates(trip);
  if (!dates.includes(state.currentDate)) state.currentDate = dates[0] ?? null;

  renderDateTabs(dates);
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

function renderPlaces() {
  const places = model.getPlaces(state.currentTripId, state.currentDate);

  if (places.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'place-empty';
    empty.textContent = '아직 등록된 일정이 없습니다. 위에서 장소를 추가해보세요.';
    placeList.replaceChildren(empty);
    return;
  }

  placeList.replaceChildren(...places.map(createPlaceItem));
}

function createPlaceItem(place) {
  const li = document.createElement('li');
  li.className = 'place-item';
  if (place.id === state.editingPlaceId) li.classList.add('editing');
  li.draggable = true;
  li.dataset.id = place.id;

  // 사용자 입력은 모두 textContent로 넣는다 (innerHTML 사용 시 XSS 위험)
  const info = document.createElement('div');
  info.className = 'place-info';

  const time = document.createElement('strong');
  time.textContent = place.time;
  const name = document.createElement('span');
  name.textContent = place.name;
  info.append(time, name);

  if (place.memo) {
    const memo = document.createElement('small');
    memo.className = 'place-memo';
    memo.textContent = place.memo;
    info.append(memo);
  }

  const actions = document.createElement('div');
  actions.className = 'place-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'text-btn';
  editBtn.textContent = '수정';
  editBtn.addEventListener('click', () => startPlaceEdit(place));

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'text-btn danger';
  deleteBtn.textContent = '삭제';
  deleteBtn.addEventListener('click', () => {
    if (!confirm(`'${place.name}' 일정을 삭제하시겠습니까?`)) return;
    if (state.editingPlaceId === place.id) cancelPlaceEdit();
    warnIfNotSaved(model.deletePlace(state.currentTripId, state.currentDate, place.id));
    renderPlaces();
  });

  actions.append(editBtn, deleteBtn);
  li.append(info, actions);

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

  return li;
}

// ───────────────────────── 여행 ─────────────────────────

function selectTrip(tripId) {
  if (state.currentTripId !== tripId) {
    cancelPlaceEdit();
    state.currentDate = null;
  }
  state.currentTripId = tripId;
  renderAll();
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

  if (state.editingTripId) {
    const tripId = state.editingTripId;
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
    state.currentTripId = tripId;
  } else {
    const { trip, saved } = model.createTrip(input);
    warnIfNotSaved(saved);
    tripForm.reset();
    state.currentTripId = trip.id;
    state.currentDate = null;
  }
  cancelPlaceEdit();
  renderAll();
});

function startTripEdit() {
  const trip = model.getTrip(state.currentTripId);
  if (!trip) return;
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

// ───────────────────────── 일정 ─────────────────────────

function readPlaceForm() {
  return {
    time: $('place-time').value,
    name: $('place-name').value,
    memo: $('place-memo').value,
  };
}

placeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state.currentTripId || !state.currentDate) return;

  const input = readPlaceForm();
  if (!input.name.trim()) {
    alert('장소명을 입력해주세요.');
    return;
  }

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
  placeSubmitBtn.textContent = '수정 완료';
  placeCancelBtn.classList.remove('hidden');
  placeForm.classList.add('editing');
  renderPlaces();
  $('place-name').focus();
}

function cancelPlaceEdit() {
  const wasEditing = state.editingPlaceId !== null;
  state.editingPlaceId = null;
  placeForm.reset();
  placeSubmitBtn.textContent = '장소 추가';
  placeCancelBtn.classList.add('hidden');
  placeForm.classList.remove('editing');
  if (wasEditing) renderPlaces();
}

placeCancelBtn.addEventListener('click', cancelPlaceEdit);

// ───────────────────────── 드래그 앤 드롭 ─────────────────────────

placeList.addEventListener('dragover', (e) => {
  const draggingItem = placeList.querySelector('.place-item.dragging');
  if (!draggingItem) return; // 파일 등 외부에서 끌어온 것은 무시
  e.preventDefault();

  // clientY는 화면(viewport) 기준이므로, 비교 대상도 같은 기준인 getBoundingClientRect()를 쓴다.
  // (기존 offsetTop은 문서 기준이라 스크롤하면 위치 계산이 어긋났다.)
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
  // 다시 그리기는 dragend에서 한다.
});

// ───────────────────────── 시작 ─────────────────────────

if (model.loadError) alert(model.loadError);
renderAll();
