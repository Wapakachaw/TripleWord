// Server-side game rules: rooms, turns, scoring, end of game.
const crypto = require("crypto");
const Engine = require("../public/engine.js");
const WORDS = new Set(require("./words.js").split(" "));

const MAX_PLAYERS = 3;
const MIN_PLAYERS = 2;
const NAME_MAX = 16;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid confusion

class GameError extends Error {
  constructor(message, status = 400, extra) { super(message); this.status = status; if (extra) Object.assign(this, extra); }
}

const rand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const token = () => crypto.randomBytes(16).toString("hex");

function newCode() {
  let s = "";
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return s;
}

function cleanName(name) {
  const n = String(name || "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  if (!n) throw new GameError("Enter a name so your friends know who you are.");
  return n;
}

function isWord(w) { return WORDS.has(w.toLowerCase()); }

function createRoom(code, name) {
  const t = token();
  const room = {
    code, version: 1, createdAt: Date.now(), updatedAt: Date.now(),
    status: "lobby",
    settings: { checkWords: true },
    hostIndex: 0,
    players: [{ name: cleanName(name), token: t, score: 0, rack: [] }],
    board: new Array(225).fill(null),
    bag: [], turn: 0, scorelessTurns: 0, lastMove: null, log: [], result: null
  };
  return { room, playerIndex: 0, token: t };
}

function joinRoom(room, name) {
  if (room.status !== "lobby") throw new GameError("This game has already started. Ask the host for a rematch link.", 409);
  if (room.players.length >= MAX_PLAYERS) throw new GameError("This room already has 3 players.", 409);
  const n = cleanName(name);
  if (room.players.some(p => p.name.toLowerCase() === n.toLowerCase())) {
    throw new GameError("Someone in this room already uses that name. Pick another.", 409);
  }
  const t = token();
  room.players.push({ name: n, token: t, score: 0, rack: [] });
  return { playerIndex: room.players.length - 1, token: t };
}

function playerByToken(room, t) {
  const i = room.players.findIndex(p => p.token === t);
  if (i === -1) throw new GameError("You're not a player in this room. Join from the lobby.", 403);
  return i;
}

function draw(room, p, n) {
  while (n-- > 0 && room.bag.length) room.players[p].rack.push(room.bag.pop());
}

function startGame(room, who, settings) {
  if (who !== room.hostIndex) throw new GameError("Only the host can start the game.", 403);
  if (room.status === "playing") throw new GameError("The game is already running.", 409);
  if (room.players.length < MIN_PLAYERS) throw new GameError("Wait for at least one more player to join.");
  if (settings && typeof settings.checkWords === "boolean") room.settings.checkWords = settings.checkWords;
  room.status = "playing";
  room.board = new Array(225).fill(null);
  room.bag = Engine.newBag(rand);
  room.players.forEach((p, i) => { p.score = 0; p.rack = []; draw(room, i, Engine.RACK_SIZE); });
  room.turn = crypto.randomInt(0, room.players.length);
  room.scorelessTurns = 0;
  room.lastMove = null;
  room.result = null;
  room.log = [{ type: "start", player: room.turn, text: `${room.players[room.turn].name} goes first.` }];
}

function requireTurn(room, who) {
  if (room.status !== "playing") throw new GameError("The game isn't in progress.", 409);
  if (room.turn !== who) throw new GameError(`It's ${room.players[room.turn].name}'s turn.`, 409);
}

function nextTurn(room) {
  room.turn = (room.turn + 1) % room.players.length;
}

function play(room, who, placements) {
  requireTurn(room, who);
  if (!Array.isArray(placements)) throw new GameError("Place some tiles first.");
  const clean = placements.map(p => ({
    r: Number(p.r), c: Number(p.c), l: String(p.l || "").toUpperCase(), b: !!p.b
  }));
  const player = room.players[who];
  const left = Engine.takeFromRack(player.rack, clean);
  if (!left) throw new GameError("Those tiles aren't on your rack.");

  const result = Engine.evaluate(room.board, clean);
  if (!result.ok) throw new GameError(result.error);

  if (room.settings.checkWords) {
    const bad = result.words.map(w => w.word).filter(w => !isWord(w));
    if (bad.length) {
      const list = [...new Set(bad)].join(", ");
      throw new GameError(`${list} ${bad.length > 1 ? "aren't words" : "isn't a word"} in the dictionary. Try another play.`, 400, { badWords: [...new Set(bad)] });
    }
  }

  clean.forEach(p => { room.board[p.r * 15 + p.c] = { l: p.l, b: p.b, p: who }; });
  player.rack = left;
  player.score += result.score;
  draw(room, who, Engine.RACK_SIZE - player.rack.length);

  room.lastMove = {
    player: who, type: "play", score: result.score,
    cells: clean.map(p => p.r * 15 + p.c), words: result.words.map(w => w.word)
  };
  room.log.push({
    type: "play", player: who, score: result.score, bingo: result.bingo,
    words: result.words.map(w => ({ word: w.word, score: w.score }))
  });
  room.scorelessTurns = result.score > 0 ? 0 : room.scorelessTurns + 1;

  if (player.rack.length === 0 && room.bag.length === 0) return endGame(room, who);
  if (room.scorelessTurns >= room.players.length * 2) return endGame(room, null);
  nextTurn(room);
}

function exchange(room, who, letters) {
  requireTurn(room, who);
  if (room.bag.length < Engine.RACK_SIZE) throw new GameError("You can only swap tiles while the bag has 7 or more.");
  if (!Array.isArray(letters) || !letters.length) throw new GameError("Select the tiles you want to swap.");
  const swap = letters.map(l => String(l).toUpperCase());
  const left = Engine.takeFromRack(room.players[who].rack, swap.map(l => ({ l, b: l === "?" })));
  if (!left) throw new GameError("Those tiles aren't on your rack.");
  room.players[who].rack = left;
  draw(room, who, swap.length);
  room.bag.push(...swap);
  Engine.shuffle(room.bag, rand);
  room.lastMove = { player: who, type: "exchange", cells: [] };
  room.log.push({ type: "exchange", player: who, count: swap.length });
  scoreless(room);
}

function pass(room, who) {
  requireTurn(room, who);
  room.lastMove = { player: who, type: "pass", cells: [] };
  room.log.push({ type: "pass", player: who });
  scoreless(room);
}

function scoreless(room) {
  room.scorelessTurns++;
  if (room.scorelessTurns >= room.players.length * 2) return endGame(room, null);
  nextTurn(room);
}

function endGame(room, wentOut) {
  const adjustments = room.players.map((p, i) => {
    const v = Engine.rackValue(p.rack);
    return { player: i, left: p.rack.slice(), delta: i === wentOut ? 0 : -v };
  });
  if (wentOut !== null) {
    adjustments[wentOut].delta = adjustments.reduce((s, a) => s - a.delta, 0);
  }
  adjustments.forEach(a => { room.players[a.player].score += a.delta; });
  const top = Math.max(...room.players.map(p => p.score));
  room.status = "over";
  room.result = {
    reason: wentOut !== null ? "out" : "stalled",
    wentOut,
    adjustments,
    winners: room.players.map((p, i) => (p.score === top ? i : -1)).filter(i => i >= 0)
  };
  room.log.push({ type: "end", player: wentOut });
}

function rematch(room, who) {
  if (who !== room.hostIndex) throw new GameError("Only the host can start a rematch.", 403);
  if (room.status !== "over") throw new GameError("Finish this game first.", 409);
  startGame(room, who);
}

function leaveLobby(room, who) {
  if (room.status !== "lobby") throw new GameError("You can't leave once the game has started.", 409);
  if (who === room.hostIndex) throw new GameError("The host can't leave the lobby.", 409);
  room.players.splice(who, 1);
}

/** Dictionary lookup for the live preview. Returns { WORD: true|false }. */
function checkWords(list) {
  const out = {};
  String(list || "").toUpperCase().split(",").slice(0, 20).forEach(w => {
    if (/^[A-Z]{2,15}$/.test(w)) out[w] = isWord(w);
  });
  return out;
}

/** What one player is allowed to see: their own rack only. */
function view(room, who) {
  return {
    code: room.code,
    version: room.version,
    status: room.status,
    settings: room.settings,
    hostIndex: room.hostIndex,
    you: who,
    rack: who >= 0 ? room.players[who].rack : [],
    players: room.players.map(p => ({ name: p.name, score: p.score, rackCount: p.rack.length })),
    board: room.board,
    bagCount: room.bag.length,
    turn: room.turn,
    scorelessTurns: room.scorelessTurns,
    lastMove: room.lastMove,
    log: room.log.slice(-60),
    result: room.result
  };
}

module.exports = {
  GameError, MAX_PLAYERS, newCode, createRoom, joinRoom, playerByToken, startGame,
  play, exchange, pass, rematch, leaveLobby, view, isWord, checkWords
};
