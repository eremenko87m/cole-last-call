(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const DATA = window.GAME_DATA || { evidence: {} };
  const STORAGE_KEY = 'cole-last-call-v1';
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

  function freshState() {
    const now = Date.now();
    return {
      version: 1,
      status: 'active',
      startedAt: now,
      deadline: now + DURATION_MS,
      finishedAt: null,
      visited: [],
      evidence: ['control'],
      flags: {
        cameraWoman: false,
        cameraMan: false,
        infoBoard: false,
        gateC4: false,
        womanUnlocked: false,
        noahUnlocked: false,
        phase2: false,
        b12Seen: false,
        routeR3Known: false,
        routesSeen: false,
        deliverySeen: false
      },
      witnesses: {
        barista: { limit: 3, history: [] },
        woman: { limit: 1, history: [] },
        noah: { limit: 2, history: [] }
      },
      finalUsed: false,
      warnings: { finalCall: false, gateClosing: false },
      logs: ['Расследование началось. Последний подтверждённый факт: 16:03 — паспорт был у Коула.'],
      rewardUrl: null
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) return null;
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
    state = freshState();
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

  function render() {
    if (!state) return;
    renderLocations();
    renderEvidence();
    renderLogs();
    updateColeSpeech();
    finalTheoryBtn.classList.toggle('hidden', !state.flags.phase2 || state.finalUsed || state.status !== 'active');
  }

  function updateColeSpeech() {
    let text = '«Я точно проходил контроль с паспортом. После этого я не выходил из терминала.»';
    if (state.flags.gateC4) text = '«Ноа нашёл мой паспорт? Значит, теперь нужно понять, куда аэропорт отправил его дальше.»';
    if (state.flags.b12Seen) text = '«На B12 меня уже не было — рейс перенесли. Куда отправляют невручённые документы?»';
    if (state.flags.deliverySeen) text = '«Кажется, цепочка почти восстановлена. Главное — не перепутать пункт назначения с текущим местонахождением.»';
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
      list.push({ id: 'b27', title: 'Новый Gate B27', desc: 'Логичная, но опасная версия', icon: '✈️' });
      list.push({ id: 'lostFound', title: 'Lost & Found', desc: 'Найден тёмно-синий предмет', icon: '🧳' });
      list.push({ id: 'protocol', title: 'Правила безопасности', desc: 'Что делают с невручённым паспортом', icon: '📑' });
    }
    if (state.flags.routeR3Known) list.push({ id: 'routes', title: 'Служебные маршруты', desc: 'Что означает R3?', icon: '🗺️' });
    if (state.flags.routesSeen) list.push({ id: 'delivery', title: 'Служба доставки', desc: 'Проверить путь S3 → PAH', icon: '📦' });
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
      <h3>Паспорт исчез внутри терминала</h3>
      <p>В 16:03 электронная система паспортного контроля зарегистрировала документ Коула. В 16:26 у выхода на посадку он обнаружил пропажу.</p>
      <div class="notice"><strong>Правило:</strong> вы сами выбираете порядок проверки локаций. У AI-свидетелей ограничено число вопросов. Таймер идёт в реальном времени.</div>
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
      default: return;
    }
  }

  function openBookstore() {
    addVisited('bookstore');
    addEvidence('bookstore');
    addLog('В книжном найден чек на тёмно-синий карманный блокнот — не каждый «синий предмет» на камерах обязательно паспорт.');
    saveState(); render();
    showModal(`
      <p class="eyebrow">AIRPORT BOOKS • 16:07:18</p>
      <h3>Чек Коула</h3>
      <div class="document">RUSSIAN POCKET PHRASEBOOK<br>NAVY POCKET NOTEBOOK<br>TRAVEL ADAPTER<br>BLACK PEN<br><br>VISA •••• 1842</div>
      <p>Важная деталь: у Коула появился ещё один небольшой тёмно-синий предмет, похожий по размеру на паспорт.</p>
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
    addLog('CCTV делает женщину в зелёном главным подозреваемым — но качество записи не позволяет определить предмет.');
    saveState(); render();
    showModal(`
      <p class="eyebrow">CAM 07 • ENLARGED</p>
      <h3>Женщина в зелёном</h3>
      <p>Она действительно забирает со столика небольшой тёмно-синий предмет. Лица Коула в этот момент в кадре почти не видно.</p>
      <div class="notice">Новая зацепка разблокирована: <strong>Женщина в зелёном</strong>. Она уже идёт на посадку и согласится ответить только на один вопрос.</div>
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
      <p>Этого пока недостаточно, чтобы установить пассажира. Возможно, поможет табло рейсов.</p>
    `);
  }

  function openInfo() {
    addVisited('info');
    state.flags.infoBoard = true;
    maybeUnlockGateC4();
    saveState(); render();
    const match = state.flags.cameraMan
      ? '<div class="notice">Сопоставление: <strong>232 + C4 = SQ232 Singapore</strong>. Gate C4 разблокирован.</div>'
      : '<div class="notice">Пока на табло нет очевидной связи с паспортом. Запомните номера рейсов и выходы.</div>';
    showModal(`
      <p class="eyebrow">FLIGHT INFORMATION • 16:20</p>
      <h3>Табло вылетов</h3>
      <div class="document">SQ232 • SINGAPORE • GATE C4 • BOARDING 16:32<br>NZ108 • AUCKLAND • GATE A9 • 16:41<br>JL406 • TOKYO • GATE D6 • 16:48<br>COLE ROUTE • GATE B12 • 17:03</div>
      ${match}
    `);
  }

  function maybeUnlockGateC4() {
    if (state.flags.cameraMan && state.flags.infoBoard) {
      state.flags.gateC4 = true;
      addEvidence('flightMatch');
      addLog('Сопоставлены «232 / C4»: мужчина направлялся на SQ232 Singapore. Открыт Gate C4.');
    }
  }

  function openGateC4() {
    addVisited('gateC4');
    addEvidence('doc617');
    addEvidence('gateChange');
    state.flags.noahUnlocked = true;
    state.flags.phase2 = true;
    addLog('Большой поворот: Dr Noah Reed не украл паспорт — он нашёл его под стулом и официально сдал сотруднице C4.');
    saveState(); render();
    showModal(`
      <p class="eyebrow">GATE C4 • FOUND DOCUMENT REPORT</p>
      <h3>Паспорт действительно нашли</h3>
      <div class="document">16:21:08<br>PASSENGER: DR NOAH REED<br>ITEM: AUSTRALIAN PASSPORT<br>OWNER: COLE<br>LOCATION FOUND: BENEATH A CHAIR, COFFEE CORNER<br><br>PASSENGER STATEMENT:<br>"Tried to return it to owner."<div class="stamp">ACCEPTED</div></div>
      <p>Но у C4 паспорта уже нет. Сотрудница поместила его в защищённый конверт <strong>DOC617</strong> и в 16:22 отправила на текущий выход Коула — <strong>B12</strong>.</p>
      <div class="notice">В 16:24, уже после отправки конверта, рейс Коула перенесли <strong>B12 → B27</strong>.</div>
    `);
  }

  function openB12() {
    addVisited('b12');
    state.flags.b12Seen = true;
    state.flags.routeR3Known = true;
    addEvidence('b12'); addEvidence('r3');
    addLog('DOC617 дошёл до старого B12 уже после смены гейта. Пакет не вручили и назначили на R3.');
    saveState(); render();
    showModal(`
      <p class="eyebrow">GATE B12 • SECURE LOG</p>
      <h3>Пакет опоздал к Коулу</h3>
      <div class="document">16:29:11 — DOC617 ARRIVED / B12<br>OWNER NOT PRESENT<br>FLIGHT RELOCATED TO B27<br>STATUS: U/D — UNDELIVERED<br>16:30 — ASSIGNED ROUTE: R3</div>
      <p>Коул уже ушёл на новый B27. Но защищённый паспорт нельзя просто передать случайному сотруднику и «перекинуть» на другой гейт.</p>
    `);
  }

  function openB27() {
    addVisited('b27'); addLog('B27 проверен: паспорт туда не поступал. Прямой маршрут «B12 → B27» оказался ложным.'); saveState(); render();
    showModal(`
      <p class="eyebrow">NEW GATE B27</p>
      <h3>Ложный след</h3>
      <div class="document">MR COLE ARRIVED: 16:25<br>SECURE DOCUMENT RECEIVED: NONE</div>
      <p>Паспорт сюда не доставляли. Нужен официальный маршрут невручённых защищённых документов.</p>
    `);
  }

  function openLostFound() {
    addVisited('lostFound'); addLog('Lost & Found: тёмно-синий дорожный бумажник из Coffee Corner принадлежит другому пассажиру.'); saveState(); render();
    showModal(`
      <p class="eyebrow">LOST & FOUND • 16:25</p>
      <h3>Почти идеальная ловушка</h3>
      <div class="document">ITEM: DARK BLUE TRAVEL WALLET<br>FOUND: COFFEE CORNER<br>CONTENTS: BANK CARDS, DRIVER LICENCE<br>OWNER: MICHAEL HARRIS</div>
      <p>Место, цвет и время совпадают. Но это не вещь Коула.</p>
    `);
  }

  function openProtocol() {
    addVisited('protocol'); addLog('Правила подтверждают: невручённый паспорт возвращают через централизованный защищённый маршрут, а не на новый гейт напрямую.'); saveState(); render();
    showModal(`
      <p class="eyebrow">SECURE DOCUMENT PROTOCOL</p>
      <h3>Почему паспорт не отправили на B27?</h3>
      <div class="document">If a protected identity document cannot be handed personally to its owner, gate staff MUST return it through the central secure-document route. Direct gate-to-gate transfer is prohibited.</div>
      <p>Значит, после B12 нужно искать не новый гейт, а внутренний маршрут <strong>R3</strong>.</p>
    `);
  }

  function openRoutes() {
    addVisited('routes');
    state.flags.routesSeen = true;
    addEvidence('hub');
    addLog('R3 расшифрован как Passenger Assistance Hub. Но конечный пункт маршрута ещё не доказывает, что DOC617 туда дошёл.');
    saveState(); render();
    showModal(`
      <p class="eyebrow">INTERNAL ROUTES</p>
      <h3>Что означает R3</h3>
      <div class="document">R1 — IMMIGRATION<br>R2 — LOST PROPERTY<br>R3 — PASSENGER ASSISTANCE HUB<br>R4 — AIRPORT POLICE</div>
      <div class="notice">Осторожно: <strong>назначение маршрута ≠ текущее местонахождение пакета</strong>.</div>
    `);
  }

  function openDelivery() {
    addVisited('delivery');
    state.flags.deliverySeen = true;
    addEvidence('security');
    addLog('Ключевая улика: коридор S3 → PAH закрыт; защищённые R3-пакеты временно направляются в Security Desk 2.');
    saveState(); render();
    showModal(`
      <p class="eyebrow">SECURE DELIVERY • OPERATIONS NOTICE</p>
      <h3>Почему DOC617 не дошёл до R3</h3>
      <div class="document">DOC617<br>16:31 — ACCEPTED AT S3<br>16:36 — EXPECTED PAH<br>16:36 — NO ARRIVAL SCAN<br><br>TEMPORARY NOTICE<br>CORRIDOR S3 → PASSENGER ASSISTANCE HUB<br>CLOSED 16:30–16:45<br><br>ALL SECURE R3 ITEMS DURING CLOSURE → SECURITY DESK 2</div>
      <p>Теперь можно восстановить весь путь паспорта. Кнопка «У меня есть версия» уже доступна на доске расследования.</p>
    `);
  }

  function witnessMeta(id) {
    const meta = {
      barista: { title: 'Бариста Coffee Corner', intro: '«Да, я помню Коула. Но у стойки очередь. Можете задать мне три вопроса.»' },
      woman: { title: 'Женщина в зелёном', intro: '«Да, на камере я. Но мой рейс уже объявляют. У вас один вопрос.»' },
      noah: { title: 'Dr Noah Reed', intro: '«Да, я нашёл паспорт. Я уже захожу в самолёт. У вас два вопроса.»' }
    };
    return meta[id];
  }

  function openWitness(id) {
    addVisited(id === 'barista' ? 'cafe' : id);
    saveState(); render();
    const w = state.witnesses[id];
    const meta = witnessMeta(id);
    const left = Math.max(0, w.limit - w.history.length);
    const chat = w.history.map(({ q, a }) => `<div class="bubble user">${escapeHtml(q)}</div><div class="bubble npc">${escapeHtml(a)}</div>`).join('');
    const form = left > 0 ? `
      <form class="witness-form" id="witnessForm">
        <input id="witnessInput" maxlength="500" autocomplete="off" placeholder="Задайте один конкретный вопрос…" required>
        <button type="submit">Спросить</button>
      </form>` : '<div class="notice">Допрос завершён. Больше вопросов этот свидетель не принимает.</div>';
    showModal(`
      <p class="eyebrow">AI-СВИДЕТЕЛЬ</p>
      <h3>${escapeHtml(meta.title)}</h3>
      <div class="witness-head"><span>${escapeHtml(meta.intro)}</span><span class="question-dots">${'●'.repeat(left)}${'○'.repeat(w.limit-left)}</span></div>
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
    const missingWarning = !state.flags.deliverySeen ? '<div class="notice">Вы ещё не проверили всю цепочку DOC617. Финальную версию всё равно можно отправить, но попытка одна.</div>' : '';
    showModal(`
      <p class="eyebrow">FINAL THEORY • ONE ATTEMPT</p>
      <h3>Что произошло с паспортом?</h3>
      ${missingWarning}
      <p>Объясните своими словами четыре вещи: <strong>как Коул потерял паспорт, кто его нашёл, что произошло с документом дальше и где он находится сейчас</strong>.</p>
      <form id="finalForm" class="final-form">
        <textarea id="finalAnswer" maxlength="1800" required placeholder="Моя версия…"></textarea>
        <div class="action-row"><button class="action-btn accent" type="submit">Отправить финальную версию</button></div>
      </form>
      <p class="notice">После отправки изменить версию нельзя. Новую попытку можно начать только с новой 37-минутной игры.</p>
    `, () => $('finalForm').addEventListener('submit', submitFinal));
  }

  async function submitFinal(event) {
    event.preventDefault();
    if (!isActive()) return loseGame('Время истекло.');
    if (state.finalUsed) return;
    if (!apiConfigured()) return showInlineError('AI backend пока не настроен.');
    const answer = ($('finalAnswer')?.value || '').trim();
    if (answer.length < 25) return showInlineError('Версия слишком короткая. Восстановите всю цепочку событий.');
    const btn = event.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Проверяем версию…';
    try {
      state.finalUsed = true;
      saveState(); render();
      const result = await callApi({ action: 'checkFinal', answer });
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
      <div class="warning-screen"><p class="eyebrow">DOC617 FOUND • BOARDING APPROVED</p><div class="big">✓</div><h3>Паспорт найден</h3><p>${escapeHtml(feedback || 'Вся цепочка восстановлена верно.')}</p><p>Мистер Коул успевает на рейс в Россию.</p>${reward}<div class="action-row"><button class="action-btn" data-action="restart">Сыграть ещё раз</button></div></div>
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
        <div class="warning-screen"><p class="eyebrow">FINAL CALL</p><div class="big">10:00</div><h3>Последний вызов мистера Коула</h3><p>Passenger Mr Cole, please proceed immediately to your boarding gate.</p><div class="notice">Осталось десять минут. Проверять всё подряд уже опасно.</div><div class="action-row"><button class="action-btn accent" data-close>Продолжить расследование</button></div></div>
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
