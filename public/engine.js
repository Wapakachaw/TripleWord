/*
 * Word game engine — shared by the browser (score preview) and the server (authoritative rules).
 * Board: 225 cells, index = row * 15 + col. A cell is null or { l: "A", b: isBlank, p: playerIndex }.
 * Rack letters are "A".."Z" or "?" for a blank.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SIZE = 15;
  var CENTER = 7 * SIZE + 7;
  var RACK_SIZE = 7;
  var BINGO_BONUS = 50;

  var VALUES = {
    A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
    N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, "?": 0
  };

  var COUNTS = {
    A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
    N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, "?": 2
  };

  // Premium squares for the top-left quadrant (incl. centre row/col); mirrored to the rest.
  var PREMIUM_COORDS = {
    TW: [[0, 0], [0, 7], [7, 0]],
    DW: [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]],
    TL: [[1, 5], [5, 1], [5, 5]],
    DL: [[0, 3], [3, 0], [2, 6], [6, 2], [3, 7], [7, 3], [6, 6]]
  };

  var PREMIUM = (function () {
    var grid = new Array(SIZE * SIZE).fill("");
    Object.keys(PREMIUM_COORDS).forEach(function (type) {
      PREMIUM_COORDS[type].forEach(function (rc) {
        var r = rc[0], c = rc[1];
        [[r, c], [r, 14 - c], [14 - r, c], [14 - r, 14 - c], [c, r], [c, 14 - r], [14 - c, r], [14 - c, 14 - r]]
          .forEach(function (p) { grid[p[0] * SIZE + p[1]] = type; });
      });
    });
    return grid;
  })();

  function newBag(rand) {
    var bag = [];
    Object.keys(COUNTS).forEach(function (l) { for (var i = 0; i < COUNTS[l]; i++) bag.push(l); });
    return shuffle(bag, rand);
  }

  function shuffle(arr, rand) {
    rand = rand || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function idx(r, c) { return r * SIZE + c; }
  function inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }
  function boardIsEmpty(board) { return board.every(function (x) { return !x; }); }

  /**
   * Check placement geometry and compute every word formed with its score.
   * placements: [{ r, c, l, b }] — l is the letter shown (A–Z), b true when a blank is used.
   * Returns { ok, error } or { ok: true, words: [{ word, score, cells }], score, bingo, dir }.
   */
  function evaluate(board, placements) {
    if (!placements || !placements.length) return fail("Place at least one tile.");
    if (placements.length > RACK_SIZE) return fail("You can place at most 7 tiles.");

    var placed = {};
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      if (!inBounds(p.r, p.c)) return fail("That tile is off the board.");
      if (!/^[A-Z]$/.test(p.l)) return fail("Choose a letter for your blank tile.");
      var k = idx(p.r, p.c);
      if (board[k]) return fail("That square is already taken.");
      if (placed[k]) return fail("Two tiles are on the same square.");
      placed[k] = { l: p.l, b: !!p.b, isNew: true };
    }

    var sameRow = placements.every(function (p) { return p.r === placements[0].r; });
    var sameCol = placements.every(function (p) { return p.c === placements[0].c; });
    if (!sameRow && !sameCol) return fail("Place your tiles in one row or one column.");

    var first = boardIsEmpty(board);
    var at = function (r, c) {
      if (!inBounds(r, c)) return null;
      var k = idx(r, c);
      return placed[k] || board[k] || null;
    };

    // Main direction: for a single tile, whichever way it touches existing tiles.
    var dir;
    if (placements.length > 1) dir = sameRow ? "h" : "v";
    else {
      var p0 = placements[0];
      dir = (at(p0.r, p0.c - 1) || at(p0.r, p0.c + 1)) ? "h" : "v";
    }
    var dr = dir === "v" ? 1 : 0, dc = dir === "h" ? 1 : 0;

    // No gaps between first and last placed tile.
    var sorted = placements.slice().sort(function (a, b) { return dir === "h" ? a.c - b.c : a.r - b.r; });
    var s = sorted[0], e = sorted[sorted.length - 1];
    for (var r = s.r, c = s.c; r <= e.r && c <= e.c; r += dr, c += dc) {
      if (!at(r, c)) return fail("Your tiles must form one continuous word with no gaps.");
    }

    if (first) {
      if (!placed[CENTER]) return fail("The first word must cover the centre star.");
      if (placements.length < 2) return fail("The first word needs at least two letters.");
    } else {
      var touches = placements.some(function (p) {
        return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (d) {
          var rr = p.r + d[0], cc = p.c + d[1];
          return inBounds(rr, cc) && board[idx(rr, cc)];
        });
      });
      if (!touches) return fail("Your word must connect to tiles already on the board.");
    }

    var words = [];
    var main = wordThrough(at, s.r, s.c, dr, dc);
    if (main.cells.length > 1) words.push(main);
    placements.forEach(function (p) {
      var cross = wordThrough(at, p.r, p.c, dc, dr);
      if (cross.cells.length > 1) words.push(cross);
    });
    if (!words.length) return fail("Your word must connect to tiles already on the board.");

    var total = 0;
    words.forEach(function (w) { total += w.score; });
    var bingo = placements.length === RACK_SIZE;
    if (bingo) total += BINGO_BONUS;
    return { ok: true, words: words, score: total, bingo: bingo, dir: dir };
  }

  function wordThrough(at, r, c, dr, dc) {
    while (at(r - dr, c - dc)) { r -= dr; c -= dc; }
    var word = "", sum = 0, mult = 1, cells = [];
    while (at(r, c)) {
      var t = at(r, c), k = idx(r, c);
      var v = t.b ? 0 : VALUES[t.l];
      if (t.isNew) {
        var prem = PREMIUM[k];
        if (prem === "DL") v *= 2;
        else if (prem === "TL") v *= 3;
        else if (prem === "DW") mult *= 2;
        else if (prem === "TW") mult *= 3;
      }
      sum += v; word += t.l; cells.push(k);
      r += dr; c += dc;
    }
    return { word: word, score: sum * mult, cells: cells };
  }

  function fail(msg) { return { ok: false, error: msg }; }

  function rackValue(rack) {
    return rack.reduce(function (s, l) { return s + VALUES[l]; }, 0);
  }

  /** Remove the letters a move uses from a rack. Returns the new rack or null if the rack lacks them. */
  function takeFromRack(rack, placements) {
    var left = rack.slice();
    for (var i = 0; i < placements.length; i++) {
      var need = placements[i].b ? "?" : placements[i].l;
      var j = left.indexOf(need);
      if (j === -1) return null;
      left.splice(j, 1);
    }
    return left;
  }

  return {
    SIZE: SIZE, CENTER: CENTER, RACK_SIZE: RACK_SIZE, BINGO_BONUS: BINGO_BONUS,
    VALUES: VALUES, COUNTS: COUNTS, PREMIUM: PREMIUM,
    newBag: newBag, shuffle: shuffle, evaluate: evaluate,
    rackValue: rackValue, takeFromRack: takeFromRack, boardIsEmpty: boardIsEmpty
  };
});
