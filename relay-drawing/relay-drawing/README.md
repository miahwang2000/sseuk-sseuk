# 그림 릴레이 (MVP)

갈틱폰 스타일 릴레이 그림 게임입니다. 학생은 각자 기기로, 선생님은 진행 화면으로 참여합니다.

## 파일
- `index.html` : 학생 화면
- `host.html` : 선생님 진행 화면 (TV에 띄우는 화면)
- `js/common.js` : Firebase 연결 설정 (설정값이 이미 들어 있음)
- `database.rules.json` : Firebase 보안 규칙

## 처음 한 번만: 보안 규칙 게시
1. Firebase 콘솔 → Realtime Database → **규칙** 탭
2. 안에 있는 내용을 모두 지우고 `database.rules.json` 내용을 붙여넣기
3. **게시** 누르기

## 올리기 (GitHub Pages)
`relay-drawing` 폴더를 통째로 저장소에 올리면 됩니다.
- 선생님: `https://miahwang2000.github.io/relay-drawing/host.html`
- 학생: `https://miahwang2000.github.io/relay-drawing/`

파일을 더블클릭해서 여는 방식(file://)으로는 동작하지 않습니다. 꼭 GitHub Pages 주소로 여세요.

## 테스트할 때 주의
같은 브라우저의 여러 탭은 같은 학생으로 인식됩니다. 학생 두 명을 흉내 내려면 휴대폰, 태블릿처럼 서로 다른 기기나 서로 다른 브라우저를 쓰세요.
