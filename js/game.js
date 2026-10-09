// Интерфейс и ход игры Casino Hold'em.
(function () {
  'use strict';

  const P = window.Poker;
  const STORAGE_KEY = 'casino-holdem.v1';
  const START_BALANCE = 1000;
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
  function freshSave() {
    return { balance: START_BALANCE, chip: 10, lastBets: null, stats: { hands: 0, net: 0, best: 0 } };
  }

  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && Number.isFinite(s.balance) && s.stats) return s;
    } catch (e) { /* нет хранилища — играем без сохранения */ }
    return freshSave();
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)); } catch (e) { /* игнорируем */ }
  }

  let save = loadSave();

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

  function render() {
    $('balance').textContent = fmt(save.balance);
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
        list.push(button('Начать заново (' + fmt(START_BALANCE) + ')', 'primary', restart));
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
        list.push(button('Начать заново (' + fmt(START_BALANCE) + ')', 'primary', restart));
      } else {
        list.push(button('Новая ставка', '', newBet));
        list.push(button('Раздать снова', 'primary', rebetAndDeal,
          !save.lastBets || !canAfford(save.lastBets.ante, save.lastBets.bonus)));
      }
    }
    actions.replaceChildren(...list);

    const st = save.stats;
    $('stats').textContent =
      `Раздач: ${fmt(st.hands)} · Итог: ${signed(st.net)} · Лучший выигрыш за раздачу: ${fmt(st.best)}`;
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

  function restart() {
    const chip = save.chip;
    save = freshSave();
    save.chip = chip;
    persist();
    state.ante = state.bonus = state.call = 0;
    state.phase = 'bet';
    resetTable();
    setMessage('Новый банк: ' + fmt(START_BALANCE) + '. Поставьте Анте.');
    render();
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

    save.balance -= state.ante + state.bonus;
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
    save.balance -= state.ante * 2;
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
    ]);
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
    finish([{ spot: 'ante', label: 'Анте', stake: state.ante, ret: 0, note: 'фолд' }]);
  }

  // Расчёт выплат, обновление баланса и статистики.
  function finish(lines) {
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

    save.balance += returned;
    save.stats.hands += 1;
    save.stats.net += total;
    save.stats.best = Math.max(save.stats.best, total);
    persist();

    state.phase = 'result';
    if (isBroke()) setMessage($('message').textContent + ' Фишки закончились.');
    render();
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
    $('btn-reset').addEventListener('click', () => {
      if (state.phase === 'busy' || state.phase === 'decision') return;
      if (confirm('Сбросить баланс и статистику?')) restart();
    });

    document.addEventListener('keydown', e => {
      if (e.repeat || $('rules').open) return;
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
    ? 'Фишки закончились — начните заново.'
    : 'Выберите фишку и поставьте Анте (и AA Bonus по желанию).');
  render();
})();
