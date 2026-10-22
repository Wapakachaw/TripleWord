/*
 * Triple Word — sound effects, synthesised with Web Audio (no audio files to load).
 * Sound.place()   wooden tile clack       Sound.lift()   softer pick-up click
 * Sound.shuffle() quick rattle            Sound.play(n)  tiles land + rising chime (your turn ends)
 * Sound.pass()    soft two-note fall      Sound.turn()   bell when someone else ends their turn
 * Sound.yourTurn() two-note bell          Sound.invalid() low buzz        Sound.win()/lose()
 * Muted state is saved per device under "tw:sound".
 */
(function () {
  "use strict";
  var ctx = null, master = null, noiseBuf = null;
  var muted = false;
  try { muted = localStorage.getItem("tw:sound") === "off"; } catch (e) {}

  function ensure() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return ctx; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  // Browsers only allow audio after a user gesture; unlock on the first one.
  function unlock() { ensure(); ["pointerdown", "keydown", "touchend"].forEach(function (t) { window.removeEventListener(t, unlock, true); }); }
  ["pointerdown", "keydown", "touchend"].forEach(function (t) { window.addEventListener(t, unlock, true); });

  function ready() { return !muted && ensure() && ctx.state !== "closed"; }

  /** A filtered noise burst — the "wood" in a clack. */
  function knock(at, opts) {
    var src = ctx.createBufferSource(); src.buffer = noiseBuf;
    var bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = opts.freq; bp.Q.value = opts.q || 4;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(opts.gain, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + opts.decay);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(at); src.stop(at + opts.decay + 0.02);
  }

  /** A short pitched body under the knock (gives the tile weight). */
  function thump(at, f0, f1, dur, gain) {
    var o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(master); o.start(at); o.stop(at + dur + 0.02);
  }

  /** Bell-ish tone: a sine with a quieter octave partial. */
  function tone(at, freq, dur, gain, type) {
    [[1, 1], [2, 0.25], [3, 0.08]].forEach(function (p) {
      var o = ctx.createOscillator(); o.type = type || "sine"; o.frequency.value = freq * p[0];
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain * p[1], at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur / p[0]);
      o.connect(g); g.connect(master); o.start(at); o.stop(at + dur + 0.05);
    });
  }

  function jitter(x, amt) { return x * (1 + (Math.random() - 0.5) * amt); }

  function clack(at, scale) {
    scale = scale || 1;
    knock(at, { freq: jitter(2100, 0.2), q: 3, gain: 0.5 * scale, decay: 0.05 });
    knock(at, { freq: jitter(900, 0.2), q: 2, gain: 0.35 * scale, decay: 0.07 });
    thump(at, jitter(220, 0.15), 110, 0.08, 0.35 * scale);
  }

  var Sound = {
    place: function () { if (!ready()) return; clack(ctx.currentTime); },
    lift: function () {
      if (!ready()) return;
      var t = ctx.currentTime;
      knock(t, { freq: jitter(3200, 0.2), q: 5, gain: 0.25, decay: 0.035 });
    },
    shuffle: function () {
      if (!ready()) return;
      var t = ctx.currentTime;
      for (var i = 0; i < 7; i++) knock(t + i * 0.035 + Math.random() * 0.015, { freq: jitter(2600, 0.4), q: 4, gain: 0.2, decay: 0.03 });
    },
    play: function (tiles) {
      if (!ready()) return;
      var t = ctx.currentTime;
      var n = Math.max(1, Math.min(7, tiles || 1));
      for (var i = 0; i < n; i++) clack(t + i * 0.06, 0.7);
      var s = t + n * 0.06 + 0.04;
      tone(s, 659.25, 0.35, 0.18);          // E5
      tone(s + 0.09, 987.77, 0.55, 0.16);   // B5
    },
    pass: function () {
      if (!ready()) return;
      var t = ctx.currentTime;
      tone(t, 523.25, 0.28, 0.14, "triangle");   // C5
      tone(t + 0.12, 392.0, 0.4, 0.12, "triangle"); // G4
    },
    turn: function () {
      if (!ready()) return;
      tone(ctx.currentTime, 783.99, 0.45, 0.1); // G5, quiet
    },
    yourTurn: function () {
      if (!ready()) return;
      var t = ctx.currentTime;
      tone(t, 783.99, 0.4, 0.14);       // G5
      tone(t + 0.13, 1046.5, 0.6, 0.14); // C6
    },
    invalid: function () {
      if (!ready()) return;
      var t = ctx.currentTime;
      [0, 0.11].forEach(function (d) {
        var o = ctx.createOscillator(); o.type = "square"; o.frequency.value = 130;
        var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.09);
        o.connect(lp); lp.connect(g); g.connect(master); o.start(t + d); o.stop(t + d + 0.12);
      });
    },
    win: function () {
      if (!ready()) return;
      var t = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(t + i * 0.12, f, 0.7, 0.13); });
    },
    lose: function () {
      if (!ready()) return;
      var t = ctx.currentTime;
      [523.25, 440, 392].forEach(function (f, i) { tone(t + i * 0.16, f, 0.6, 0.11, "triangle"); });
    },
    isMuted: function () { return muted; },
    setMuted: function (m) {
      muted = !!m;
      try { localStorage.setItem("tw:sound", muted ? "off" : "on"); } catch (e) {}
      if (!muted) { ensure(); Sound.place(); }
    }
  };

  window.Sound = Sound;
})();
