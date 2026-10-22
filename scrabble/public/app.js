/* Triple Word — client */
(function () {
  "use strict";
  var E = window.Engine;
  var SIZE = E.SIZE;
  var POLL_VISIBLE = 1500, POLL_HIDDEN = 6000;
  var LABELS = { TW: "3W", DW: "2W", TL: "3L", DL: "2L" };
  var NAMES = { TW: "triple word", DW: "double word", TL: "triple letter", DL: "double letter" };

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  var S = {
    code: null, token: null, view: null,
    rack: [],          // [{ id, l }] local order of your tiles
    pending: [],       // [{ r, c, l, b, id }] tiles you've put down but not played
    selected: null,    // rack tile id chosen for tap-to-place
    swapMode: false, swapSel: {},
    cursor: { r: 7, c: 7, dir: "h" },
    busy: false, pollTimer: null, lastLogLen: 0, lastStatus: null, nextId: 1, zoom: false
  };

  /* ---------------------------------------------------------------- utilities */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function unstore(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function playerName(i) { return S.view && S.view.players[i] ? S.view.players[i].name : "Someone"; }
  function isMyTurn() { return S.view && S.view.status === "playing" && S.view.turn === S.view.you; }
  function inviteUrl() { return location.origin + location.pathname + "?room=" + S.code; }

  function toast(msg, kind) {
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(function () { el.remove(); }, kind === "error" ? 5000 : 3200);
    while ($("#toasts").children.length > 3) $("#toasts").firstChild.remove();
  }

  function tileHTML(l, opts) {
    opts = opts || {};
    var blank = opts.blank;
    var shown = l === "?" ? "" : l;
    var val = blank ? "" : E.VALUES[l];
    return '<span class="letter">' + esc(shown) + '</span>' + (val ? '<span class="val">' + val + "</span>" : "") +
      (blank ? "" : "");
  }
  function tileClass(l, blank) { return "tile" + (blank ? " is-blank" : "") + (blank && l !== "?" ? " has-letter" : ""); }

  var ICONS = {
    theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.9"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/></svg>',
    "copy-link": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>'
  };

  /* ---------------------------------------------------------------- API */
  function api(method, body, query) {
    var url = "/api/game" + (query ? "?" + new URLSearchParams(query) : "");
    return fetch(url, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) { var err = new Error(data.error || "The server didn't respond. Check your connection."); err.status = r.status; throw err; }
        return data;
      });
    }, function () { throw new Error("Can't reach the game server. Check your connection."); });
  }

  function act(action, extra) {
    if (S.busy) return Promise.resolve();
    S.busy = true; render();
    var body = Object.assign({ action: action, code: S.code, token: S.token }, extra || {});
    return api("POST", body).then(function (res) {
      S.busy = false;
      applyView(res.state);
      return res;
    }).catch(function (err) {
      S.busy = false; render();
      toast(err.message, "error");
      throw err;
    });
  }

  /* ---------------------------------------------------------------- session & routing */
  function boot() {
    $$("[data-action=theme], [data-action=help], .icon-btn[data-action=copy-link]").forEach(function (b) { b.innerHTML = ICONS[b.dataset.action] || ""; });
    buildWordmark();
    buildBoard();
    buildLetterGrid();
    bindEvents();

    var params = new URLSearchParams(location.search);
    var code = (params.get("room") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
    $("#input-name").value = store("tw:name") || "";
    if (code) {
      $("#input-code").value = code;
      var saved = store("tw:room:" + code);
      if (saved && saved.token) { S.code = code; S.token = saved.token; return resume(); }
    }
    show("home");
    if (code) setTimeout(function () { ($("#input-name").value ? $("#btn-join") : $("#input-name")).focus(); }, 50);
  }

  function resume() {
    api("GET", null, { code: S.code, token: S.token }).then(function (v) {
      if (v.you < 0) { unstore("tw:room:" + S.code); S.token = null; show("home"); return; }
      applyView(v); startPolling();
    }).catch(function (err) {
      show("home"); $("#home-error").textContent = err.message;
    });
  }

  function enterRoom(res) {
    S.code = res.code; S.token = res.token;
    store("tw:room:" + S.code, { token: S.token });
    history.replaceState(null, "", "?room=" + S.code);
    applyView(res.state);
    startPolling();
  }

  function show(name) {
    ["home", "lobby", "game"].forEach(function (n) { $("#screen-" + n).hidden = n !== name; });
    document.body.dataset.screen = name;
  }

  function startPolling() {
    clearTimeout(S.pollTimer);
    var tick = function () {
      if (!S.code || !S.token) return;
      api("GET", null, { code: S.code, token: S.token, v: S.view ? S.view.version : 0 })
        .then(function (v) { if (!v.unchanged) applyView(v); })
        .catch(function () { /* transient; keep trying */ })
        .then(function () { S.pollTimer = setTimeout(tick, document.hidden ? POLL_HIDDEN : POLL_VISIBLE); });
    };
    S.pollTimer = setTimeout(tick, POLL_VISIBLE);
  }

  /* ---------------------------------------------------------------- state sync */
  function applyView(v) {
    var prev = S.view;
    if (prev && v.version < prev.version) return;
    S.view = v;

    // A new game (rematch) or game start: drop local layout.
    if (prev && prev.status !== "playing" && v.status === "playing") { S.pending = []; S.rack = []; S.lastLogLen = 0; }

    reconcileRack(v.rack);
    // Drop pending tiles whose square got taken by someone else.
    S.pending = S.pending.filter(function (p) { return !v.board[p.r * SIZE + p.c]; });
    if (!isMyTurn()) S.swapMode = false;

    announce(prev, v);
    S.lastStatus = v.status;
    render();
  }

  function reconcileRack(letters) {
    var pool = letters.slice();
    var kept = [];
    S.rack.forEach(function (t) {
      var i = pool.indexOf(t.l);
      if (i !== -1) { pool.splice(i, 1); kept.push(t); }
    });
    pool.forEach(function (l) { kept.push({ id: S.nextId++, l: l }); });
    S.rack = kept;
    var ids = {};
    kept.forEach(function (t) { ids[t.id] = true; });
    S.pending = S.pending.filter(function (p) { return ids[p.id]; });
    if (S.selected && !ids[S.selected]) S.selected = null;
    Object.keys(S.swapSel).forEach(function (id) { if (!ids[id]) delete S.swapSel[id]; });
  }

  function announce(prev, v) {
    if (v.status === "playing" || v.status === "over") {
      var newEntries = v.log.length - (S.lastLogLen || 0);
      if (prev && prev.status === "playing" && newEntries > 0) {
        v.log.slice(-newEntries).forEach(function (e) {
          if (e.player === v.you || e.type === "end") return;
          var text = logText(e, v);
          if (text) toast(text);
        });
      }
      S.lastLogLen = v.log.length;
    }
    var mine = v.status === "playing" && v.turn === v.you;
    document.title = (mine ? "Your turn — " : "") + "Triple Word";
    if (mine && prev && prev.status === "playing" && prev.turn !== v.you && navigator.vibrate) { try { navigator.vibrate(40); } catch (e) {} }
    if (v.status === "over" && prev && prev.status === "playing") setTimeout(showGameOver, 600);
  }

  /* ---------------------------------------------------------------- rendering */
  function render() {
    var v = S.view;
    if (!v) return;
    if (v.status === "lobby") { show("lobby"); renderLobby(); return; }
    show("game");
    renderPlayers(); renderBoard(); renderRack(); renderActions(); renderLog();
    $("#game-code").textContent = v.code;
    $("#bag-count").textContent = v.bagCount + (v.bagCount === 1 ? " tile" : " tiles") + " in bag";
  }

  function renderLobby() {
    var v = S.view;
    $("#lobby-code").textContent = v.code;
    $("#share-link").value = inviteUrl();
    var seats = "";
    for (var i = 0; i < 3; i++) {
      var p = v.players[i];
      if (p) {
        seats += '<li class="seat"><span class="' + tileClass(p.name[0].toUpperCase()) + '" aria-hidden="true">' + tileHTML(/[A-Z]/.test(p.name[0].toUpperCase()) ? p.name[0].toUpperCase() : "?") + '</span>' +
          '<span class="seat-name">' + esc(p.name) + "</span>" +
          '<span class="seat-tag">' + (i === v.hostIndex ? "Host" : "") + (i === v.you ? (i === v.hostIndex ? ", you" : "You") : "") + "</span></li>";
      } else {
        seats += '<li class="seat empty"><span class="tile" aria-hidden="true">?</span><span>Waiting for a friend to join</span></li>';
      }
    }
    $("#seats").innerHTML = seats;
    var host = v.you === v.hostIndex;
    $("#opt-dict").checked = v.settings.checkWords;
    $("#opt-dict").disabled = !host;
    $("#btn-start").hidden = !host;
    $("#btn-start").disabled = v.players.length < 2 || S.busy;
    $("#btn-leave").hidden = host;
    $("#lobby-hint").textContent = host
      ? (v.players.length < 2 ? "You need at least one more player to start." : v.players.length < 3 ? "You can start now, or wait for a third player." : "Everyone's here.")
      : "The host will start the game when everyone's here.";
  }

  function renderPlayers() {
    var v = S.view;
    $("#players").innerHTML = v.players.map(function (p, i) {
      var turn = v.status === "playing" && v.turn === i;
      return '<div class="player' + (turn ? " is-turn" : "") + '" data-p="' + i + '">' +
        '<div><div class="player-name">' + esc(p.name) + (i === v.you ? " (you)" : "") + "</div>" +
        '<div class="player-meta">' + (turn ? '<span class="now">Playing now</span>' : '<span class="tiles-left">' + p.rackCount + " tiles</span>") + "</div></div>" +
        '<div class="player-score" aria-label="' + p.score + ' points">' + p.score + "</div></div>";
    }).join("");

    var banner = $("#turn-banner");
    if (v.status === "over") banner.textContent = "Game over";
    else if (isMyTurn()) banner.innerHTML = '<span class="you">Your turn</span>';
    else banner.textContent = "Waiting for " + playerName(v.turn) + " to play";
  }

  function buildBoard() {
    var html = "";
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var k = r * SIZE + c, prem = E.PREMIUM[k];
        html += '<button type="button" class="cell' + (prem ? " sq-" + prem : "") + (k === E.CENTER ? " center" : "") +
          '" role="gridcell" data-r="' + r + '" data-c="' + c + '" tabindex="' + (k === E.CENTER ? 0 : -1) + '"></button>';
      }
    }
    $("#board").innerHTML = html;
  }

  function renderBoard() {
    var v = S.view;
    var pendingAt = {};
    S.pending.forEach(function (p) { pendingAt[p.r * SIZE + p.c] = p; });
    var last = {};
    if (v.lastMove && v.lastMove.cells) v.lastMove.cells.forEach(function (k) { last[k] = v.lastMove.player; });
    var cells = $("#board").children;
    for (var k = 0; k < cells.length; k++) {
      var cell = cells[k], t = v.board[k], p = pendingAt[k], prem = E.PREMIUM[k];
      var sig = t ? "t" + t.l + t.b + (k in last ? last[k] : "") : p ? "p" + p.l + p.b + p.id : "e";
      var isCursor = S.cursor.r * SIZE + S.cursor.c === k && document.activeElement === cell && !t && !p;
      sig += isCursor ? S.cursor.dir : "";
      if (cell.dataset.sig === sig) continue;
      cell.dataset.sig = sig;
      var label = "Row " + (Math.floor(k / SIZE) + 1) + ", column " + (k % SIZE + 1) + ", ";
      if (t) {
        cell.innerHTML = '<span class="' + tileClass(t.l, t.b) + (k in last ? " last" : "") + '"' +
          (k in last ? ' style="--lc: var(--p' + last[k] + ')"' : "") + ">" + tileHTML(t.l, { blank: t.b }) + "</span>";
        cell.setAttribute("aria-label", label + t.l + (t.b ? " (blank)" : ""));
      } else if (p) {
        cell.innerHTML = '<span class="' + tileClass(p.l, p.b) + ' pending" data-pending="' + p.id + '">' + tileHTML(p.l, { blank: p.b }) + "</span>";
        cell.setAttribute("aria-label", label + p.l + ", placed this turn. Activate to take back.");
      } else {
        cell.innerHTML = (prem && k !== E.CENTER ? LABELS[prem] : "") + (isCursor ? '<span class="cursor-arrow" aria-hidden="true">' + (S.cursor.dir === "h" ? "→" : "↓") + "</span>" : "");
        cell.setAttribute("aria-label", label + (k === E.CENTER ? "centre star, double word" : prem ? NAMES[prem] : "empty"));
      }
    }
  }

  function renderRack() {
    var used = {};
    S.pending.forEach(function (p) { used[p.id] = true; });
    var tiles = S.rack.filter(function (t) { return !used[t.id]; });
    var rack = $("#rack");
    if (!tiles.length) {
      rack.innerHTML = '<span class="rack-empty">' + (S.rack.length ? "All your tiles are on the board" : "No tiles left") + "</span>";
      return;
    }
    rack.innerHTML = tiles.map(function (t) {
      var cls = tileClass(t.l, t.l === "?") + (S.selected === t.id ? " selected" : "") + (S.swapSel[t.id] ? " swap-selected" : "");
      var name = t.l === "?" ? "Blank tile" : t.l + ", " + E.VALUES[t.l] + (E.VALUES[t.l] === 1 ? " point" : " points");
      return '<button type="button" role="listitem" class="' + cls + '" data-id="' + t.id + '" aria-label="' + name + '" aria-pressed="' + (S.selected === t.id || !!S.swapSel[t.id]) + '">' + tileHTML(t.l, { blank: t.l === "?" }) + "</button>";
    }).join("");
  }

  function renderActions() {
    var v = S.view, mine = isMyTurn(), over = v.status === "over";
    $("#actions").hidden = S.swapMode;
    $("#swap-bar").hidden = !S.swapMode;
    $("[data-action=swap]").disabled = !mine || S.busy || v.bagCount < E.RACK_SIZE;
    $("[data-action=swap]").title = v.bagCount < E.RACK_SIZE ? "You can only swap while the bag has 7 or more tiles" : "";
    $("[data-action=pass]").disabled = !mine || S.busy;
    $("[data-action=recall]").disabled = !S.pending.length;
    $("[data-action=shuffle]").disabled = S.rack.length < 2;

    var hint = $("#move-hint"), play = $("#btn-play");
    hint.className = "move-hint";
    if (over) { play.disabled = true; play.textContent = "Play"; hint.textContent = ""; }
    else if (!S.pending.length) {
      play.disabled = true; play.textContent = "Play";
      hint.textContent = mine ? (E.boardIsEmpty(v.board) ? "Start the game with a word across the centre star." : "Tap a tile, then tap a square. Or drag it.") : "You can arrange tiles while you wait.";
    } else {
      var res = E.evaluate(v.board, S.pending);
      if (res.ok) {
        play.textContent = "Play " + res.score;
        play.setAttribute("aria-label", "Play " + res.words.map(function (w) { return w.word; }).join(", ") + " for " + res.score + " points");
        hint.textContent = res.words.map(function (w) { return w.word + " " + w.score; }).join(", ") + (res.bingo ? ", plus 50 for using all 7" : "");
        hint.className = "move-hint good";
      } else {
        play.textContent = "Play"; play.removeAttribute("aria-label");
        hint.textContent = res.error;
      }
      play.disabled = !mine || !res.ok || S.busy;
    }
    var n = Object.keys(S.swapSel).length;
    $("#btn-swap-confirm").disabled = !n || S.busy;
    $("#btn-swap-confirm").textContent = n ? "Swap " + n + (n === 1 ? " tile" : " tiles") : "Swap tiles";
  }

  function logText(e, v) {
    var who = e.player === v.you ? "You" : playerName(e.player);
    if (e.type === "play") return who + " played " + e.words.map(function (w) { return w.word; }).join(", ") + " for " + e.score + (e.bingo ? ", using all 7 tiles" : "");
    if (e.type === "exchange") return who + " swapped " + e.count + (e.count === 1 ? " tile" : " tiles");
    if (e.type === "pass") return who + " passed";
    if (e.type === "start") return (e.player === v.you ? "You go" : playerName(e.player) + " goes") + " first";
    if (e.type === "end") return "Game over";
    return "";
  }

  function renderLog() {
    var v = S.view;
    var items = v.log.slice().reverse().map(function (e) {
      var pc = e.player != null && e.player >= 0 ? ' style="--pc: var(--p' + e.player + ')"' : "";
      if (e.type === "play") {
        return '<li><span class="dot"' + pc + '></span><span><span class="sys">' + esc(e.player === v.you ? "You" : playerName(e.player)) + '</span> <span class="words">' +
          esc(e.words.map(function (w) { return w.word; }).join(", ")) + "</span>" + (e.bingo ? ' <span class="bingo">all 7</span>' : "") + '</span><span class="pts">' + e.score + "</span></li>";
      }
      return '<li><span class="dot"' + pc + '></span><span class="sys">' + esc(logText(e, v)) + "</span><span></span></li>";
    });
    $("#log").innerHTML = items.join("") || '<li class="sys">No moves yet</li>';
  }

  function showGameOver() {
    var v = S.view, r = v.result;
    if (!r || v.status !== "over") return;
    var winners = r.winners.map(playerName);
    $("#over-title").textContent = r.winners.indexOf(v.you) !== -1
      ? (r.winners.length > 1 ? "You tied for the win" : "You win")
      : (winners.length > 1 ? winners.join(" and ") + " tie" : winners[0] + " wins");
    $("#over-reason").textContent = r.reason === "out"
      ? playerName(r.wentOut) + " used their last tile, and gets the points left on everyone else's racks."
      : "Six turns went by with no points, so the game ended. Leftover tiles were subtracted.";
    var order = v.players.map(function (p, i) { return i; }).sort(function (a, b) { return v.players[b].score - v.players[a].score; });
    $("#standings").innerHTML = order.map(function (i) {
      var p = v.players[i], a = r.adjustments[i];
      var adj = a.delta === 0 ? "No tiles left" : (a.delta > 0 ? "+" + a.delta + " from other racks" : a.delta + " for " + a.left.join(" ").replace(/\?/g, "blank") + " left over");
      return '<li data-p="' + i + '" class="' + (r.winners.indexOf(i) !== -1 ? "winner" : "") + '"><div><div class="name">' + esc(p.name) + '</div><div class="adj">' + esc(adj) + '</div></div><div class="final">' + p.score + "</div></li>";
    }).join("");
    var host = v.you === v.hostIndex;
    $("#btn-rematch").hidden = !host;
    var dlg = $("#dlg-over");
    if (!dlg.open) dlg.showModal();
  }

  /* ---------------------------------------------------------------- moves */
  function placeTile(id, r, c) {
    var v = S.view;
    if (!v || v.status !== "playing" || S.swapMode) return Promise.resolve();
    var k = r * SIZE + c;
    if (v.board[k]) return Promise.resolve();
    var other = S.pending.find(function (p) { return p.r === r && p.c === c; });
    if (other && other.id !== id) return Promise.resolve();
    var tile = S.rack.find(function (t) { return t.id === id; });
    if (!tile) return Promise.resolve();
    var existing = S.pending.find(function (p) { return p.id === id; });

    var letterP = existing ? Promise.resolve(existing.l)
      : tile.l === "?" ? pickBlank() : Promise.resolve(tile.l);
    return letterP.then(function (l) {
      if (!l) return;
      S.pending = S.pending.filter(function (p) { return p.id !== id; });
      S.pending.push({ r: r, c: c, l: l, b: tile.l === "?", id: id });
      S.selected = null;
      render();
    });
  }

  function unplace(id) {
    S.pending = S.pending.filter(function (p) { return p.id !== id; });
    render();
  }

  function submitPlay() {
    if (!isMyTurn() || !S.pending.length) return;
    var placements = S.pending.map(function (p) { return { r: p.r, c: p.c, l: p.l, b: p.b }; });
    var ids = S.pending.map(function (p) { return p.id; });
    act("play", { placements: placements }).then(function () {
      // Played tiles leave the rack for good; the server already sent the refilled rack.
      S.rack = S.rack.filter(function (t) { return ids.indexOf(t.id) === -1; });
      S.pending = [];
      reconcileRack(S.view.rack);
      render();
    }, function () {});
  }

  function pickBlank() {
    return new Promise(function (resolve) {
      var dlg = $("#dlg-blank");
      dlg.returnValue = "";
      var done = function () { dlg.removeEventListener("close", done); resolve(dlg.returnValue || null); };
      dlg.addEventListener("close", done);
      dlg.showModal();
    });
  }

  function confirmDialog(title, body, yes) {
    return new Promise(function (resolve) {
      var dlg = $("#dlg-confirm");
      $("#confirm-title").textContent = title;
      $("#confirm-body").textContent = body;
      $("#confirm-yes").textContent = yes;
      dlg.returnValue = "";
      var done = function () { dlg.removeEventListener("close", done); resolve(dlg.returnValue === "yes"); };
      dlg.addEventListener("close", done);
      dlg.showModal();
    });
  }

  /* ---------------------------------------------------------------- keyboard on the board */
  function focusCell(r, c) {
    r = Math.max(0, Math.min(SIZE - 1, r)); c = Math.max(0, Math.min(SIZE - 1, c));
    var prev = $("#board .cell[tabindex='0']");
    if (prev) prev.tabIndex = -1;
    var el = $("#board").children[r * SIZE + c];
    el.tabIndex = 0;
    S.cursor.r = r; S.cursor.c = c;
    el.focus();
    renderBoard();
  }

  function advance() {
    var dr = S.cursor.dir === "v" ? 1 : 0, dc = S.cursor.dir === "h" ? 1 : 0;
    var r = S.cursor.r + dr, c = S.cursor.c + dc;
    while (r < SIZE && c < SIZE && S.view.board[r * SIZE + c]) { r += dr; c += dc; }
    if (r < SIZE && c < SIZE) focusCell(r, c);
  }

  function typeLetter(L) {
    var k = S.cursor.r * SIZE + S.cursor.c;
    if (S.view.board[k] || S.pending.some(function (p) { return p.r === S.cursor.r && p.c === S.cursor.c; })) { advance(); }
    k = S.cursor.r * SIZE + S.cursor.c;
    if (S.view.board[k]) return;
    var used = {};
    S.pending.forEach(function (p) { used[p.id] = true; });
    var free = S.rack.filter(function (t) { return !used[t.id]; });
    var t = free.find(function (x) { return x.l === L; });
    var blank = !t && free.find(function (x) { return x.l === "?"; });
    if (!t && !blank) { toast("You don't have a " + L + " on your rack.", "error"); return; }
    var id = (t || blank).id;
    S.lastCellClick = null;
    S.pending.push({ r: S.cursor.r, c: S.cursor.c, l: L, b: !t, id: id });
    render();
    advance();
  }

  function backspace() {
    var here = S.pending.find(function (p) { return p.r === S.cursor.r && p.c === S.cursor.c; });
    if (here) return unplace(here.id);
    var dr = S.cursor.dir === "v" ? 1 : 0, dc = S.cursor.dir === "h" ? 1 : 0;
    var r = S.cursor.r - dr, c = S.cursor.c - dc;
    while (r >= 0 && c >= 0) {
      var p = S.pending.find(function (x) { return x.r === r && x.c === c; });
      if (p) { unplace(p.id); focusCell(r, c); return; }
      if (!S.view.board[r * SIZE + c]) { focusCell(r, c); return; }
      r -= dr; c -= dc;
    }
  }

  /* ---------------------------------------------------------------- drag & drop (pointer events) */
  var drag = null;

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    var rackTile = e.target.closest("#rack .tile");
    var pendTile = e.target.closest(".cell .tile.pending");
    if (!rackTile && !pendTile) return;
    if (S.swapMode && pendTile) return;
    var id = Number(rackTile ? rackTile.dataset.id : pendTile.dataset.pending);
    drag = { id: id, from: rackTile ? "rack" : "board", el: rackTile || pendTile, x: e.clientX, y: e.clientY, started: false, pointerId: e.pointerId };
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8 || S.swapMode) return;
      drag.started = true;
      var rect = drag.el.getBoundingClientRect();
      var size = Math.max(rect.width, 40);
      var g = document.createElement("div");
      g.className = drag.el.className.replace(/\b(selected|pending|last)\b/g, "") + " drag-ghost";
      g.innerHTML = drag.el.innerHTML;
      g.style.setProperty("--t", size + "px");
      g.style.width = g.style.height = size + "px";
      document.body.appendChild(g);
      drag.ghost = g;
      drag.el.classList.add("ghost-slot");
    }
    e.preventDefault();
    drag.ghost.style.left = e.clientX + "px";
    drag.ghost.style.top = e.clientY + "px";
    var target = dropTargetAt(e.clientX, e.clientY);
    $$(".drop-target").forEach(function (x) { if (x !== target) x.classList.remove("drop-target"); });
    if (target) target.classList.add("drop-target");
  }

  function dropTargetAt(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el) return null;
    var cell = el.closest(".cell");
    if (cell) {
      var k = Number(cell.dataset.r) * SIZE + Number(cell.dataset.c);
      var occupied = S.view.board[k] || S.pending.some(function (p) { return p.r * SIZE + p.c === k && p.id !== drag.id; });
      return occupied ? null : cell;
    }
    return el.closest("#rack");
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var d = drag; drag = null;
    $$(".drop-target").forEach(function (x) { x.classList.remove("drop-target"); });
    if (!d.started) return; // treated as a click
    d.ghost.remove();
    d.el.classList.remove("ghost-slot");
    suppressClick = true; setTimeout(function () { suppressClick = false; }, 0);
    var target = dropTargetAt(e.clientX, e.clientY);
    if (!target) return;
    if (target.classList.contains("cell")) { placeTile(d.id, Number(target.dataset.r), Number(target.dataset.c)); return; }
    // Dropped on the rack: take back, and reorder next to the tile under the pointer.
    S.pending = S.pending.filter(function (p) { return p.id !== d.id; });
    var over = document.elementFromPoint(e.clientX, e.clientY);
    over = over && over.closest("#rack .tile");
    var from = S.rack.findIndex(function (t) { return t.id === d.id; });
    var moving = S.rack.splice(from, 1)[0];
    var to = over ? S.rack.findIndex(function (t) { return t.id === Number(over.dataset.id); }) : S.rack.length;
    if (over) {
      var rect = over.getBoundingClientRect();
      if (e.clientX > rect.left + rect.width / 2) to++;
    }
    S.rack.splice(to < 0 ? S.rack.length : to, 0, moving);
    render();
  }
  var suppressClick = false;

  /* ---------------------------------------------------------------- events */
  function bindEvents() {
    $("#form-create").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("#input-name").value.trim();
      if (!name) { $("#home-error").textContent = "Enter your name first."; $("#input-name").focus(); return; }
      store("tw:name", name);
      $("#btn-create").disabled = true;
      api("POST", { action: "create", name: name }).then(enterRoom).catch(function (err) {
        $("#home-error").textContent = err.message;
      }).then(function () { $("#btn-create").disabled = false; });
    });

    $("#btn-join").addEventListener("click", function () {
      var name = $("#input-name").value.trim();
      var code = $("#input-code").value.toUpperCase().replace(/[^A-Z]/g, "");
      if (!name) { $("#home-error").textContent = "Enter your name first."; $("#input-name").focus(); return; }
      if (code.length !== 5) { $("#home-error").textContent = "Room codes are 5 letters. Check the link your friend sent."; $("#input-code").focus(); return; }
      store("tw:name", name);
      $("#btn-join").disabled = true;
      api("POST", { action: "join", code: code, name: name }).then(enterRoom).catch(function (err) {
        $("#home-error").textContent = err.message;
      }).then(function () { $("#btn-join").disabled = false; });
    });
    $("#input-code").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("#btn-join").click(); } });
    $("#input-code").addEventListener("input", function (e) { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ""); });

    document.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (btn && !btn.disabled) return onAction(btn.dataset.action);
      if (suppressClick) return;

      if (!e.target.closest(".cell")) S.lastCellClick = null;
      var rackTile = e.target.closest("#rack .tile");
      if (rackTile) {
        var id = Number(rackTile.dataset.id);
        if (S.swapMode) { if (S.swapSel[id]) delete S.swapSel[id]; else S.swapSel[id] = true; }
        else S.selected = S.selected === id ? null : id;
        render();
        return;
      }
      var cell = e.target.closest(".cell");
      if (cell) {
        var r = Number(cell.dataset.r), c = Number(cell.dataset.c);
        var pend = S.pending.find(function (p) { return p.r === r && p.c === c; });
        if (pend) { unplace(pend.id); return; }
        if (S.selected) { placeTile(S.selected, r, c); return; }
        // Clicking the same empty square twice switches typing direction.
        var k = r * SIZE + c;
        if (S.lastCellClick === k) S.cursor.dir = S.cursor.dir === "h" ? "v" : "h";
        S.lastCellClick = k;
        focusCell(r, c);
        return;
      }
    });

    $("#board").addEventListener("keydown", function (e) {
      var cell = e.target.closest(".cell");
      if (!cell || !S.view || S.view.status !== "playing") return;
      var r = S.cursor.r, c = S.cursor.c;
      var moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (moves[e.key]) { e.preventDefault(); focusCell(r + moves[e.key][0], c + moves[e.key][1]); return; }
      if (e.key === " ") { e.preventDefault(); S.cursor.dir = S.cursor.dir === "h" ? "v" : "h"; renderBoard(); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        if (S.selected) placeTile(S.selected, r, c);
        else if (S.pending.length && isMyTurn()) submitPlay();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); backspace(); return; }
      if (/^[a-zA-Z]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); typeLetter(e.key.toUpperCase()); }
    });
    $("#board").addEventListener("focusin", function (e) {
      var cell = e.target.closest(".cell");
      if (cell) { S.cursor.r = Number(cell.dataset.r); S.cursor.c = Number(cell.dataset.c); renderBoard(); }
    });
    $("#board").addEventListener("focusout", function () { setTimeout(renderBoard, 0); });

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", function () {
      if (drag && drag.ghost) { drag.ghost.remove(); drag.el.classList.remove("ghost-slot"); }
      drag = null;
    });

    $("#opt-dict").addEventListener("change", function () { /* sent with Start */ });

    $("#dlg-over").addEventListener("close", function () {
      if ($("#dlg-over").returnValue === "rematch") act("rematch").catch(function () {});
    });

    document.addEventListener("visibilitychange", function () { if (!document.hidden && S.code) startPolling(); });
  }

  function onAction(a) {
    var v = S.view;
    switch (a) {
      case "theme": {
        var root = document.documentElement;
        var dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
        root.dataset.theme = dark ? "light" : "dark";
        try { localStorage.setItem("tw:theme", root.dataset.theme); } catch (e) {}
        return;
      }
      case "help": return $("#dlg-help").showModal();
      case "copy-link": {
        var url = inviteUrl();
        var done = function () { toast("Invite link copied. Send it to your friends."); };
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { $("#share-link").select(); });
        else { $("#share-link").select(); document.execCommand("copy"); done(); }
        return;
      }
      case "start": return act("start", { settings: { checkWords: $("#opt-dict").checked } }).catch(function () {});
      case "leave":
        return act("leave").then(function () { unstore("tw:room:" + S.code); location.href = location.pathname; }, function () {});
      case "shuffle":
        E.shuffle(S.rack); render(); return;
      case "recall":
        S.pending = []; S.selected = null; render(); return;
      case "zoom":
        S.zoom = !S.zoom;
        $("#board-wrap").classList.toggle("zoomed", S.zoom);
        $("[data-action=zoom]").setAttribute("aria-pressed", String(S.zoom));
        $("[data-action=zoom]").textContent = S.zoom ? "Fit" : "Zoom";
        return;
      case "play": return submitPlay();
      case "pass":
        return confirmDialog("Pass this turn?", "You won't score anything, and it'll be " + playerName((v.turn + 1) % v.players.length) + "'s turn.", "Pass").then(function (ok) {
          if (ok) { S.pending = []; act("pass").catch(function () {}); }
        });
      case "swap":
        S.swapMode = true; S.swapSel = {}; S.pending = []; S.selected = null; render(); return;
      case "swap-cancel":
        S.swapMode = false; S.swapSel = {}; render(); return;
      case "swap-confirm": {
        var letters = S.rack.filter(function (t) { return S.swapSel[t.id]; }).map(function (t) { return t.l; });
        return act("exchange", { letters: letters }).then(function () {
          S.swapMode = false; S.swapSel = {}; toast("Swapped " + letters.length + (letters.length === 1 ? " tile" : " tiles") + ". Your new tiles are on your rack."); render();
        }, function () {});
      }
    }
  }

  /* ---------------------------------------------------------------- static pieces */
  function buildWordmark() {
    var rows = $$(".wordmark .wm-row");
    ["TRIPLE", "WORD"].forEach(function (w, ri) {
      rows[ri].innerHTML = w.split("").map(function (l, i) {
        return '<span class="tile" style="animation-delay:' + (ri * 6 + i) * 45 + 'ms">' + tileHTML(l) + "</span>";
      }).join("");
    });
  }

  function buildLetterGrid() {
    $("#letter-grid").innerHTML = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(function (l) {
      return '<button class="tile is-blank has-letter" value="' + l + '" aria-label="' + l + '"><span class="letter">' + l + "</span></button>";
    }).join("");
  }

  boot();
})();
