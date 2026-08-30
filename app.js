(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const DATA = window.GAME_DATA || { evidence: {} };
  const STORAGE_KEY = 'cole-last-call-v2';
  const DURATION_MS = (Number(CFG.gameDurationMinutes) || 37) * 60 * 1000;
  const FINAL_CALL_LEFT_MS = (Number(CFG.finalCallMinutesLeft) || 10) * 60 * 1000;
  const GATE_CLOSING_LEFT_MS = (Number(CFG.gateClosingMinutesLeft) || 3) * 60 * 1000;

  const $ = (id) => document.getElementById(id);
  const intro = $('intro');
  const game = $('game');
  const startGameBtn = $('startGame');
  const resumeGameBtn = $('resumeGame');
  const newGameBtn = $('newGame');
  const timerEl = $('timer');
  const locationsEl = $('locations');
  const evidenceListEl = $('evidenceList');
  const clueCountEl = $('clueCount');
  const eventLogEl = $('eventLog');
  const coleSpeechEl = $('coleSpeech');
  const finalTheoryBtn = $('finalTheoryBtn');
  const modalBackdrop = $('modalBackdrop');
  const modalContent = $('modalContent');
  const closeModalBtn = $('closeModal');

  let state = loadState();
  let timerId = null;
  let finalCheckInFlight = false;

  function freshState() {
    const now = Date.now();
    return {
      version: 2,
      status: 'active',
      startedAt: now,
      deadline: now + DURATION_MS,
      finishedAt: null,
      visited: [],
      evidence: ['control', 'gateChange'],
      flags: {
        cameraWoman: false,
        cameraMan: false,
        infoBoard: false,
        gateC4: false,
        gateC4Seen: false,
        womanUnlocked: false,
        noahUnlocked: false,
        phase2: false,
        b12Seen: false,
        routeR3Known: false,
        routesSeen: false,
        deliverySeen: false,
        directoryUnlocked: false,
        directorySeen: false
      },
      witnesses: {
        barista: { limit: 3, history: [] },
        woman: { limit: 1, history: [] },
        noah: { limit: 2, history: [] }
      },
      finalUsed: false,
      warnings: { finalCall: false, gateClosing: false },
      logs: ['16:40 — у Gate B27 Коул обнаружил пропажу папки с документами.', '16:24 — выход на рейс в Москву изменён с B12 на B27.'],
      rewardUrl: null
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 2) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      // Игра продолжит работать в памяти, даже если localStorage недоступен.
    }
  }

  function addEvidence(id) {
    if (!state.evidence.includes(id)) state.evidence.push(id);
  }

  function addVisited(id) {
    if (!state.visited.includes(id)) state.visited.push(id);
  }

  function addLog(text) {
    if (!state.logs.includes(text)) {
      state.logs.unshift(text);
      state.logs = state.logs.slice(0, 5);
    }
  }

  function isActive() {
    return state && state.status === 'active' && Date.now() < state.deadline;
  }

  function startNewGame() {
    stopTimer();
    finalCheckInFlight = false;
    state = freshState();
    // В каждой новой партии финальная версия доступна сразу.
    finalTheoryBtn.classList.remove('hidden');
    finalTheoryBtn.disabled = false;
    saveState();
    showGame();
    render();
    startTimer();
    openCaseStartModal();
  }

  function showGame() {
    intro.classList.add('hidden');
    game.classList.remove('hidden');
  }

  function showIntro() {
    game.classList.add('hidden');
    intro.classList.remove('hidden');
    const resumable = state && state.status === 'active' && Date.now() < state.deadline;
    resumeGameBtn.classList.toggle('hidden', !resumable);
  }

  function canOpenFinalTheory() {
    // Игрок может выдвинуть версию в любой момент активного расследования.
    // Это намеренная игровая механика: поспешная версия может оказаться ошибочной.
    return !!state && state.status === 'active' && !state.finalUsed;
  }

  function render() {
    if (!state) return;
    // Самовосстановление сохранённой партии: если DOC617 уже найден, вторая фаза точно открыта.
    if (state.evidence.includes('doc617')) state.flags.phase2 = true;
    renderLocations();
    renderEvidence();
    renderLogs();
    updateColeSpeech();
    finalTheoryBtn.classList.toggle('hidden', !canOpenFinalTheory());
    finalTheoryBtn.disabled = finalCheckInFlight;
  }

  function updateColeSpeech() {
    let text = '«На контроле папка с документами точно была у меня. После этого я не выходил из терминала.»';
    if (state.flags.gateC4Seen) text = '«Ноа действительно передал мою папку сотруднице C4. После этого её маршрут продолжился уже без меня.»';
    if (state.flags.b12Seen) text = '«Когда DOC617 прибыл на B12, я уже был у другого выхода. В журнале появилась отметка R3.»';
    if (state.flags.deliverySeen) text = '«DOC617 не дошёл до Passenger Assistance Hub. В журнале осталась служебная отметка.»';
    coleSpeechEl.textContent = text;
  }

  function locationList() {
    const list = [
      { id: 'bookstore', title: 'Книжный магазин', desc: 'Чек и покупки Коула', icon: '📚' },
      { id: 'cafe', title: 'Кафе', desc: witnessDesc('barista', 'Бариста • до 3 вопросов'), icon: '☕' },
      { id: 'cctv', title: 'Камеры CCTV', desc: 'Четыре фрагмента записи', icon: '🎥' },
      { id: 'info', title: 'Табло рейсов', desc: 'Рейсы и выходы на посадку', icon: 'ℹ️' }
    ];

    if (state.flags.womanUnlocked) list.push({ id: 'woman', title: 'Женщина в зелёном', desc: witnessDesc('woman', 'Только 1 вопрос'), icon: '👩' });
    if (state.flags.gateC4) list.push({ id: 'gateC4', title: 'Gate C4', desc: 'Служебная запись сотрудника', icon: '🛫' });
    if (state.flags.noahUnlocked) list.push({ id: 'noah', title: 'Dr Noah Reed', desc: witnessDesc('noah', 'До 2 вопросов'), icon: '👨‍🏫' });

    if (state.flags.phase2) {
      list.push({ id: 'b12', title: 'Старый Gate B12', desc: 'Куда отправили DOC617', icon: '🛫' });
      list.push({ id: 'b27', title: 'Новый Gate B27', desc: 'Проверить, поступали ли документы', icon: '✈️' });
      list.push({ id: 'lostFound', title: 'Lost & Found', desc: 'Найден тёмно-синий предмет', icon: '🧳' });
      list.push({ id: 'protocol', title: 'Правила безопасности', desc: 'Что делают с невручёнными документами', icon: '📑' });
    }
    if (state.flags.routeR3Known) list.push({ id: 'routes', title: 'Служебные маршруты', desc: 'Что означает R3?', icon: '🗺️' });
    if (state.flags.routesSeen) list.push({ id: 'delivery', title: 'Служба доставки', desc: 'Журнал движения DOC617', icon: '📦' });
    if (state.flags.directoryUnlocked) list.push({ id: 'directory', title: 'Справочник аэропорта', desc: 'Расшифровать служебные сокращения', icon: '🗂️' });
    return list;
  }

  function witnessDesc(id, fallback) {
    const w = state.witnesses[id];
    if (!w) return fallback;
    const left = Math.max(0, w.limit - w.history.length);
    return left > 0 ? `${left} вопрос${left === 1 ? '' : left < 5 ? 'а' : 'ов'} осталось` : 'Допрос завершён';
  }

  function renderLocations() {
    locationsEl.innerHTML = '';
    locationList().forEach((loc) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'location-btn';
      if (state.visited.includes(loc.id)) btn.classList.add('visited');
      if (!state.visited.includes(loc.id) && !['bookstore','cafe','cctv','info'].includes(loc.id)) btn.classList.add('new');
      btn.innerHTML = `<strong>${loc.icon} ${escapeHtml(loc.title)}</strong><span>${escapeHtml(loc.desc)}</span>`;
      btn.addEventListener('click', () => openLocation(loc.id));
      locationsEl.appendChild(btn);
    });
  }

  function renderEvidence() {
    evidenceListEl.innerHTML = '';
    state.evidence.forEach((id) => {
      const e = DATA.evidence[id];
      if (!e) return;
      const item = document.createElement('div');
      item.className = 'evidence-item';
      item.innerHTML = `<strong>✓ ${escapeHtml(e.title)}</strong><span>${escapeHtml(e.text)}</span>`;
      evidenceListEl.appendChild(item);
    });
    clueCountEl.textContent = String(state.evidence.length);
  }

  function renderLogs() {
    eventLogEl.innerHTML = '';
    state.logs.forEach((text) => {
      const div = document.createElement('div');
      div.className = 'log-item';
      div.textContent = text;
      eventLogEl.appendChild(div);
    });
  }

  function openCaseStartModal() {
    showModal(`
      <p class="eyebrow">СРОЧНО • SYDNEY AIRPORT</p>
      <h3>Папка с документами исчезла внутри терминала</h3>
      <p>В 16:03 Коул прошёл паспортный контроль с документами. В 16:24 его рейс перенесли с B12 на B27. В 16:40, уже у нового выхода, Коул обнаружил, что дорожная папка с паспортом и посадочным талоном исчезла.</p>
      <div class="notice"><strong>Правило:</strong> вы сами выбираете порядок проверки локаций. У некоторых свидетелей мало времени, поэтому число вопросов ограничено. Таймер идёт в реальном времени.</div>
      <div class="action-row"><button class="action-btn accent" data-close>Начать поиск</button></div>
    `);
  }

  function openLocation(id) {
    if (!isActive()) {
      loseGame('Время истекло.');
      return;
    }
    switch (id) {
      case 'bookstore': return openBookstore();
      case 'cafe': return openWitness('barista');
      case 'cctv': return openCctv();
      case 'info': return openInfo();
      case 'woman': return openWitness('woman');
      case 'gateC4': return openGateC4();
      case 'noah': return openWitness('noah');
      case 'b12': return openB12();
      case 'b27': return openB27();
      case 'lostFound': return openLostFound();
      case 'protocol': return openProtocol();
      case 'routes': return openRoutes();
      case 'delivery': return openDelivery();
      case 'directory': return openDirectory();
      default: return;
    }
  }

  function openBookstore() {
    addVisited('bookstore');
    addEvidence('bookstore');
    addLog('16:07 — чек Airport Books: Коул купил тёмно-синий карманный блокнот.');
    saveState(); render();
    showModal(`
      <p class="eyebrow">AIRPORT BOOKS • 16:07:18</p>
      <h3>Чек Коула</h3>
      <div class="document">RUSSIAN POCKET PHRASEBOOK<br>NAVY POCKET NOTEBOOK<br>TRAVEL ADAPTER<br>BLACK PEN<br><br>VISA •••• 1842</div>
      <p>В 16:07 Коул купил небольшой тёмно-синий карманный блокнот.</p>
    `);
  }

  function openCctv() {
    addVisited('cctv'); saveState(); render();
    showModal(`
      <p class="eyebrow">CCTV ARCHIVE</p>
      <h3>Камеры Coffee Corner</h3>
      <div class="document">CAM 03 • 16:10:04 — Коул входит в кафе.<br><br>CAM 07 • 16:13:31 — рядом появляется мужчина с зелёным чемоданом.<br><br>CAM 07 • 16:14:46 — женщина в зелёном наклоняется к столику и забирает небольшой тёмно-синий предмет.<br><br>CAM 09 • 16:18:12 — мужчина с зелёным чемоданом поднимает что-то с пола и быстро уходит.</div>
      <div class="action-row">
        <button class="action-btn" data-action="zoomWoman">Увеличить 16:14</button>
        <button class="action-btn" data-action="zoomMan">Увеличить 16:18</button>
      </div>
    `);
  }

  function zoomWoman() {
    state.flags.cameraWoman = true;
    state.flags.womanUnlocked = true;
    addEvidence('cameraWoman');
    addLog('16:14:46 — женщина в зелёном забирает со столика небольшой тёмно-синий предмет.');
    saveState(); render();
    showModal(`
      <p class="eyebrow">CAM 07 • ENLARGED</p>
      <h3>Женщина в зелёном</h3>
      <p>Она действительно забирает со столика небольшой тёмно-синий предмет. Лица Коула в этот момент в кадре почти не видно.</p>
      <div class="notice">Пассажирку удалось найти по записи камеры. Она уже направляется на посадку и согласна ответить только на один вопрос.</div>
    `);
  }

  function zoomMan() {
    state.flags.cameraMan = true;
    addEvidence('cameraMan');
    addLog('На посадочном талоне мужчины удалось разобрать только «232 / C4».');
    maybeUnlockGateC4();
    saveState(); render();
    showModal(`
      <p class="eyebrow">CAM 09 • ENLARGED</p>
      <h3>Мужчина с зелёным чемоданом</h3>
      <p>Он что-то поднимает из-под стула Коула и смотрит в сторону коридора. На уголке посадочного талона читаются:</p>
      <div class="document">…232<br>GATE C4</div>
    `);
  }

  function openInfo() {
    addVisited('info');
    state.flags.infoBoard = true;
    maybeUnlockGateC4();
    saveState(); render();
    const match = '';
    showModal(`
      <p class="eyebrow">FLIGHT INFORMATION • 16:20</p>
      <h3>Табло вылетов</h3>
      <div class="document">SQ232 • SINGAPORE • GATE C4 • BOARDING 16:32<br>NZ108 • AUCKLAND • GATE A9 • 16:41<br>JL406 • TOKYO • GATE D6 • 16:48<br>MOSCOW • GATE B12 • DEPARTURE 17:30</div>
      ${match}
    `);
  }

  function maybeUnlockGateC4() {
    if (state.flags.cameraMan && state.flags.infoBoard) {
      state.flags.gateC4 = true;
      addEvidence('flightMatch');
      addLog('Доступна новая точка проверки: Gate C4.');
    }
  }

  function openGateC4() {
    addVisited('gateC4');
    state.flags.gateC4Seen = true;
    addEvidence('doc617');
    addEvidence('gateChange');
    state.flags.noahUnlocked = true;
    state.flags.phase2 = true;
    addLog('16:21 — Dr Noah Reed передал сотруднице Gate C4 найденную в Coffee Corner папку Коула.');
    saveState(); render();
    // Gate C4 открывает вторую фазу расследования; кнопка версии уже доступна с начала игры.
    showModal(`
      <p class="eyebrow">GATE C4 • FOUND DOCUMENT REPORT</p>
      <h3>Found Document Report</h3>
      <div class="document">16:21:08<br>PASSENGER: DR NOAH REED<br>ITEM: DARK BLUE DOCUMENT WALLET<br>CONTENTS: AUSTRALIAN PASSPORT, BOARDING PASS<br>OWNER: COLE<br>LOCATION FOUND: BENEATH A CHAIR, COFFEE CORNER<br><br>PASSENGER STATEMENT:<br>"Tried to return it to owner."<div class="stamp">ACCEPTED</div></div>
      <p>В 16:22 сотрудница поместила папку в защищённый конверт <strong>DOC617</strong> и отправила его на указанный в посадочном талоне выход <strong>B12</strong>.</p>
      <div class="notice">16:24 — система аэропорта фиксирует смену выхода: <strong>B12 → B27</strong>.</div>
    `);
  }

  function openB12() {
    addVisited('b12');
    state.flags.b12Seen = true;
    state.flags.routeR3Known = true;
    addEvidence('b12'); addEvidence('r3');
    addLog('16:29 — DOC617 отмечен на B12 как U/D; в 16:30 ему назначен маршрут R3.');
    saveState(); render();
    showModal(`
      <p class="eyebrow">GATE B12 • SECURE LOG</p>
      <h3>Secure Log • B12</h3>
      <div class="document">16:29:11 — DOC617 ARRIVED / B12<br>OWNER NOT PRESENT<br>FLIGHT RELOCATED TO B27<br>STATUS: U/D — UNDELIVERED<br>16:30 — ASSIGNED ROUTE: R3</div>
      <p>В журнале следующая отметка после U/D — <strong>R3</strong>.</p>
    `);
  }

  function openB27() {
    addVisited('b27'); addLog('B27: в реестре входящих защищённых документов для Коула записей нет.'); saveState(); render();
    showModal(`
      <p class="eyebrow">NEW GATE B27</p>
      <h3>Gate B27 • Incoming Log</h3>
      <div class="document">MR COLE ARRIVED: 16:28<br>SECURE DOCUMENT RECEIVED: NONE</div>
      <p>В реестре B27 документ DOC617 не зарегистрирован.</p>
    `);
  }

  function openLostFound() {
    addVisited('lostFound'); addLog('Lost & Found: 16:25 зарегистрирован тёмно-синий travel wallet из Coffee Corner.'); saveState(); render();
    showModal(`
      <p class="eyebrow">LOST & FOUND • 16:25</p>
      <h3>Карточка найденной вещи</h3>
      <div class="document">ITEM: DARK BLUE TRAVEL WALLET<br>FOUND: COFFEE CORNER<br>CONTENTS: BANK CARDS, DRIVER LICENCE<br>OWNER: MICHAEL HARRIS</div>
    `);
  }

  function openProtocol() {
    addVisited('protocol'); addLog('Изучен протокол передачи невручённых удостоверяющих документов.'); saveState(); render();
    showModal(`
      <p class="eyebrow">SECURE DOCUMENT PROTOCOL</p>
      <h3>Secure Document Protocol</h3>
      <div class="document">If a protected identity document cannot be handed personally to its owner, gate staff MUST return it through the central secure-document route. Direct gate-to-gate transfer is prohibited.</div>
      
    `);
  }

  function openRoutes() {
    addVisited('routes');
    state.flags.routesSeen = true;
    addEvidence('hub');
    addLog('Справочник маршрутов: R3 — Passenger Assistance Hub.');
    saveState(); render();
    showModal(`
      <p class="eyebrow">INTERNAL ROUTES</p>
      <h3>Что означает R3</h3>
      <div class="document">R1 — IMMIGRATION<br>R2 — LOST PROPERTY<br>R3 — PASSENGER ASSISTANCE HUB<br>R4 — AIRPORT POLICE</div>
      
    `);
  }

  function openDelivery() {
    addVisited('delivery');
    state.flags.deliverySeen = true;
    state.flags.directoryUnlocked = true;
    addEvidence('deliveryHold');
    addLog('Журнал DOC617: 16:31 — S3; 16:36 — отметки о прибытии в PAH нет; действует HOLD SD-2.');
    saveState(); render();
    showModal(`
      <p class="eyebrow">SECURE DELIVERY • OPERATIONS NOTICE</p>
      <h3>Movement Log • DOC617</h3>
      <div class="document">DOC617<br>16:31 — ACCEPTED AT S3<br>16:36 — EXPECTED PAH<br>16:36 — NO ARRIVAL SCAN<br><br>TEMPORARY OPERATIONS NOTICE<br>CORRIDOR S3 → PAH<br>CLOSED 16:30–16:45<br>SECURE R3 ITEMS DURING CLOSURE: HOLD SD-2</div>
    `);
  }

  function openDirectory() {
    addVisited('directory');
    state.flags.directorySeen = true;
    addEvidence('security');
    addLog('Справочник служб: SD-2 — Security Desk 2.');
    saveState(); render();
    showModal(`
      <p class="eyebrow">AIRPORT SERVICE DIRECTORY</p>
      <h3>Служебные сокращения</h3>
      <div class="document">PAH — PASSENGER ASSISTANCE HUB<br>SD-1 — SECURITY DESK 1<br>SD-2 — SECURITY DESK 2<br>LF — LOST &amp; FOUND</div>
    `);
  }

  function witnessMeta(id) {
    const meta = {
      barista: { title: 'Бариста Coffee Corner', intro: '«Да, я помню Коула. Но у стойки очередь. Можете задать мне три вопроса.»' },
      woman: { title: 'Женщина в зелёном', intro: '«Да, на камере я. Но мой рейс уже объявляют. У вас один вопрос.»' },
      noah: { title: 'Dr Noah Reed', intro: '«Да, я нашёл папку с документами. Я уже захожу в самолёт. У вас два вопроса.»' }
    };
    return meta[id];
  }

  function witnessStatusLine(id, w, meta) {
    const used = w.history.length;
    if (id === 'barista') {
      if (used === 0) return meta.intro;
      if (used === 1) return '«У стойки становится людно. У вас ещё два вопроса.»';
      if (used === 2) return '«У меня уже очередь. Я отвечу ещё только на один вопрос. Подумайте, что важно.»';
      return '«Простите, мне нужно обслуживать клиентов.»';
    }
    if (id === 'noah') {
      if (used === 0) return meta.intro;
      if (used === 1) return '«Меня уже зовут на посадку. Отвечу ещё на один вопрос.»';
      return '«Мне нужно выключить телефон и заходить в самолёт.»';
    }
    if (id === 'woman') {
      if (used === 0) return meta.intro;
      return '«Мне пора на посадку.»';
    }
    return meta.intro;
  }

  function openWitness(id) {
    addVisited(id === 'barista' ? 'cafe' : id);
    saveState(); render();
    const w = state.witnesses[id];
    const meta = witnessMeta(id);
    const left = Math.max(0, w.limit - w.history.length);
    const statusLine = witnessStatusLine(id, w, meta);
    const chat = w.history.map(({ q, a }) => `<div class="bubble user">${escapeHtml(q)}</div><div class="bubble npc">${escapeHtml(a)}</div>`).join('');
    const form = left > 0 ? `
      <form class="witness-form" id="witnessForm">
        <input id="witnessInput" maxlength="500" autocomplete="off" placeholder="Задайте один конкретный вопрос…" required>
        <button type="submit">Спросить</button>
      </form>` : '<div class="notice">Допрос завершён. Больше вопросов этот свидетель не принимает.</div>';
    showModal(`
      <p class="eyebrow">ДОПРОС СВИДЕТЕЛЯ</p>
      <h3>${escapeHtml(meta.title)}</h3>
      <div class="witness-head"><span>${escapeHtml(statusLine)}</span><span class="question-dots">${'●'.repeat(left)}${'○'.repeat(w.limit-left)}</span></div>
      <div class="chat" id="chatBox">${chat || '<div class="bubble npc">'+escapeHtml(meta.intro)+'</div>'}</div>
      ${form}
      <p class="notice">Если в одном сообщении задать несколько вопросов, свидетель отвечает только на первый.</p>
    `, () => {
      const formEl = $('witnessForm');
      if (formEl) formEl.addEventListener('submit', (e) => submitWitnessQuestion(e, id));
    });
  }

  async function submitWitnessQuestion(event, id) {
    event.preventDefault();
    if (!isActive()) return loseGame('Время истекло.');
    const input = $('witnessInput');
    const question = (input?.value || '').trim();
    if (!question) return;
    const w = state.witnesses[id];
    if (w.history.length >= w.limit) return openWitness(id);
    if (!apiConfigured()) {
      return showInlineError('AI backend пока не настроен. В config.js нужно вставить URL Yandex Cloud Function.');
    }
    input.disabled = true;
    const submitBtn = input.form.querySelector('button');
    submitBtn.disabled = true;
    submitBtn.textContent = '…';
    try {
      const result = await callApi({ action: 'askWitness', witness: id, question, history: w.history });
      w.history.push({ q: question, a: result.answer });
      if (id === 'barista' && w.history.length === 2) addLog('Бариста предупреждает: остался только один вопрос.');
      if (w.history.length >= w.limit) addLog(`${witnessMeta(id).title}: лимит вопросов исчерпан.`);
      saveState(); render(); openWitness(id);
    } catch (err) {
      showInlineError(err.message || 'Не удалось получить ответ свидетеля.');
      input.disabled = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Спросить';
    }
  }

  function openFinalTheory() {
    if (!isActive()) return loseGame('Время истекло.');
    if (!canOpenFinalTheory()) return;
    if (finalCheckInFlight) return;
    const missingWarning = '';
    showModal(`
      <p class="eyebrow">FINAL THEORY</p>
      <h3>Что произошло с документами?</h3>
      ${missingWarning}
      <p>Объясните своими словами четыре вещи: <strong>как Коул потерял папку с документами, кто её нашёл, что произошло с ней дальше и где документы находятся сейчас</strong>.</p>
      <form id="finalForm" class="final-form">
        <textarea id="finalAnswer" maxlength="1800" required placeholder="Моя версия…"></textarea>
        <div class="action-row"><button class="action-btn accent" type="submit">Отправить финальную версию</button></div>
      </form>
      <p class="notice">В этой партии финальную версию можно отправить один раз. Новое расследование всегда можно начать заново с 37:00.</p>
    `, () => $('finalForm').addEventListener('submit', submitFinal));
  }

  async function submitFinal(event) {
    event.preventDefault();
    if (!isActive()) return loseGame('Время истекло.');
    if (state.finalUsed || finalCheckInFlight) return;
    if (!apiConfigured()) return showInlineError('AI backend пока не настроен.');
    const answer = ($('finalAnswer')?.value || '').trim();
    if (answer.length < 25) return showInlineError('Версия слишком короткая. Восстановите всю цепочку событий.');
    const btn = event.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Проверяем версию…';
    try {
      finalCheckInFlight = true;
      render();
      const result = await callApi({ action: 'checkFinal', answer });
      finalCheckInFlight = false;
      state.finalUsed = true;
      saveState(); render();
      if (result.correct) {
        winGame(result.rewardUrl, result.feedback);
      } else {
        state.status = 'lost';
        state.finishedAt = Date.now();
        saveState(); stopTimer();
        showModal(`
          <div class="warning-screen"><p class="eyebrow">VERSION REJECTED</p><div class="big">✕</div><h3>Цепочка не подтверждена</h3><p>${escapeHtml(result.feedback || 'В версии есть критическая ошибка.')}</p><div class="notice">Эта попытка завершена. Можно сразу начать новое расследование — снова с 37:00.</div><div class="action-row"><button class="action-btn accent" data-action="restart">Начать заново</button></div></div>
        `);
        render();
      }
    } catch (err) {
      finalCheckInFlight = false;
      state.finalUsed = false;
      saveState(); render();
      showInlineError(err.message || 'Не удалось проверить версию.');
      btn.disabled = false; btn.textContent = 'Отправить финальную версию';
    }
  }

  function winGame(rewardUrl, feedback) {
    state.status = 'won';
    state.finishedAt = Date.now();
    state.rewardUrl = rewardUrl || null;
    saveState(); stopTimer(); render();
    const reward = rewardUrl
      ? `<div class="reward-card"><strong>FOR TEACHERS ONLY</strong><p>Секретный файл Коула разблокирован только после успешного расследования.</p><a class="reward-link" href="${escapeAttr(rewardUrl)}" target="_blank" rel="noopener">Скачать подарок PDF</a></div>`
      : '<div class="notice">Победа засчитана, но REWARD_URL ещё не настроен в Yandex Cloud Function.</div>';
    showModal(`
      <div class="warning-screen"><p class="eyebrow">DOC617 FOUND • BOARDING APPROVED</p><div class="big">✓</div><h3>Документы найдены</h3><p>${escapeHtml(feedback || 'Вся цепочка восстановлена верно.')}</p><p>Мистер Коул успевает на рейс в Москву.</p>${reward}<div class="action-row"><button class="action-btn" data-action="restart">Сыграть ещё раз</button></div></div>
    `);
  }

  function loseGame(reason) {
    if (!state || state.status !== 'active') return;
    state.status = 'lost';
    state.finishedAt = Date.now();
    saveState(); stopTimer(); render();
    showModal(`
      <div class="warning-screen"><p class="eyebrow">BOARDING CLOSED</p><div class="big">✈</div><h3>Самолёт улетел</h3><p>${escapeHtml(reason || '37 минут закончились.')}</p><p>Коул остался в Австралии, но расследование можно начать заново без ограничений.</p><div class="action-row"><button class="action-btn accent" data-action="restart">Новое расследование</button></div></div>
    `);
  }

  function startTimer() {
    stopTimer();
    tick();
    timerId = setInterval(tick, 250);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function tick() {
    if (!state || state.status !== 'active') return stopTimer();
    const left = state.deadline - Date.now();
    if (left <= 0) {
      timerEl.textContent = '00:00';
      return loseGame('37 минут закончились. Выход на посадку закрыт.');
    }
    timerEl.textContent = formatTime(left);
    timerEl.parentElement.classList.toggle('urgent', left <= FINAL_CALL_LEFT_MS);

    if (left <= FINAL_CALL_LEFT_MS && !state.warnings.finalCall) {
      state.warnings.finalCall = true; saveState();
      showModal(`
        <div class="warning-screen"><p class="eyebrow">FINAL CALL</p><div class="big">10:00</div><h3>Последний вызов мистера Коула</h3><p>Passenger Mr Cole, please proceed immediately to your boarding gate.</p><div class="notice">До закрытия посадки осталось 10 минут.</div><div class="action-row"><button class="action-btn accent" data-close>Продолжить расследование</button></div></div>
      `);
    }
    if (left <= GATE_CLOSING_LEFT_MS && !state.warnings.gateClosing) {
      state.warnings.gateClosing = true; saveState();
      showModal(`
        <div class="warning-screen"><p class="eyebrow">GATE CLOSING</p><div class="big">03:00</div><h3>Три минуты</h3><p>Если версия готова, пора отправлять её. Следующий сигнал — закрытие посадки.</p><div class="action-row"><button class="action-btn accent" data-close>Продолжить</button></div></div>
      `);
    }
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function apiConfigured() {
    return CFG.apiUrl && !String(CFG.apiUrl).includes('PASTE_');
  }

  async function callApi(payload) {
    const res = await fetch(CFG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || !data?.ok) throw new Error(data?.error || `Ошибка сервера ${res.status}`);
    return data;
  }

  function showModal(html, onReady) {
    modalContent.innerHTML = html;
    modalBackdrop.classList.remove('hidden');
    modalContent.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeModal));
    modalContent.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', () => handleModalAction(el.dataset.action));
    });
    if (onReady) onReady();
  }

  function closeModal() {
    modalBackdrop.classList.add('hidden');
  }

  function handleModalAction(action) {
    if (action === 'zoomWoman') return zoomWoman();
    if (action === 'zoomMan') return zoomMan();
    if (action === 'restart') return startNewGame();
  }

  function showInlineError(message) {
    const existing = modalContent.querySelector('.inline-error');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'notice inline-error';
    div.textContent = message;
    modalContent.appendChild(div);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
  }
  function escapeAttr(value) { return escapeHtml(value); }

  startGameBtn.addEventListener('click', startNewGame);
  resumeGameBtn.addEventListener('click', () => { showGame(); render(); startTimer(); });
  newGameBtn.addEventListener('click', () => {
    if (confirm('Начать новую игру? Текущая попытка будет сброшена.')) startNewGame();
  });
  finalTheoryBtn.addEventListener('click', openFinalTheory);
  closeModalBtn.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modalBackdrop.classList.contains('hidden')) closeModal(); });

  if (state && state.status === 'active' && Date.now() >= state.deadline) {
    state.status = 'lost'; state.finishedAt = Date.now(); saveState();
  }
  showIntro();
})();
