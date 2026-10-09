// Интерфейс и ход игры Casino Hold'em.
(function () {
  'use strict';

  const P = window.Poker;
  const A = window.Account;
  const STORAGE_KEY = 'casino-holdem.v2';
  const LEGACY_KEY = 'casino-holdem.v1';
  const DEPOSIT_PRESETS = [100, 500, 1000, 5000];
  const CHIPS = [
    { v: 5, color: '#c62828' },
    { v: 10, color: '#1d4fa3' },
    { v: 25, color: '#2e7d32' },
    { v: 100, color: '#222222' },
    { v: 500, color: '#6a1b9a' },
  ];
  const DEAL_DELAY = 220;

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmt = n => n.toLocaleString('ru-RU');
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));

  // ---------- Сохранение ----------
  function loadSave() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || JSON.parse(localStorage.getItem(LEGACY_KEY));
    } catch (e) { /* нет хранилища — играем без сохранения */ }
    const s = A.migrate(raw, Date.now());
    A.forfeitPending(s, Date.now());
    return s;
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)); } catch (e) { /* игнорируем */ }
  }

  const save = loadSave();
  persist();
  try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* игнорируем */ }

  // phase: 'bet' — ставки; 'busy' — анимация; 'decision' — колл/фолд; 'result' — итог раздачи.
  const state = {
    phase: 'bet',
    ante: 0, bonus: 0, call: 0,
    player: [], dealer: [], board: [],
    bonusMult: 0,
  };

  // ---------- Карты ----------
  function cardEl(c, faceDown) {
    const el = document.createElement('div');
    if (!c) {
      el.className = 'card slot';
      return el;
    }
    el.className = 'card';
    el.dataset.id = c.id;
    if (faceDown) {
      el.classList.add('back');
      el.setAttribute('aria-label', 'Закрытая карта');
    } else {
      showFace(el, c);
    }
    return el;
  }

  function showFace(el, c) {
    const r = P.rankLabel(c.r);
    const s = P.SUIT_SYMBOL[c.s];
    el.classList.remove('back');
    el.classList.toggle('red', c.s === 'h' || c.s === 'd');
    el.setAttribute('aria-label', P.cardLabel(c));
    el.innerHTML =
      `<span class="corner">${r}<small>${s}</small></span>` +
      `<span class="pip">${s}</span>` +
      `<span class="corner br">${r}<small>${s}</small></span>`;
  }

  function setSlots(container, n) {
    container.replaceChildren(...Array.from({ length: n }, () => cardEl(null)));
  }

  function placeCard(container, index, c, faceDown) {
    container.children[index].replaceWith(cardEl(c, faceDown));
  }

  function flipCard(container, index, c) {
    const el = container.children[index];
    showFace(el, c);
    el.classList.remove('flip');
    void el.offsetWidth; // перезапуск анимации
    el.classList.add('flip');
  }

  function highlight(cards) {
    const ids = new Set(cards.map(c => c.id));
    document.querySelectorAll('.table .card[data-id]').forEach(el => {
      el.classList.toggle('hl', ids.has(el.dataset.id));
    });
  }

  function clearTableMarks() {
    document.querySelectorAll('.card.hl').forEach(el => el.classList.remove('hl'));
    document.querySelectorAll('.spot').forEach(el => el.classList.remove('won', 'lost'));
    $('dealer-hand').textContent = '';
    $('player-hand').textContent = '';
    $('result').innerHTML = '';
  }

  // ---------- Отрисовка состояния ----------
  function setMessage(text) {
    $('message').textContent = text;
  }

  function button(label, cls, onClick, disabled) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + (cls || '');
    b.textContent = label;
    b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  function canAfford(ante, bonus) {
    return ante * 3 + bonus <= save.balance;
  }

  function isBroke() {
    return save.balance < CHIPS[0].v * 3;
  }

  // Баланс с всплывающей разницей (+/−) при каждом изменении.
  let shownBalance = null;
  function renderBalance() {
    const el = $('balance');
    const d = shownBalance === null ? 0 : save.balance - shownBalance;
    shownBalance = save.balance;
    el.textContent = fmt(save.balance);
    if (!d) return;
    const tag = document.createElement('span');
    tag.className = 'delta ' + (d > 0 ? 'plus' : 'minus');
    tag.textContent = signed(d);
    tag.addEventListener('animationend', () => tag.remove());
    $('balance-delta').appendChild(tag);
    el.classList.remove('up', 'down');
    void el.offsetWidth; // перезапуск анимации
    el.classList.add(d > 0 ? 'up' : 'down');
  }

  function render() {
    renderBalance();
    $('amt-ante').textContent = state.ante ? fmt(state.ante) : '';
    $('amt-bonus').textContent = state.bonus ? fmt(state.bonus) : '';
    $('amt-call').textContent = state.call ? fmt(state.call) : '';

    const betting = state.phase === 'bet' || state.phase === 'result';
    $('spot-ante').disabled = !betting;
    $('spot-bonus').disabled = !betting;
    document.querySelectorAll('.chip').forEach(ch => {
      ch.disabled = !betting;
      ch.setAttribute('aria-checked', String(+ch.dataset.v === save.chip));
    });

    const actions = $('actions');
    const list = [];
    if (state.phase === 'bet') {
      if (isBroke() && !state.ante) {
        list.push(button('Пополнить счёт', 'primary', () => openAccount(true)));
      } else {
        list.push(button('Очистить', '', clearBets, !state.ante && !state.bonus));
        if (!state.ante && save.lastBets && canAfford(save.lastBets.ante, save.lastBets.bonus)) {
          list.push(button('Повторить ставку', 'primary', rebetAndDeal));
        } else {
          list.push(button('Раздать', 'primary', deal, !state.ante));
        }
      }
    } else if (state.phase === 'decision') {
      list.push(button('Фолд', 'danger', fold));
      list.push(button('Колл ' + fmt(state.ante * 2), 'primary', call));
    } else if (state.phase === 'result') {
      if (isBroke()) {
        list.push(button('Пополнить счёт', 'primary', () => openAccount(true)));
      } else {
        list.push(button('Новая ставка', '', newBet));
        list.push(button('Раздать снова', 'primary', rebetAndDeal,
          !save.lastBets || !canAfford(save.lastBets.ante, save.lastBets.bonus)));
      }
    }
    actions.replaceChildren(...list);

    const L = save.ledger;
    $('stats').textContent =
      `Раздач: ${fmt(L.hands)} · Выиграно: ${fmt(L.won)} · Проиграно: ${fmt(L.lost)} · ` +
      `Внесено: ${fmt(L.deposited)} · Итог игры: ${signed(L.won - L.lost)}`;
    if ($('account').open) renderAccount();
  }

  // ---------- Ставки ----------
  function startNewBetIfResult() {
    if (state.phase === 'result') {
      state.ante = state.bonus = state.call = 0;
      state.phase = 'bet';
      clearTableMarks();
    }
  }

  function addChip(spot) {
    startNewBetIfResult();
    if (state.phase !== 'bet') return;
    const v = save.chip;
    const ante = state.ante + (spot === 'ante' ? v : 0);
    const bonus = state.bonus + (spot === 'bonus' ? v : 0);
    if (!canAfford(ante, bonus)) {
      setMessage('Не хватает фишек: нужен запас на Колл (2× Анте).');
      return;
    }
    state.ante = ante;
    state.bonus = bonus;
    setMessage(state.ante ? 'Нажмите «Раздать».' : 'Поставьте Анте.');
    render();
  }

  function removeBet(spot) {
    startNewBetIfResult();
    if (state.phase !== 'bet') return;
    state[spot] = 0;
    setMessage(state.ante ? 'Нажмите «Раздать».' : 'Поставьте Анте.');
    render();
  }

  function clearBets() {
    state.ante = state.bonus = 0;
    setMessage('Поставьте Анте.');
    render();
  }

  function newBet() {
    startNewBetIfResult();
    setMessage('Выберите фишку и поставьте Анте (и AA Bonus по желанию).');
    render();
  }

  function rebetAndDeal() {
    const lb = save.lastBets;
    if (!lb || !canAfford(lb.ante, lb.bonus)) return;
    startNewBetIfResult();
    state.ante = lb.ante;
    state.bonus = lb.bonus;
    deal();
  }

  function resetTable() {
    clearTableMarks();
    setSlots($('dealer-cards'), 2);
    setSlots($('board-cards'), 5);
    setSlots($('player-cards'), 2);
  }

  // ---------- Ход игры ----------
  async function deal() {
    if (state.phase !== 'bet' || !state.ante || !canAfford(state.ante, state.bonus)) return;

    A.stake(save, state.ante + state.bonus);
    save.lastBets = { ante: state.ante, bonus: state.bonus };
    persist();

    state.phase = 'busy';
    state.call = 0;
    resetTable();
    setMessage('Раздача…');
    render();

    const deck = P.shuffle(P.makeDeck());
    state.player = [deck.pop(), deck.pop()];
    state.dealer = [deck.pop(), deck.pop()];
    state.board = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];

    const pc = $('player-cards'), dc = $('dealer-cards'), bc = $('board-cards');
    for (let i = 0; i < 2; i++) {
      placeCard(pc, i, state.player[i]);
      await sleep(DEAL_DELAY);
      placeCard(dc, i, state.dealer[i], true);
      await sleep(DEAL_DELAY);
    }
    for (let i = 0; i < 3; i++) {
      placeCard(bc, i, state.board[i]);
      await sleep(DEAL_DELAY);
    }

    const five = state.player.concat(state.board.slice(0, 3));
    const now = P.bestHand(five);
    $('player-hand').textContent = now.name;

    state.bonusMult = state.bonus ? P.bonusPays(five) : 0;
    if (state.bonus) {
      $('result').innerHTML = state.bonusMult
        ? `<span class="plus">AA Bonus сыграл: ${now.name} — ${state.bonusMult}:1</span>`
        : '<span class="minus">AA Bonus не сыграл</span>';
    }

    state.phase = 'decision';
    setMessage(`Колл (${fmt(state.ante * 2)}) или Фолд?`);
    render();
  }

  async function revealRest() {
    const bc = $('board-cards'), dc = $('dealer-cards');
    for (let i = 3; i < 5; i++) {
      placeCard(bc, i, state.board[i]);
      await sleep(DEAL_DELAY * 2);
    }
    for (let i = 0; i < 2; i++) {
      flipCard(dc, i, state.dealer[i]);
      await sleep(DEAL_DELAY);
    }
  }

  async function call() {
    if (state.phase !== 'decision') return;
    A.stake(save, state.ante * 2);
    state.call = state.ante * 2;
    persist();
    state.phase = 'busy';
    setMessage('Колл. Открываем терн и ривер…');
    render();

    await revealRest();

    const pBest = P.bestHand(state.player.concat(state.board));
    const dBest = P.bestHand(state.dealer.concat(state.board));
    $('player-hand').textContent = pBest.name;
    $('dealer-hand').textContent = dBest.name;

    const res = P.settleCall(state.ante, pBest, dBest);
    const messages = {
      noqualify: 'Дилер не квалифицировался — Анте выплачен, Колл возвращён.',
      win: 'Вы выиграли!',
      tie: 'Ничья — ставки возвращены.',
      lose: 'Дилер выиграл.',
    };
    setMessage(messages[res.outcome]);
    highlight(res.outcome === 'lose' ? dBest.cards : pBest.cards);

    const anteNote = res.outcome === 'win' || res.outcome === 'noqualify'
      ? `${P.HAND_NAMES[pBest.cat]}, ${P.antePays(pBest.cat)}:1` : '';
    finish([
      { spot: 'ante', label: 'Анте', stake: state.ante, ret: res.anteReturn, note: anteNote },
      { spot: 'call', label: 'Колл', stake: state.call, ret: res.callReturn,
        note: res.outcome === 'noqualify' ? 'возврат' : '' },
    ], `${HISTORY_OUTCOME[res.outcome]}: ${pBest.name} против «${dBest.name}»`);
  }

  async function fold() {
    if (state.phase !== 'decision') return;
    state.phase = 'busy';
    setMessage('Фолд.');
    render();

    await revealRest();
    const dBest = P.bestHand(state.dealer.concat(state.board));
    const pBest = P.bestHand(state.player.concat(state.board));
    $('dealer-hand').textContent = dBest.name;
    $('player-hand').textContent = pBest.name;

    const would = P.compareScores(pBest.score, dBest.score) > 0 || !P.dealerQualifies(dBest.score);
    setMessage('Вы сбросили карты.' + (would ? ' (Колл бы выиграл.)' : ''));
    finish([{ spot: 'ante', label: 'Анте', stake: state.ante, ret: 0, note: 'фолд' }], 'Фолд: ' + pBest.name);
  }

  // Расчёт выплат, обновление баланса и статистики.
  function finish(lines, historyNote) {
    if (state.bonus) {
      lines.push({
        spot: 'bonus', label: 'AA Bonus', stake: state.bonus,
        ret: state.bonusMult ? state.bonus * (state.bonusMult + 1) : 0,
        note: state.bonusMult ? state.bonusMult + ':1' : '',
      });
    }

    let staked = 0, returned = 0;
    const html = lines.map(l => {
      staked += l.stake;
      returned += l.ret;
      const net = l.ret - l.stake;
      $('spot-' + l.spot).classList.add(net > 0 ? 'won' : net < 0 ? 'lost' : 'push');
      const cls = net > 0 ? 'plus' : net < 0 ? 'minus' : '';
      const note = l.note ? ` <small>(${l.note})</small>` : '';
      return `${l.label}: <span class="${cls}">${signed(net)}</span>${note}`;
    });
    const total = returned - staked;
    const totalCls = total > 0 ? 'plus' : total < 0 ? 'minus' : '';
    html.push(`<span class="total ${totalCls}">Итого: ${signed(total)}</span>`);
    $('result').innerHTML = html.join(' · ');

    A.settle(save, returned, historyNote, Date.now());
    persist();

    state.phase = 'result';
    if (isBroke()) setMessage($('message').textContent + ' Фишки закончились.');
    render();
  }

  // ---------- Счёт ----------
  const HISTORY_OUTCOME = { noqualify: 'Дилер не играет', win: 'Выигрыш', tie: 'Ничья', lose: 'Проигрыш' };
  const HISTORY_TYPE = { start: 'Старт', deposit: 'Пополнение', hand: 'Раздача', reset: 'Сброс' };

  const fmtDate = t => new Date(t).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function renderAccount() {
    const L = save.ledger;
    const net = L.won - L.lost;
    const rows = [
      ['Баланс сейчас', fmt(save.balance), 'big'],
      ['Было на начало учёта', fmt(L.start)],
      ['Внесено', fmt(L.deposited)],
      ['Выиграно', signed(L.won), L.won ? 'plus' : ''],
      ['Проиграно', signed(-L.lost), L.lost ? 'minus' : ''],
      ['Итог игры', signed(net), net > 0 ? 'plus' : net < 0 ? 'minus' : ''],
      ['Раздач сыграно', fmt(L.hands)],
      ['Лучшая раздача', signed(L.best)],
    ];
    if (save.pending) rows.push(['В игре (на столе)', fmt(save.pending)]);
    $('ledger').innerHTML = rows
      .map(([k, v, cls]) => `<tr class="${cls || ''}"><td>${k}</td><td>${v}</td></tr>`).join('');
    $('ledger-since').textContent = 'Учёт ведётся с ' + fmtDate(L.since);

    $('history').innerHTML = save.history.slice().reverse().map(h => {
      const cls = h.amount > 0 ? 'plus' : h.amount < 0 ? 'minus' : '';
      const amount = h.type === 'reset' ? '' : (h.type === 'start' ? fmt(h.amount) : signed(h.amount));
      return `<li><span class="h-time">${fmtDate(h.t)}</span>` +
        `<span class="h-note">${h.type === 'hand' ? escapeHtml(h.note || 'Раздача') : HISTORY_TYPE[h.type] || ''}</span>` +
        `<span class="h-amt ${cls}">${amount}</span>` +
        `<span class="h-bal">${fmt(h.balance)}</span></li>`;
    }).join('');

    const inHand = state.phase === 'busy' || state.phase === 'decision';
    $('btn-reset-all').disabled = inHand;
    $('btn-reset-all').title = inHand ? 'Доступно после окончания раздачи' : '';
  }

  function openAccount(focusDeposit) {
    $('deposit-msg').textContent = '';
    renderAccount();
    if (!$('account').open) $('account').showModal();
    if (focusDeposit) {
      $('deposit-input').focus();
      $('deposit-input').select();
    }
  }

  function doDeposit(value) {
    const n = A.deposit(save, value, Date.now());
    if (!n) {
      $('deposit-msg').textContent = `Введите целое число от 1 до ${fmt(A.MAX_DEPOSIT)}.`;
      return;
    }
    persist();
    $('deposit-msg').textContent = `Счёт пополнен на ${fmt(n)}.`;
    if (state.phase === 'bet' || state.phase === 'result') {
      setMessage(`Счёт пополнен на ${fmt(n)}. Поставьте Анте.`);
    }
    render();
    renderAccount();
  }

  function bindAccount() {
    const presets = $('deposit-presets');
    for (const v of DEPOSIT_PRESETS) {
      presets.appendChild(button('+' + fmt(v), 'small', () => doDeposit(v)));
    }
    $('deposit-form').addEventListener('submit', e => {
      e.preventDefault();
      doDeposit($('deposit-input').value);
    });
    $('btn-reset-stats').addEventListener('click', () => {
      if (!confirm('Обнулить статистику и историю? Баланс останется ' + fmt(save.balance) + '.')) return;
      A.resetStats(save, Date.now());
      persist();
      render();
      renderAccount();
    });
    $('btn-reset-all').addEventListener('click', () => {
      if (state.phase === 'busy' || state.phase === 'decision') return;
      if (!confirm('Сбросить всё: баланс станет ' + fmt(A.START_BALANCE) + ', статистика и история обнулятся?')) return;
      A.resetAll(save, Date.now());
      persist();
      state.ante = state.bonus = state.call = 0;
      state.phase = 'bet';
      resetTable();
      setMessage('Новый банк: ' + fmt(A.START_BALANCE) + '. Поставьте Анте.');
      render();
      renderAccount();
    });
  }

  // ---------- Инициализация ----------
  function buildChips() {
    const box = $('chips');
    for (const ch of CHIPS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.v = ch.v;
      b.style.setProperty('--c', ch.color);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', 'Фишка ' + ch.v);
      b.textContent = ch.v;
      b.addEventListener('click', () => {
        save.chip = ch.v;
        persist();
        render();
      });
      box.appendChild(b);
    }
    if (!CHIPS.some(c => c.v === save.chip)) save.chip = 10;
  }

  function buildPaytables() {
    const row = (name, pays) => `<tr><td>${name}</td><td>${pays}:1</td></tr>`;
    $('pt-ante').innerHTML = P.ANTE_PAYTABLE
      .map(r => row(r.label || P.HAND_NAMES[r.cat], r.pays)).join('');
    $('pt-bonus').innerHTML = P.BONUS_PAYTABLE
      .map(r => row(r.label || P.HAND_NAMES[r.cat], r.pays)).join('');
  }

  function bindEvents() {
    for (const spot of ['ante', 'bonus']) {
      const el = $('spot-' + spot);
      el.addEventListener('click', () => addChip(spot));
      el.addEventListener('contextmenu', e => { e.preventDefault(); removeBet(spot); });
    }
    $('btn-rules').addEventListener('click', () => $('rules').showModal());
    $('btn-deposit').addEventListener('click', () => openAccount(true));
    $('btn-account').addEventListener('click', () => openAccount(false));
    $('stats').addEventListener('click', () => openAccount(false));
    bindAccount();

    document.addEventListener('keydown', e => {
      if (e.repeat || $('rules').open || $('account').open) return;
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (state.phase === 'decision') call();
        else if (state.phase === 'bet') state.ante ? deal() : rebetAndDeal();
        else if (state.phase === 'result') rebetAndDeal();
      } else if (e.code === 'KeyF' && state.phase === 'decision') {
        fold();
      }
    });
  }

  buildChips();
  buildPaytables();
  bindEvents();
  resetTable();
  setMessage(isBroke()
    ? 'Фишки закончились — пополните счёт.'
    : 'Выберите фишку и поставьте Анте (и AA Bonus по желанию).');
  render();
})();
