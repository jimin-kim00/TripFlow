# TripFlow ✈️

여행을 날짜와 시간별로 계획하고, 지도에서 동선을 확인하고, 링크로 공유하는 웹 서비스입니다.
프레임워크와 서버 없이 HTML/CSS/Vanilla JavaScript와 LocalStorage만으로 만들었습니다.

- 배포: https://jimin-kim00.github.io/TripFlow/

## 기능

| 기능 | 내용 |
|---|---|
| 여행 계획·일정 관리 | 여행 생성/수정/삭제, 기간에 맞춘 날짜별 탭, 장소 추가/수정/삭제, 드래그 앤 드롭으로 순서 변경 |
| 지도에서 일정 보기 | 장소 검색(OpenStreetMap)이나 지도 클릭으로 위치 지정, 번호 마커, 방문 순서 경로, 목록 ↔ 지도 연동 |
| 이동시간·일정 충돌 검사 | 장소 사이 예상 거리·시간(직선거리 기반 추정), 이동시간 부족/시간 역전 경고 |
| 일정 공유 | 읽기 전용 공유 링크, 내 여행으로 복사, JSON 내보내기/가져오기 |

## 로컬에서 실행

ES Module을 사용하므로 `index.html`을 더블클릭(`file://`)하면 동작하지 않습니다. 간단한 서버로 열어주세요.

```bash
python -m http.server 8000
```

그다음 http://localhost:8000 에 접속합니다.

## 구조

```
index.html
style.css
js/
  storage.js   LocalStorage 읽기/쓰기, 데이터 버전 변환(마이그레이션), 손상 데이터 복구
  model.js     여행·장소 데이터 변경 (DOM 없음)
  geo.js       거리·이동시간 추정, 일정 충돌 검사
  geocode.js   장소 검색 (Nominatim, 요청 간격 제한·캐시)
  map.js       Leaflet 지도 그리기
  share.js     공유 링크 인코딩/디코딩, JSON 내보내기/가져오기
  ui.js        화면 렌더링과 이벤트
```

### 데이터 구조 (LocalStorage `tripflow_data`)

```js
{
  version: 2,
  trips: [{
    id, title, destination, startDate, endDate, members, updatedAt,
    travelMode: 'transit' | 'walk' | 'car',
    center: { lat, lng } | null,          // 여행지 중심 (지도 기본 위치)
    itinerary: {
      '2027-01-15': [
        { id, time, name, memo, location: { lat, lng, address, source: 'search' | 'manual' } | null }
      ]
    }
  }]
}
```

### 공유 링크 방식

서버가 없으므로 여행 데이터를 압축(`deflate-raw`)해 URL의 해시(`#share=…`)에 담습니다.
해시는 서버로 전송되지 않으므로 여행 내용이 GitHub Pages 서버에 남지 않습니다.
링크를 연 사람은 읽기 전용으로 보고, 원하면 자기 여행으로 복사할 수 있습니다.

## 외부 서비스

- 지도: [Leaflet](https://leafletjs.com/) 1.9.4 + [OpenStreetMap](https://www.openstreetmap.org/copyright) 타일
- 장소 검색: [Nominatim](https://nominatim.org/) — 이용 규칙에 따라 버튼을 눌렀을 때만, 1초에 1번 이하로 요청합니다.

## 한계

- 이동시간은 실제 도로·노선이 아니라 직선거리 기반 추정치입니다.
- 데이터는 브라우저별로 저장됩니다. 공유는 '보내는 시점의 복사본'이며, 여러 사람이 동시에 편집·동기화하는 기능(편집자 권한 등)은 서버가 필요해 구현하지 않았습니다.
