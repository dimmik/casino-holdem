// Счёт игрока: баланс, пополнения, учёт выигрышей/проигрышей и история.
// Чистые функции над объектом сохранения — работают и в браузере, и в Node (тесты).
(function (root) {
  'use strict';

  const START_BALANCE = 1000;
  const MAX_DEPOSIT = 1000000;
  const HISTORY_LIMIT = 100;

  function freshLedger(now, start) {
    return { since: now, start, deposited: 0, won: 0, lost: 0, hands: 0, best: 0 };
  }

  function fresh(now) {
    return {
      v: 2,
      balance: START_BALANCE,
      chip: 10,
      lastBets: null,
      pending: 0,
      ledger: freshLedger(now, START_BALANCE),
      history: [{ t: now, type: 'start', amount: START_BALANCE, balance: START_BALANCE, note: 'Стартовый банк' }],
    };
  }

  const isNum = n => typeof n === 'number' && Number.isFinite(n);

  // Загрузка сохранения любой версии; неизвестные/битые данные — новый счёт.
  function migrate(raw, now) {
    if (raw && raw.v === 2 && isNum(raw.balance) && raw.ledger && Array.isArray(raw.history)) {
      raw.pending = isNum(raw.pending) ? raw.pending : 0;
      return raw;
    }
    if (raw && isNum(raw.balance) && raw.stats) {
      // Версия 1: был только чистый итог — раскладываем его на выигрыш/проигрыш.
      const net = isNum(raw.stats.net) ? raw.stats.net : 0;
      const s = fresh(now);
      s.balance = raw.balance;
      s.chip = raw.chip || 10;
      s.lastBets = raw.lastBets || null;
      s.ledger.start = raw.balance - net;
      s.ledger.won = Math.max(net, 0);
      s.ledger.lost = Math.max(-net, 0);
      s.ledger.hands = raw.stats.hands || 0;
      s.ledger.best = raw.stats.best || 0;
      s.history = [{ t: now, type: 'start', amount: s.ledger.start, balance: raw.balance, note: 'Перенесено из прошлой версии' }];
      return s;
    }
    return fresh(now);
  }

  function log(s, entry) {
    s.history.push(entry);
    if (s.history.length > HISTORY_LIMIT) s.history.splice(0, s.history.length - HISTORY_LIMIT);
  }

  // Ставка уходит со счёта и «висит» до расчёта раздачи.
  function stake(s, amount) {
    if (amount > s.balance) throw new Error('Недостаточно средств');
    s.balance -= amount;
    s.pending += amount;
  }

  // Расчёт раздачи: returned — всё, что вернулось игроку (ставки + выигрыш).
  function settle(s, returned, note, now) {
    const net = returned - s.pending;
    s.balance += returned;
    s.pending = 0;
    const L = s.ledger;
    L.hands += 1;
    if (net > 0) L.won += net;
    else L.lost += -net;
    L.best = Math.max(L.best, net);
    log(s, { t: now, type: 'hand', amount: net, balance: s.balance, note });
    return net;
  }

  // Раздача, прерванная перезагрузкой страницы, считается проигранной.
  function forfeitPending(s, now) {
    if (s.pending > 0) settle(s, 0, 'Раздача прервана', now);
  }

  function parseAmount(v) {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, ''));
    return Number.isInteger(n) && n > 0 && n <= MAX_DEPOSIT ? n : 0;
  }

  function deposit(s, amount, now) {
    const n = parseAmount(amount);
    if (!n) return 0;
    s.balance += n;
    s.ledger.deposited += n;
    log(s, { t: now, type: 'deposit', amount: n, balance: s.balance, note: 'Пополнение' });
    return n;
  }

  // Обнулить учёт, оставив текущий баланс.
  function resetStats(s, now) {
    s.ledger = freshLedger(now, s.balance + s.pending);
    s.history = [{ t: now, type: 'reset', amount: 0, balance: s.balance, note: 'Статистика сброшена' }];
  }

  // Всё с нуля: стартовый банк, пустая статистика.
  function resetAll(s, now) {
    const chip = s.chip;
    Object.assign(s, fresh(now));
    s.chip = chip;
  }

  // Баланс, который должен получиться по учёту (для проверки целостности).
  function expectedBalance(s) {
    const L = s.ledger;
    return L.start + L.deposited + L.won - L.lost - s.pending;
  }

  const Account = {
    START_BALANCE, MAX_DEPOSIT, HISTORY_LIMIT,
    fresh, migrate, stake, settle, forfeitPending, parseAmount, deposit, resetStats, resetAll, expectedBalance,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Account;
  else root.Account = Account;
})(typeof window !== 'undefined' ? window : globalThis);
