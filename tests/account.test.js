// Запуск: node --test
const test = require('node:test');
const assert = require('node:assert');
const A = require('../js/account.js');

test('новый счёт', () => {
  const s = A.fresh(1);
  assert.strictEqual(s.balance, A.START_BALANCE);
  assert.strictEqual(A.expectedBalance(s), s.balance);
});

test('ставка, выигрыш и проигрыш', () => {
  const s = A.fresh(1);
  A.stake(s, 30);
  A.stake(s, 40);
  assert.strictEqual(s.balance, 930);
  assert.strictEqual(A.expectedBalance(s), s.balance);
  assert.strictEqual(A.settle(s, 150, 'win', 2), 80);
  assert.strictEqual(s.balance, 1080);
  A.stake(s, 50);
  assert.strictEqual(A.settle(s, 0, 'lose', 3), -50);
  assert.deepStrictEqual([s.ledger.won, s.ledger.lost, s.ledger.hands, s.ledger.best], [80, 50, 2, 80]);
  assert.strictEqual(A.expectedBalance(s), s.balance);
});

test('пополнение', () => {
  const s = A.fresh(1);
  assert.strictEqual(A.deposit(s, '1 000', 2), 1000);
  assert.strictEqual(A.deposit(s, -5, 2), 0);
  assert.strictEqual(A.deposit(s, 1.5, 2), 0);
  assert.strictEqual(A.deposit(s, A.MAX_DEPOSIT + 1, 2), 0);
  assert.strictEqual(s.balance, 2000);
  assert.strictEqual(s.ledger.deposited, 1000);
  assert.strictEqual(A.expectedBalance(s), s.balance);
});

test('прерванная раздача', () => {
  const s = A.fresh(1);
  A.stake(s, 100);
  A.forfeitPending(s, 2);
  assert.strictEqual(s.pending, 0);
  assert.strictEqual(s.ledger.lost, 100);
  assert.strictEqual(A.expectedBalance(s), s.balance);
});

test('сбросы', () => {
  const s = A.fresh(1);
  A.deposit(s, 500, 2);
  A.stake(s, 10);
  A.settle(s, 40, 'win', 3);
  A.resetStats(s, 4);
  assert.strictEqual(s.balance, 1530);
  assert.deepStrictEqual([s.ledger.start, s.ledger.won, s.ledger.deposited], [1530, 0, 0]);
  assert.strictEqual(A.expectedBalance(s), s.balance);
  s.chip = 25;
  A.resetAll(s, 5);
  assert.strictEqual(s.balance, A.START_BALANCE);
  assert.strictEqual(s.chip, 25);
});

test('миграция из версии 1', () => {
  const s = A.migrate({ balance: 1145, chip: 25, stats: { hands: 3, net: 145, best: 145 } }, 9);
  assert.strictEqual(s.v, 2);
  assert.strictEqual(s.balance, 1145);
  assert.strictEqual(s.ledger.won, 145);
  assert.strictEqual(A.expectedBalance(s), 1145);
  assert.strictEqual(A.migrate(null, 9).balance, A.START_BALANCE);
  assert.strictEqual(A.migrate({ junk: 1 }, 9).balance, A.START_BALANCE);
});

test('история ограничена', () => {
  const s = A.fresh(1);
  for (let i = 0; i < A.HISTORY_LIMIT + 20; i++) A.deposit(s, 1, i);
  assert.strictEqual(s.history.length, A.HISTORY_LIMIT);
});

test('статистика комбинаций', () => {
  const s = A.fresh(1);
  A.recordCombos(s, 4, 1);
  A.recordCombos(s, 4, 5);
  assert.strictEqual(s.ledger.combos.n, 2);
  assert.strictEqual(s.ledger.combos.player[4], 2);
  assert.strictEqual(s.ledger.combos.dealer[5], 1);
  A.resetStats(s, 2);
  assert.strictEqual(s.ledger.combos.n, 0);
  // старое сохранение v2 без комбинаций
  const old = A.fresh(1);
  delete old.ledger.combos;
  assert.strictEqual(A.migrate(old, 3).ledger.combos.n, 0);
});
