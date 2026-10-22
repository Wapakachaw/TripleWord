// Rules and scoring checks. Run: npm test
const assert = require("assert");
const E = require("../public/engine.js");
const G = require("../lib/game.js");

const empty = () => new Array(225).fill(null);
const row = (word, r, c, opts = {}) => [...word].map((l, i) => ({ r, c: c + i, l, b: !!(opts.blanks || []).includes(i) }));
const col = (word, r, c) => [...word].map((l, i) => ({ r: r + i, c, l, b: false }));
const put = (b, ps) => ps.forEach(p => { b[p.r * 15 + p.c] = { l: p.l, b: p.b, p: 0 }; });

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("premium layout counts", () => {
  const c = k => E.PREMIUM.filter(x => x === k).length;
  assert.deepStrictEqual([c("TW"), c("DW"), c("TL"), c("DL")], [8, 17, 12, 24]);
  assert.strictEqual(E.PREMIUM[E.CENTER], "DW");
});

t("bag has 100 tiles", () => assert.strictEqual(E.newBag().length, 100));

t("first move must cover centre", () => {
  assert.strictEqual(E.evaluate(empty(), row("CAT", 0, 0)).ok, false);
});

t("first move CAT through centre = 10 (DW)", () => {
  const r = E.evaluate(empty(), row("CAT", 7, 6));
  assert.ok(r.ok); assert.strictEqual(r.score, (3 + 1 + 1) * 2);
});

t("first move single tile rejected", () => {
  assert.strictEqual(E.evaluate(empty(), [{ r: 7, c: 7, l: "A" }]).ok, false);
});

t("gaps rejected, filled gaps accepted", () => {
  const b = empty(); put(b, row("CAT", 7, 6));
  assert.strictEqual(E.evaluate(b, [{ r: 8, c: 5, l: "A" }, { r: 8, c: 9, l: "B" }]).ok, false);
  // extend CAT to CATS: S at (7,9)
  const r = E.evaluate(b, [{ r: 7, c: 9, l: "S" }]);
  assert.ok(r.ok); assert.deepStrictEqual(r.words.map(w => w.word), ["CATS"]); assert.strictEqual(r.score, 6);
});

t("disconnected move rejected", () => {
  const b = empty(); put(b, row("CAT", 7, 6));
  assert.strictEqual(E.evaluate(b, row("DOG", 0, 0)).ok, false);
});

t("cross words are scored and premiums only count once", () => {
  const b = empty(); put(b, row("CAT", 7, 6));
  // place "OX" below A forming vertical "AOX"? use valid geometry: column at c=7 from r=8: O,X -> word AOX
  const r = E.evaluate(b, col("OX", 8, 7));
  assert.ok(r.ok); assert.strictEqual(r.words[0].word, "AOX");
  // A at centre already placed: no DW again. O (8,7) none, X (9,7) none -> 1+1+8 = 10
  assert.strictEqual(r.score, 10);
});

t("parallel play scores each cross word", () => {
  const b = empty(); put(b, row("CAT", 7, 6));
  const r = E.evaluate(b, row("AT", 8, 6)); // forms CA, AT downwards + main AT
  assert.ok(r.ok);
  assert.deepStrictEqual(r.words.map(w => w.word).sort(), ["AT", "AT", "CA"]);
});

t("blank scores zero", () => {
  const r = E.evaluate(empty(), row("CAT", 7, 6, { blanks: [0] }));
  assert.strictEqual(r.score, (0 + 1 + 1) * 2);
});

t("bingo adds 50", () => {
  const r = E.evaluate(empty(), row("RETAINS", 7, 1));
  assert.ok(r.ok && r.bingo);
  // R(7,1) none, E(7,2)? none, T(7,3) DL, A,I none, N(7,6) none, S(7,7) DW → (1+1+2+1+1+1+1)*2 + 50 = 66
  assert.strictEqual(r.score, 66);
});

t("dictionary", () => {
  ["CAT", "QI", "ZA", "QUIXOTIC", "OK"].forEach(w => assert.ok(G.isWord(w), w));
  ["XYZZY", "QQ"].forEach(w => assert.ok(!G.isWord(w), w));
});

t("full server flow: create, join, start, play, exchange, pass", () => {
  const { room } = G.createRoom("ABCDE", "Ana");
  const b = G.joinRoom(room, "Ben");
  G.joinRoom(room, "Cy");
  assert.throws(() => G.joinRoom(room, "Dee"));
  G.startGame(room, 0);
  assert.strictEqual(room.bag.length, 100 - 21);
  // Force a known rack for current player
  const who = room.turn;
  room.players[who].rack = ["C", "A", "T", "?", "E", "E", "E"];
  assert.throws(() => G.play(room, who, row("DOG", 7, 6)), /aren't on your rack/);
  assert.throws(() => G.play(room, who, row("TCA", 7, 6)), /isn't a word/);
  G.play(room, who, row("CAT", 7, 6));
  assert.strictEqual(room.players[who].score, 10);
  assert.strictEqual(room.players[who].rack.length, 7);
  const next = room.turn;
  assert.notStrictEqual(next, who);
  const before = room.players[next].rack.slice(0, 2);
  G.exchange(room, next, before);
  assert.strictEqual(room.players[next].rack.length, 7);
  G.pass(room, room.turn);
  assert.strictEqual(room.turn, who);
  assert.ok(G.view(room, 1).rack === room.players[1].rack);
  assert.ok(!("bag" in G.view(room, 1)));
});

t("going out: bonus from opponents' racks", () => {
  const { room } = G.createRoom("ABCDF", "Ana");
  G.joinRoom(room, "Ben"); G.joinRoom(room, "Cy");
  G.startGame(room, 0);
  room.turn = 0; room.bag = [];
  room.players[0].rack = ["A", "T"];
  room.players[1].rack = ["Q"];      // 10
  room.players[2].rack = ["Z", "E"]; // 11
  G.play(room, 0, row("AT", 7, 7));
  assert.strictEqual(room.status, "over");
  assert.strictEqual(room.players[0].score, 4 + 21);
  assert.strictEqual(room.players[1].score, -10);
  assert.deepStrictEqual(room.result.winners, [0]);
});

t("six scoreless turns ends the game", () => {
  const { room } = G.createRoom("ABCDG", "Ana");
  G.joinRoom(room, "Ben"); G.joinRoom(room, "Cy");
  G.startGame(room, 0);
  for (let i = 0; i < 6; i++) G.pass(room, room.turn);
  assert.strictEqual(room.status, "over");
  assert.strictEqual(room.result.reason, "stalled");
});

console.log(`\n${n} checks passed`);
