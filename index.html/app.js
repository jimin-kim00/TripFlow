let trips = JSON.parse(localStorage.getItem('tripflow_trips')) || [];
let currentTripId = null;
let currentSelectedDate = null;

const tripForm = document.getElementById('trip-form');
const tripList = document.getElementById('trip-list');
const itineraryContent = document.getElementById('itinerary-content');
const noTripSelected = document.getElementById('no-trip-selected');
const dateTabs = document.getElementById('date-tabs');
const placeForm = document.getElementById('place-form');
const placeList = document.getElementById('place-list');
const deleteTripBtn = document.getElementById('delete-trip-btn');

function getDatesInRange(startDate, endDate) {
  const dates = [];
  let curr = new Date(startDate);
  const end = new Date(endDate);
  while (curr <= end) {
    dates.push(curr.toISOString().split('T')[0]);
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

tripForm.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const title = document.getElementById('trip-title').value;
  const destination = document.getElementById('trip-destination').value;
  const startDate = document.getElementById('trip-start').value;
  const endDate = document.getElementById('trip-end').value;
  const members = document.getElementById('trip-members').value;

  if (new Date(startDate) > new Date(endDate)) {
    alert('종료일은 시작일보다 빠를 수 없습니다.');
    return;
  }

  const newDates = getDatesInRange(startDate, endDate);

  const newTrip = {
    id: 'trip_' + Date.now(),
    title,
    destination,
    startDate,
    endDate,
    members,
    itinerary: {}
  };

  newDates.forEach(date => newTrip.itinerary[date] = []);

  trips.push(newTrip);
  saveToLocalStorage();
  tripForm.reset();
  renderTripList();
  selectTrip(newTrip.id);
});

function selectTrip(tripId) {
  currentTripId = tripId;
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;

  noTripSelected.classList.add('hidden');
  itineraryContent.classList.remove('hidden');

  document.getElementById('current-trip-title').innerText = trip.title;
  document.getElementById('current-trip-info').innerText = `${trip.destination} | ${trip.startDate} ~ ${trip.endDate} (${trip.members}명)`;

  renderDateTabs(trip);
  renderTripList();
}

function renderDateTabs(trip) {
  dateTabs.innerHTML = '';
  const dates = Object.keys(trip.itinerary).sort();
  
  if (!currentSelectedDate || !dates.includes(currentSelectedDate)) {
    currentSelectedDate = dates[0];
  }

  dates.forEach((date, index) => {
    const btn = document.createElement('button');
    btn.className = `tab-btn ${date === currentSelectedDate ? 'active' : ''}`;
    btn.innerText = `Day ${index + 1} (${date.slice(5)})`;
    btn.addEventListener('click', () => {
      currentSelectedDate = date;
      renderDateTabs(trip);
      renderPlaces();
    });
    dateTabs.appendChild(btn);
  });

  renderPlaces();
}

placeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!currentTripId || !currentSelectedDate) return;

  const time = document.getElementById('place-time').value;
  const name = document.getElementById('place-name').value;
  const memo = document.getElementById('place-memo').value;

  const trip = trips.find(t => t.id === currentTripId);
  trip.itinerary[currentSelectedDate].push({
    id: 'place_' + Date.now(),
    time,
    name,
    memo
  });

  saveToLocalStorage();
  placeForm.reset();
  renderPlaces();
});

function deletePlace(placeId) {
  const trip = trips.find(t => t.id === currentTripId);
  trip.itinerary[currentSelectedDate] = trip.itinerary[currentSelectedDate].filter(p => p.id !== placeId);
  saveToLocalStorage();
  renderPlaces();
}

function renderPlaces() {
  placeList.innerHTML = '';
  const trip = trips.find(t => t.id === currentTripId);
  const places = trip.itinerary[currentSelectedDate] || [];

  places.forEach((place, index) => {
    const li = document.createElement('li');
    li.className = 'place-item';
    li.draggable = true;
    li.dataset.index = index;

    li.innerHTML = `
      <div class="place-info">
        <strong>${place.time}</strong> ${place.name}
        <small style="color: #718096; display: block;">${place.memo}</small>
      </div>
      <button class="delete-place-btn" onclick="deletePlace('${place.id}')">삭제</button>
    `;

    li.addEventListener('dragstart', (e) => {
      li.classList.add('dragging');
      e.dataTransfer.setData('text/plain', index);
    });

    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
    });

    placeList.appendChild(li);
  });
}

placeList.addEventListener('dragover', (e) => {
  e.preventDefault();
  const draggingItem = document.querySelector('.dragging');
  const siblings = [...placeList.querySelectorAll('.place-item:not(.dragging)')];
  
  const nextSibling = siblings.find(sibling => {
    return e.clientY <= sibling.offsetTop + sibling.offsetHeight / 2;
  });

  placeList.insertBefore(draggingItem, nextSibling);
});

placeList.addEventListener('drop', (e) => {
  e.preventDefault();
  const trip = trips.find(t => t.id === currentTripId);
  const places = trip.itinerary[currentSelectedDate];
  
  const updatedPlaces = [];
  const items = placeList.querySelectorAll('.place-item');
  items.forEach(item => {
    const oldIndex = item.dataset.index;
    updatedPlaces.push(places[oldIndex]);
  });

  trip.itinerary[currentSelectedDate] = updatedPlaces;
  saveToLocalStorage();
  renderPlaces();
});

deleteTripBtn.addEventListener('click', () => {
  if (confirm('이 여행과 연관된 모든 날짜별 일정이 함께 삭제됩니다. 정말 삭제하시겠습니까?')) {
    trips = trips.filter(t => t.id !== currentTripId);
    saveToLocalStorage();
    
    currentTripId = null;
    currentSelectedDate = null;
    itineraryContent.classList.add('hidden');
    noTripSelected.classList.remove('hidden');
    renderTripList();
  }
});

function renderTripList() {
  tripList.innerHTML = '';
  trips.forEach(trip => {
    const li = document.createElement('li');
    li.className = `trip-item ${trip.id === currentTripId ? 'active' : ''}`;
    li.innerText = `${trip.title} (${trip.destination})`;
    li.addEventListener('click', () => selectTrip(trip.id));
    tripList.appendChild(li);
  });
}

function saveToLocalStorage() {
  localStorage.setItem('tripflow_trips', JSON.stringify(trips));
}

renderTripList();