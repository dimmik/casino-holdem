// Запуск: node --test
const test = require('node:test');
const assert = require('node:assert');
const P = require('../js/poker.js');

// 'As Kd 10h' -> карты
function cards(str) {
  const map = { A: 14, K: 13, Q: 12, J: 11 };
  return str.split(' ').map(t => {
    const s = t.slice(-1);
    const r = t.slice(0, -1);
    return { r: map[r] || +r, s, id: t };
  });
}

test('категории 5 карт', () => {
  assert.strictEqual(P.eval5(cards('As Ks Qs Js 10s'))[0], P.ROYAL_FLUSH);
  assert.strictEqual(P.eval5(cards('9h 8h 7h 6h 5h'))[0], P.STRAIGHT_FLUSH);
  assert.deepStrictEqual(P.eval5(cards('Ah 2h 3h 4h 5h')), [P.STRAIGHT_FLUSH, 5]);
  assert.strictEqual(P.eval5(cards('9h 9d 9s 9c 5h'))[0], P.QUADS);
  assert.strictEqual(P.eval5(cards('9h 9d 9s 5c 5h'))[0], P.FULL_HOUSE);
  assert.strictEqual(P.eval5(cards('2h 9h Jh 4h 5h'))[0], P.FLUSH);
  assert.deepStrictEqual(P.eval5(cards('Ah 2d 3h 4s 5h')), [P.STRAIGHT, 5]);
  assert.strictEqual(P.eval5(cards('10h Jd Qh Ks Ah'))[0], P.STRAIGHT);
  assert.strictEqual(P.eval5(cards('Qh Kd Ah 2s 3h'))[0], P.HIGH_CARD);
  assert.strictEqual(P.eval5(cards('9h 9d 9s 5c 4h'))[0], P.TRIPS);
  assert.strictEqual(P.eval5(cards('9h 9d 5s 5c 4h'))[0], P.TWO_PAIR);
  assert.strictEqual(P.eval5(cards('9h 9d 6s 5c 4h'))[0], P.PAIR);
});

test('сравнение и кикеры', () => {
  const a = P.eval5(cards('9h 9d As 5c 4h'));
  const b = P.eval5(cards('9s 9c Ks 5d 4d'));
  assert.strictEqual(P.compareScores(a, b), 1);
  const w = P.eval5(cards('Ah 2d 3h 4s 5h'));
  const s6 = P.eval5(cards('6h 2d 3h 4s 5h'));
  assert.strictEqual(P.compareScores(w, s6), -1);
});

test('лучшая рука из 7 карт', () => {
  const best = P.bestHand(cards('Ah Kh 2c 7d Qh Jh 10h'));
  assert.strictEqual(best.cat, P.ROYAL_FLUSH);
  const fh = P.bestHand(cards('9h 9d 9s 5c 5h 5d 2c'));
  assert.deepStrictEqual(fh.score, [P.FULL_HOUSE, 9, 5]);
});

test('квалификация дилера', () => {
  assert.ok(!P.dealerQualifies(P.eval5(cards('3h 3d As Kc 9h'))));
  assert.ok(P.dealerQualifies(P.eval5(cards('4h 4d As Kc 9h'))));
  assert.ok(P.dealerQualifies(P.eval5(cards('2h 2d 3s 3c 9h'))));
  assert.ok(!P.dealerQualifies(P.eval5(cards('Ah Qd 9s 3c 2h'))));
});

test('AA Bonus', () => {
  assert.strictEqual(P.bonusPays(cards('Ah Ad 9s 3c 2h')), 7);
  assert.strictEqual(P.bonusPays(cards('Kh Kd 9s 3c 2h')), 0);
  assert.strictEqual(P.bonusPays(cards('2h 2d 3s 3c 9h')), 7);
  assert.strictEqual(P.bonusPays(cards('9h 9d 9s 5c 5h')), 30);
  assert.strictEqual(P.bonusPays(cards('As Ks Qs Js 10s')), 100);
});

test('расчёт Колла', () => {
  const ante = 10;
  const pl = P.bestHand(cards('9h 9d 9s 5c 5h 2d 3c'));      // фулл-хаус
  const dNo = P.bestHand(cards('3h 3d 9s Kc Jh 2d 3c'));     // тройка, дилер играет
  const dealerNQ = P.bestHand(cards('Ah Qd 2s 6c 7h 3d 8c'));  // старшая карта, не играет
  assert.ok(!P.dealerQualifies(dealerNQ.score));
  let r = P.settleCall(ante, pl, dealerNQ);
  assert.strictEqual(r.outcome, 'noqualify');
  assert.strictEqual(r.anteReturn, 10 + 30);
  assert.strictEqual(r.callReturn, 20);

  assert.ok(P.dealerQualifies(dNo.score));
  r = P.settleCall(ante, pl, dNo);
  assert.strictEqual(r.outcome, 'win');
  assert.strictEqual(r.anteReturn, 40);
  assert.strictEqual(r.callReturn, 40);

  r = P.settleCall(ante, dNo, pl);
  assert.strictEqual(r.outcome, 'lose');
  assert.strictEqual(r.anteReturn + r.callReturn, 0);

  r = P.settleCall(ante, pl, pl);
  assert.strictEqual(r.outcome, 'tie');
  assert.strictEqual(r.anteReturn + r.callReturn, 30);
});

test('колода и тасовка', () => {
  const d = P.shuffle(P.makeDeck());
  assert.strictEqual(d.length, 52);
  assert.strictEqual(new Set(d.map(c => c.id)).size, 52);
});

test('теоретические вероятности в сумме дают 1', () => {
  const sum = P.HAND_PROB_7.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.001, sum);
});
