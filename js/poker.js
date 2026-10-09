// Логика покера для Casino Hold'em: колода, оценка рук, выплаты.
// Работает и в браузере (window.Poker), и в Node (module.exports) — для тестов.
(function (root) {
  'use strict';

  const SUITS = ['s', 'h', 'd', 'c'];
  const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  // Категории комбинаций (чем больше, тем сильнее).
  const HIGH_CARD = 0, PAIR = 1, TWO_PAIR = 2, TRIPS = 3, STRAIGHT = 4,
    FLUSH = 5, FULL_HOUSE = 6, QUADS = 7, STRAIGHT_FLUSH = 8, ROYAL_FLUSH = 9;

  const HAND_NAMES = [
    'Старшая карта', 'Пара', 'Две пары', 'Тройка', 'Стрит',
    'Флеш', 'Фулл-хаус', 'Каре', 'Стрит-флеш', 'Роял-флеш',
  ];

  // Вероятность лучшей 5-карточной комбинации из 7 карт (в долях), по категориям.
  const HAND_PROB_7 = [
    0.17412, 0.43822, 0.23496, 0.04830, 0.04619,
    0.03025, 0.02596, 0.00168, 0.000248, 0.0000323,
  ];

  // Выплаты по Анте, когда игрок выигрывает (или дилер не квалифицировался).
  const ANTE_PAYTABLE = [
    { cat: ROYAL_FLUSH, pays: 100 },
    { cat: STRAIGHT_FLUSH, pays: 20 },
    { cat: QUADS, pays: 10 },
    { cat: FULL_HOUSE, pays: 3 },
    { cat: FLUSH, pays: 2 },
    { cat: STRAIGHT, pays: 1, label: 'Стрит и ниже' },
  ];

  // AA Bonus: по 2 картам игрока + флоп, от пары тузов и выше.
  const BONUS_PAYTABLE = [
    { cat: ROYAL_FLUSH, pays: 100 },
    { cat: STRAIGHT_FLUSH, pays: 50 },
    { cat: QUADS, pays: 40 },
    { cat: FULL_HOUSE, pays: 30 },
    { cat: FLUSH, pays: 20 },
    { cat: STRAIGHT, pays: 7 },
    { cat: TRIPS, pays: 7 },
    { cat: TWO_PAIR, pays: 7 },
    { cat: PAIR, pays: 7, label: 'Пара тузов' },
  ];

  function rankLabel(r) {
    return RANK_LABEL[r] || String(r);
  }

  function cardLabel(c) {
    return rankLabel(c.r) + SUIT_SYMBOL[c.s];
  }

  function makeDeck() {
    const deck = [];
    for (const s of SUITS) {
      for (let r = 2; r <= 14; r++) deck.push({ r, s, id: r + s });
    }
    return deck;
  }

  function randomInt(n) {
    const c = root.crypto || (typeof globalThis !== 'undefined' && globalThis.crypto);
    if (c && c.getRandomValues) {
      // Отбрасываем «хвост», чтобы не было смещения по модулю.
      const limit = Math.floor(0x100000000 / n) * n;
      const buf = new Uint32Array(1);
      do { c.getRandomValues(buf); } while (buf[0] >= limit);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  // Тасование Фишера–Йетса.
  function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  // Оценка ровно 5 карт. Возвращает массив-«счёт» [категория, ...тай-брейки].
  function eval5(cards) {
    const ranks = cards.map(c => c.r).sort((a, b) => b - a);
    const flush = cards.every(c => c.s === cards[0].s);

    const unique = [...new Set(ranks)];
    let straightHigh = 0;
    if (unique.length === 5) {
      if (unique[0] - unique[4] === 4) straightHigh = unique[0];
      else if (unique[0] === 14 && unique[1] === 5) straightHigh = 5; // A-2-3-4-5
    }

    if (straightHigh && flush) {
      return [straightHigh === 14 ? ROYAL_FLUSH : STRAIGHT_FLUSH, straightHigh];
    }

    // Группы одинаковых рангов: сначала по размеру, затем по рангу.
    const counts = {};
    for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
    const groups = Object.keys(counts)
      .map(r => ({ r: +r, n: counts[r] }))
      .sort((a, b) => b.n - a.n || b.r - a.r);
    const kickers = groups.map(g => g.r);

    if (groups[0].n === 4) return [QUADS, ...kickers];
    if (groups[0].n === 3 && groups[1].n === 2) return [FULL_HOUSE, ...kickers];
    if (flush) return [FLUSH, ...ranks];
    if (straightHigh) return [STRAIGHT, straightHigh];
    if (groups[0].n === 3) return [TRIPS, ...kickers];
    if (groups[0].n === 2 && groups[1].n === 2) return [TWO_PAIR, ...kickers];
    if (groups[0].n === 2) return [PAIR, ...kickers];
    return [HIGH_CARD, ...ranks];
  }

  function compareScores(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  // Лучшая 5-карточная комбинация из 5–7 карт.
  function bestHand(cards) {
    let best = null;
    const n = cards.length;
    const pick = [];
    (function rec(start) {
      if (pick.length === 5) {
        const hand = pick.map(i => cards[i]);
        const score = eval5(hand);
        if (!best || compareScores(score, best.score) > 0) best = { score, cards: hand };
        return;
      }
      for (let i = start; i <= n - (5 - pick.length); i++) {
        pick.push(i);
        rec(i + 1);
        pick.pop();
      }
    })(0);
    best.cat = best.score[0];
    best.name = describe(best.score);
    return best;
  }

  const RANK_GEN = {
    2: 'двоек', 3: 'троек', 4: 'четвёрок', 5: 'пятёрок', 6: 'шестёрок', 7: 'семёрок',
    8: 'восьмёрок', 9: 'девяток', 10: 'десяток', 11: 'валетов', 12: 'дам', 13: 'королей', 14: 'тузов',
  };

  // Человекочитаемое описание комбинации.
  function describe(score) {
    const [cat, a, b] = score;
    switch (cat) {
      case PAIR: return 'Пара ' + RANK_GEN[a];
      case TWO_PAIR: return 'Две пары: ' + RANK_GEN[a] + ' и ' + RANK_GEN[b];
      case TRIPS: return 'Тройка ' + RANK_GEN[a];
      case STRAIGHT: return 'Стрит до ' + rankLabel(a);
      case FLUSH: return 'Флеш, старшая ' + rankLabel(a);
      case FULL_HOUSE: return 'Фулл-хаус: ' + RANK_GEN[a] + ' и ' + RANK_GEN[b];
      case QUADS: return 'Каре ' + RANK_GEN[a];
      case STRAIGHT_FLUSH: return 'Стрит-флеш до ' + rankLabel(a);
      case ROYAL_FLUSH: return 'Роял-флеш';
      default: return 'Старшая карта ' + rankLabel(a);
    }
  }

  // Дилер играет с парой четвёрок или выше.
  function dealerQualifies(score) {
    return score[0] > PAIR || (score[0] === PAIR && score[1] >= 4);
  }

  function antePays(cat) {
    for (const row of ANTE_PAYTABLE) if (cat >= row.cat) return row.pays;
    return 1;
  }

  // Множитель AA Bonus (0 — ставка проиграна).
  function bonusPays(fiveCards) {
    const score = eval5(fiveCards);
    const cat = score[0];
    if (cat === PAIR) return score[1] === 14 ? 7 : 0;
    for (const row of BONUS_PAYTABLE) if (cat === row.cat) return row.pays;
    return 0;
  }

  // Полный расчёт раздачи после Колла.
  // Возвращает суммы, которые возвращаются игроку (ставка + выигрыш), по каждой ставке.
  function settleCall(ante, player, dealer) {
    const cmp = compareScores(player.score, dealer.score);
    const qualifies = dealerQualifies(dealer.score);
    const call = ante * 2;
    let outcome, anteReturn, callReturn;
    if (!qualifies) {
      outcome = 'noqualify';
      anteReturn = ante + ante * antePays(player.cat);
      callReturn = call;
    } else if (cmp > 0) {
      outcome = 'win';
      anteReturn = ante + ante * antePays(player.cat);
      callReturn = call * 2;
    } else if (cmp === 0) {
      outcome = 'tie';
      anteReturn = ante;
      callReturn = call;
    } else {
      outcome = 'lose';
      anteReturn = 0;
      callReturn = 0;
    }
    return { outcome, qualifies, anteReturn, callReturn };
  }

  const Poker = {
    SUIT_SYMBOL, HAND_NAMES, HAND_PROB_7, ANTE_PAYTABLE, BONUS_PAYTABLE,
    HIGH_CARD, PAIR, TWO_PAIR, TRIPS, STRAIGHT, FLUSH, FULL_HOUSE, QUADS, STRAIGHT_FLUSH, ROYAL_FLUSH,
    rankLabel, cardLabel, makeDeck, shuffle, eval5, compareScores, bestHand, describe,
    dealerQualifies, antePays, bonusPays, settleCall,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Poker;
  else root.Poker = Poker;
})(typeof window !== 'undefined' ? window : globalThis);
