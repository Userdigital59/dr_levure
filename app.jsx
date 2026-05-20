/* Dr. Levure — Escape Room Boulangerie pédagogique
 * Écrans 1 (Intro) et 2 (Hub) implémentés en haute fidélité.
 * Écrans 3–9 : placeholders avec retour hub.
 */

const { useState, useEffect, useRef, useMemo } = React;

/* ---------- Palette & tokens ---------- */
const C = {
  bg:        "#3D1F0A",
  bgDeep:    "#2A1505",
  accent:    "#8B4513",
  accent2:   "#A85A22",
  gold:      "#D4A853",
  goldHi:    "#E9BE6A",
  ivory:     "#FFF8F0",
  ivoryDim:  "#F1E6D2",
  ink:       "#2A1505",
  red:       "#CC0000",
  redDeep:   "#8B0000",
  paper:     "#FFF4C2", // sticky notes
};

/* ---------- Helpers ---------- */
function pad(n) { return String(n).padStart(2, "0"); }
function fmtTime(s) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${pad(m)}:${pad(r)}`;
}

/* =========================================================================
 * AUDIO ENGINE — Web Audio API procédurale
 * Ambiances : intro (chaleureux), hub/puzzle (tension douce), victoire, défaite
 * Sons UI  : drop correct, drop wrong, cadenas ouvert, bouton CTA
 * ========================================================================= */
const AudioEngine = (() => {
  let ctx = null;
  let masterGain = null;
  let ambienceNode = null;
  let ambienceGain = null;
  let ambienceActive = false;
  let currentAmbience = null;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.72, ctx.currentTime);
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* ── Bruit blanc filtré → texture « fond de boulangerie » ── */
  function makeFilteredNoise(ac, freq, q, type = 'bandpass') {
    const bufLen = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filt = ac.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    src.connect(filt);
    return { src, filt };
  }

  /* ── Oscillateur simple ── */
  function osc(ac, freq, type = 'sine', startGain = 0.15) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = startGain;
    o.connect(g);
    return { o, g };
  }

  /* ── Enveloppe ADSR ── */
  function env(gainNode, ac, now, a, d, s, r, peak = 0.4) {
    const g = gainNode.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(peak, now + a);
    g.linearRampToValueAtTime(peak * s, now + a + d);
    g.setValueAtTime(peak * s, now + a + d);
    g.linearRampToValueAtTime(0, now + a + d + r);
  }

  /* ── AMBIANCE INTRO : chaleur de boulangerie à l'aube ──
     Drones graves chauds + bruit crème filtré + harmoniques de four */
  function startIntroAmbience() {
    const ac = getCtx();
    stopAmbience();
    ambienceGain = ac.createGain();
    ambienceGain.gain.setValueAtTime(0, ac.currentTime);
    ambienceGain.gain.linearRampToValueAtTime(0.55, ac.currentTime + 3.5);
    ambienceGain.connect(masterGain);

    // Drone fondamental (C2 = 65 Hz)
    const d1 = osc(ac, 65.4, 'sine', 0.22);
    // Quinte (G2 = 98 Hz)
    const d2 = osc(ac, 98, 'sine', 0.12);
    // Tierce (E2 = 82 Hz)
    const d3 = osc(ac, 82.4, 'triangle', 0.07);
    // LFO très lent sur d1 (respiration)
    const lfo1 = ac.createOscillator();
    const lfoGain1 = ac.createGain();
    lfo1.frequency.value = 0.08;
    lfoGain1.gain.value = 3;
    lfo1.connect(lfoGain1);
    lfoGain1.connect(d1.o.frequency);
    lfo1.start();
    // Bruit crème (air chaud de four)
    const { src: ns, filt: nf } = makeFilteredNoise(ac, 280, 0.8, 'lowpass');
    const nGain = ac.createGain();
    nGain.gain.value = 0.045;
    nf.connect(nGain);
    // LFO sur bruit (souffle)
    const lfo2 = ac.createOscillator();
    const lfoGain2 = ac.createGain();
    lfo2.frequency.value = 0.13;
    lfoGain2.gain.value = 0.015;
    lfo2.connect(lfoGain2);
    lfoGain2.connect(nGain.gain);
    lfo2.start();

    [d1.g, d2.g, d3.g, nGain].forEach(g => g.connect(ambienceGain));
    [d1.o, d2.o, d3.o, ns].forEach(n => n.start());
    ambienceActive = true;
    currentAmbience = 'intro';
    ambienceNode = { nodes: [d1.o, d2.o, d3.o, lfo1, lfo2, ns] };
  }

  /* ── AMBIANCE HUB/PUZZLE : tension douce + tic-tac + chaleur ──
     Cordes de chambre simulées + pulsations rythmiques discrètes */
  function startGameAmbience() {
    const ac = getCtx();
    stopAmbience();
    ambienceGain = ac.createGain();
    ambienceGain.gain.setValueAtTime(0, ac.currentTime);
    ambienceGain.gain.linearRampToValueAtTime(0.42, ac.currentTime + 2.5);
    ambienceGain.connect(masterGain);

    // Cordes basses (D2 = 73 Hz + harmonique A2 = 110 Hz)
    const s1 = osc(ac, 73.4, 'sawtooth', 0.06);
    const s2 = osc(ac, 110, 'sawtooth', 0.035);
    // Filtre passe-bas pour adoucir les scies
    const lpf = ac.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 420;
    lpf.Q.value = 1.2;
    s1.g.connect(lpf);
    s2.g.connect(lpf);
    lpf.connect(ambienceGain);
    // Trémolo (LFO 4 Hz sur gain)
    const trem = ac.createOscillator();
    const tremGain = ac.createGain();
    trem.frequency.value = 0.35;
    tremGain.gain.value = 0.06;
    trem.connect(tremGain);
    tremGain.connect(ambienceGain.gain);
    trem.start();
    // Bruit ambiance salle
    const { src: ns2, filt: nf2 } = makeFilteredNoise(ac, 600, 0.5, 'bandpass');
    const nG2 = ac.createGain();
    nG2.gain.value = 0.018;
    nf2.connect(nG2);
    nG2.connect(ambienceGain);
    // Tic-tac : impulsions rythmiques toutes les secondes
    const tickInterval = setInterval(() => {
      if (!ambienceActive) { clearInterval(tickInterval); return; }
      const a2 = getCtx();
      const now2 = a2.currentTime;
      const tOsc = a2.createOscillator();
      const tGain = a2.createGain();
      tOsc.type = 'sine';
      tOsc.frequency.setValueAtTime(1200, now2);
      tOsc.frequency.exponentialRampToValueAtTime(800, now2 + 0.04);
      tGain.gain.setValueAtTime(0, now2);
      tGain.gain.linearRampToValueAtTime(0.038, now2 + 0.008);
      tGain.gain.exponentialRampToValueAtTime(0.0001, now2 + 0.09);
      tOsc.connect(tGain);
      tGain.connect(masterGain);
      tOsc.start(now2);
      tOsc.stop(now2 + 0.1);
    }, 1000);

    [s1.o, s2.o, ns2].forEach(n => n.start());
    ambienceActive = true;
    currentAmbience = 'game';
    ambienceNode = { nodes: [s1.o, s2.o, trem, ns2], interval: tickInterval };
  }

  /* ── AMBIANCE VICTOIRE : fanfare festive de boulangerie ──────────────────
     Mélodie joyeuse en do majeur + basse rythmique + accords claquants +
     tambourin simulé → kermesse de village, pain sorti du four, fête !      */
  function startVictoireAmbience() {
    const ac = getCtx();
    stopAmbience();
    ambienceGain = ac.createGain();
    ambienceGain.gain.setValueAtTime(0, ac.currentTime);
    ambienceGain.gain.linearRampToValueAtTime(0.62, ac.currentTime + 0.4);
    ambienceGain.connect(masterGain);

    const now = ac.currentTime;
    const BPM = 132;
    const beat = 60 / BPM;           // ~0.455 s
    const bar  = beat * 4;

    // ── Mélodie principale : flûte/fifre (triangle adouci) ──────────────
    // Gamme do majeur — motif festif répété toutes les 2 mesures
    //   Sol La Si Do | Re Mi Fa Sol | Do' La Sol Mi | Do' – – –
    const melody = [
      // mesure 1
      [392,  0*beat, 0.8*beat],
      [440,  1*beat, 0.8*beat],
      [493.9,2*beat, 0.8*beat],
      [523.3,3*beat, 0.8*beat],
      // mesure 2
      [587.3,4*beat, 0.8*beat],
      [659.3,5*beat, 0.8*beat],
      [698.5,6*beat, 0.8*beat],
      [784,  7*beat, 0.8*beat],
      // mesure 3
      [1046.5,8*beat, 0.8*beat],
      [880,   9*beat, 0.8*beat],
      [784,  10*beat, 0.8*beat],
      [659.3,11*beat, 0.8*beat],
      // mesure 4
      [523.3,12*beat, 2.8*beat],
    ];
    const melPeriod = bar * 4;  // 4 mesures

    function scheduleMelody(offset) {
      melody.forEach(([freq, t, dur]) => {
        const start = now + offset + t;
        const end   = start + dur * 0.88;
        const mo = ac.createOscillator();
        const mg = ac.createGain();
        mo.type = 'triangle';
        mo.frequency.setValueAtTime(freq, start);
        mg.gain.setValueAtTime(0, start);
        mg.gain.linearRampToValueAtTime(0.18, start + 0.02);
        mg.gain.setValueAtTime(0.18, end - 0.04);
        mg.gain.linearRampToValueAtTime(0, end);
        mo.connect(mg); mg.connect(ambienceGain);
        mo.start(start); mo.stop(end + 0.05);
      });
    }
    // Planifier 6 répétitions (≈ 27 s bien joué)
    for (let rep = 0; rep < 6; rep++) scheduleMelody(rep * melPeriod);

    // ── Basse rythmique : do-sol alternés sur les temps forts ───────────
    const bassNotes = [65.4, 65.4, 98, 65.4]; // C2 C2 G2 C2 par mesure
    function scheduleBass(offset) {
      for (let m = 0; m < 16; m++) {
        bassNotes.forEach((freq, b) => {
          const start = now + offset + m * bar + b * beat;
          const bo = ac.createOscillator();
          const bg = ac.createGain();
          bo.type = 'sine';
          bo.frequency.value = freq;
          bg.gain.setValueAtTime(0, start);
          bg.gain.linearRampToValueAtTime(0.22, start + 0.025);
          bg.gain.exponentialRampToValueAtTime(0.001, start + beat * 0.75);
          bo.connect(bg); bg.connect(ambienceGain);
          bo.start(start); bo.stop(start + beat);
        });
      }
    }
    scheduleBass(0);

    // ── Accords claquants (carreau de mandoline simulé) ──────────────────
    // Accord do majeur : C4 E4 G4 — sur temps 2 et 4 de chaque mesure
    const chordFreqs = [261.6, 329.6, 392];
    function scheduleChords(offset) {
      for (let m = 0; m < 16; m++) {
        [1, 3].forEach(b => {
          const start = now + offset + m * bar + b * beat;
          chordFreqs.forEach(f => {
            const co = ac.createOscillator();
            const cg = ac.createGain();
            co.type = 'sawtooth';
            co.frequency.value = f;
            const lpfC = ac.createBiquadFilter();
            lpfC.type = 'lowpass'; lpfC.frequency.value = 1800;
            cg.gain.setValueAtTime(0, start);
            cg.gain.linearRampToValueAtTime(0.07, start + 0.01);
            cg.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
            co.connect(lpfC); lpfC.connect(cg); cg.connect(ambienceGain);
            co.start(start); co.stop(start + 0.22);
          });
        });
      }
    }
    scheduleChords(0);

    // ── Tambourin : bruit blanc court sur chaque temps ───────────────────
    function scheduleTambourin(offset) {
      for (let step = 0; step < 64; step++) {
        const start = now + offset + step * beat;
        const isStrong = step % 4 === 0 || step % 4 === 2;
        const bufLen = Math.floor(ac.sampleRate * 0.06);
        const tbuf = ac.createBuffer(1, bufLen, ac.sampleRate);
        const td = tbuf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) td[i] = (Math.random() * 2 - 1);
        const tbs = ac.createBufferSource();
        tbs.buffer = tbuf;
        const tbg = ac.createGain();
        const hpf = ac.createBiquadFilter();
        hpf.type = 'highpass'; hpf.frequency.value = 4000;
        tbg.gain.setValueAtTime(isStrong ? 0.06 : 0.025, start);
        tbg.gain.exponentialRampToValueAtTime(0.0001, start + 0.055);
        tbs.connect(hpf); hpf.connect(tbg); tbg.connect(ambienceGain);
        tbs.start(start); tbs.stop(start + 0.07);
      }
    }
    scheduleTambourin(0);

    ambienceActive = true;
    currentAmbience = 'victoire';
    // Pas de nodes à stopper manuellement (tous auto-stop via .stop())
    ambienceNode = { nodes: [] };
  }

  /* ── AMBIANCE DÉFAITE : sombre, boulangerie fermée ── */
  function startDefaiteAmbience() {
    const ac = getCtx();
    stopAmbience();
    ambienceGain = ac.createGain();
    ambienceGain.gain.setValueAtTime(0, ac.currentTime);
    ambienceGain.gain.linearRampToValueAtTime(0.35, ac.currentTime + 1.5);
    ambienceGain.connect(masterGain);

    // Drone mineur grave (A1 = 55 Hz + mineur C2 = 65)
    const dm1 = osc(ac, 55, 'sine', 0.18);
    const dm2 = osc(ac, 65.4, 'triangle', 0.09);
    // Bruit froid
    const { src: nd, filt: nfd } = makeFilteredNoise(ac, 150, 1.2, 'lowpass');
    const ngd = ac.createGain();
    ngd.gain.value = 0.055;
    nfd.connect(ngd);
    [dm1.g, dm2.g, ngd].forEach(g => g.connect(ambienceGain));
    [dm1.o, dm2.o, nd].forEach(n => n.start());
    ambienceActive = true;
    currentAmbience = 'defaite';
    ambienceNode = { nodes: [dm1.o, dm2.o, nd] };
  }

  function stopAmbience() {
    if (!ambienceActive) return;
    ambienceActive = false;
    if (ambienceNode?.interval) clearInterval(ambienceNode.interval);
    if (ambienceGain) {
      const ac2 = getCtx();
      ambienceGain.gain.linearRampToValueAtTime(0, ac2.currentTime + 1.2);
      setTimeout(() => {
        if (ambienceNode?.nodes) {
          ambienceNode.nodes.forEach(n => { try { n.stop(); } catch(e) {} });
        }
        ambienceNode = null;
        ambienceGain = null;
      }, 1400);
    }
    currentAmbience = null;
  }

  /* ── SONS UI ─────────────────────────────────────────────────── */

  // Drop correct (étiquette placée avec succès)
  function playDropCorrect() {
    const ac = getCtx(); const now = ac.currentTime;
    const o2 = ac.createOscillator(); const g = ac.createGain();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(880, now);
    o2.frequency.exponentialRampToValueAtTime(1320, now + 0.07);
    env(g, ac, now, 0.01, 0.05, 0.3, 0.18, 0.28);
    o2.connect(g); g.connect(masterGain);
    o2.start(now); o2.stop(now + 0.35);
  }

  // Drop wrong (mauvaise zone)
  function playDropWrong() {
    const ac = getCtx(); const now = ac.currentTime;
    const o2 = ac.createOscillator(); const g = ac.createGain();
    o2.type = 'sawtooth';
    o2.frequency.setValueAtTime(220, now);
    o2.frequency.exponentialRampToValueAtTime(140, now + 0.15);
    env(g, ac, now, 0.005, 0.08, 0.1, 0.2, 0.22);
    const lpf = ac.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 600;
    o2.connect(lpf); lpf.connect(g); g.connect(masterGain);
    o2.start(now); o2.stop(now + 0.32);
  }

  // Cadenas ouvert (cliquetis métallique + note de réussite)
  function playUnlock() {
    const ac = getCtx(); const now = ac.currentTime;
    // Cliquetis (bruit court filtré)
    const { src: nc, filt: nfc } = makeFilteredNoise(ac, 3500, 6, 'highpass');
    const ngc = ac.createGain();
    env(ngc, ac, now, 0.002, 0.04, 0.0, 0.06, 0.35);
    nfc.connect(ngc); ngc.connect(masterGain);
    nc.start(now); nc.stop(now + 0.12);
    // Note de réussite (accord C5 + E5)
    [523.3, 659.3, 783.9].forEach((f, i) => {
      const t = now + 0.08 + i * 0.05;
      const oo = ac.createOscillator(); const gg = ac.createGain();
      oo.type = 'sine'; oo.frequency.value = f;
      env(gg, ac, t, 0.01, 0.08, 0.5, 0.35, 0.22);
      oo.connect(gg); gg.connect(masterGain);
      oo.start(t); oo.stop(t + 0.55);
    });
  }

  // CTA intro (son d'ouverture de porte / invitation)
  function playCTA() {
    const ac = getCtx(); const now = ac.currentTime;
    [196, 246.9, 293.7, 392].forEach((f, i) => {
      const t = now + i * 0.06;
      const oo = ac.createOscillator(); const gg = ac.createGain();
      oo.type = 'sine'; oo.frequency.value = f;
      env(gg, ac, t, 0.015, 0.1, 0.4, 0.4, 0.18);
      oo.connect(gg); gg.connect(masterGain);
      oo.start(t); oo.stop(t + 0.65);
    });
  }

  // Son de validation correcte finale (victoire sur puzzle)
  function playValidation() {
    const ac = getCtx(); const now = ac.currentTime;
    [392, 523.3, 659.3, 784].forEach((f, i) => {
      const t = now + i * 0.09;
      const oo = ac.createOscillator(); const gg = ac.createGain();
      oo.type = 'triangle'; oo.frequency.value = f;
      env(gg, ac, t, 0.01, 0.12, 0.6, 0.5, 0.28);
      oo.connect(gg); gg.connect(masterGain);
      oo.start(t); oo.stop(t + 0.72);
    });
  }

  // Hover bouton (très discret)
  function playHover() {
    const ac = getCtx(); const now = ac.currentTime;
    const oo = ac.createOscillator(); const gg = ac.createGain();
    oo.type = 'sine'; oo.frequency.value = 1100;
    env(gg, ac, now, 0.005, 0.03, 0, 0.05, 0.04);
    oo.connect(gg); gg.connect(masterGain);
    oo.start(now); oo.stop(now + 0.09);
  }

  return {
    startIntroAmbience,
    startGameAmbience,
    startVictoireAmbience,
    startDefaiteAmbience,
    stopAmbience,
    playDropCorrect,
    playDropWrong,
    playUnlock,
    playCTA,
    playValidation,
    playHover,
    getCurrentAmbience: () => currentAmbience,
  };
})();

/* ── Hook useAmbience : gère les transitions automatiques par écran ── */
function useAmbience(ecran) {
  useEffect(() => {
    if (ecran === 1) AudioEngine.startIntroAmbience();
    else if (ecran >= 2 && ecran <= 6) {
      if (AudioEngine.getCurrentAmbience() !== 'game')
        AudioEngine.startGameAmbience();
    }
    else if (ecran === 7) AudioEngine.startVictoireAmbience();
    else if (ecran === 8) AudioEngine.startDefaiteAmbience();
    else if (ecran === 9) { /* bilan : silence progressif */ AudioEngine.stopAmbience(); }
  }, [ecran]);
}



/* ---------- ChronoTimer ---------- */
function ChronoTimer({ secondes, running, onZero }) {
  const danger = secondes <= 60;
  return (
    <div
      style={{
        position: "absolute",
        top: 20,
        right: 24,
        display: "flex",
        alignItems: "center",
        gap: 10,
        zIndex: 30,
      }}
    >
      <span
        style={{
          fontFamily: "Georgia, serif",
          fontStyle: "italic",
          fontSize: 13,
          color: C.ivoryDim,
          opacity: 0.75,
        }}
      >
        chrono live
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          borderRadius: 10,
          background: danger ? "rgba(204,0,0,0.15)" : "rgba(255,248,240,0.05)",
          border: `1.5px solid ${danger ? C.red : C.gold}`,
          color: danger ? C.red : C.gold,
          fontFamily: "Georgia, serif",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: 1,
          minWidth: 110,
          justifyContent: "center",
          animation: danger ? "clockTick 1.2s ease-in-out infinite" : "none",
          boxShadow: danger
            ? "0 0 24px rgba(204,0,0,0.25), inset 0 0 12px rgba(204,0,0,0.15)"
            : "0 4px 14px rgba(0,0,0,0.35)",
          transition: "all 0.25s ease",
        }}
        aria-label={`Chronomètre : ${fmtTime(secondes)}`}
      >
        <ClockIcon color={danger ? C.red : C.gold} />
        <span>{fmtTime(secondes)}</span>
      </div>
    </div>
  );
}

function ClockIcon({ color = C.gold, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="13" r="8" stroke={color} strokeWidth="1.8" />
      <path d="M12 9v4l2.5 2" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 3h6M12 3v3" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- Screen tag (top-left "1 · Intro …") ---------- */
function ScreenTag({ index, title }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 22,
        left: 24,
        display: "flex",
        alignItems: "center",
        gap: 12,
        zIndex: 20,
        fontFamily: "Georgia, serif",
        fontStyle: "italic",
        color: C.ivoryDim,
        opacity: 0.85,
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: `1.5px solid ${C.ivoryDim}`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Georgia, serif",
          fontStyle: "normal",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {index}
      </span>
      <span style={{ fontSize: 14, letterSpacing: 0.3 }}>{title}</span>
    </div>
  );
}

/* ---------- Sticky note (kraft yellow margin notes) ---------- */
function StickyNote({ children, style, rotate = -2 }) {
  return (
    <div
      style={{
        position: "absolute",
        background: C.paper,
        color: "#3a2a06",
        padding: "10px 14px",
        fontFamily: "Georgia, serif",
        fontStyle: "italic",
        fontSize: 13,
        lineHeight: 1.4,
        boxShadow: "0 6px 14px rgba(0,0,0,0.35), inset 0 -2px 0 rgba(0,0,0,0.06)",
        transform: `rotate(${rotate}deg)`,
        maxWidth: 220,
        zIndex: 15,
        ...style,
      }}
    >
      {children}
    </div>
  );
}


/* =========================================================================
 * COMPOSANT — Popup saisie du nom du joueur
 * Bloque l'accès jusqu'à validation d'un nom non-vide
 * ========================================================================= */
function PlayerNameModal({ onConfirm }) {
  const [name, setName] = React.useState('');
  const [shake, setShake] = React.useState(false);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    setTimeout(() => inputRef.current && inputRef.current.focus(), 120);
  }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setShake(true);
      setTimeout(() => setShake(false), 600);
      inputRef.current && inputRef.current.focus();
      return;
    }
    AudioEngine.playCTA();
    onConfirm(trimmed);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(20,8,2,0.85)',
        backdropFilter: 'blur(6px)',
        animation: 'screenFade 0.35s ease both',
      }}
    >
      <div
        style={{
          background: C.ivory,
          borderRadius: 16,
          padding: '44px 52px 40px',
          maxWidth: 460,
          width: '90%',
          boxShadow: '0 32px 72px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(139,69,19,0.12)',
          textAlign: 'center',
          position: 'relative',
          animation: 'parallaxIn 0.45s ease both',
        }}
      >
        {/* Icône */}
        <div style={{ fontSize: 42, marginBottom: 14, lineHeight: 1 }}>🍞</div>

        <h2
          style={{
            fontFamily: 'Georgia, serif',
            fontSize: 26,
            fontWeight: 400,
            color: C.ink,
            marginBottom: 10,
            letterSpacing: 0.2,
          }}
        >
          Bienvenue au laboratoire&nbsp;!
        </h2>

        <p
          style={{
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: 14,
            lineHeight: 1.65,
            color: '#4a3018',
            marginBottom: 28,
          }}
        >
          Avant de commencer, identifiez-vous.<br />
          <em>Votre nom apparaîtra tout au long de la mission.</em>
        </p>

        {/* Champ nom */}
        <div style={{ marginBottom: 24 }}>
          <label
            htmlFor="player-name-input"
            style={{
              display: 'block',
              fontFamily: 'Georgia, serif',
              fontStyle: 'italic',
              fontSize: 13,
              color: '#5a3d1b',
              marginBottom: 8,
              textAlign: 'left',
            }}
          >
            Votre prénom ou pseudonyme
          </label>
          <input
            id="player-name-input"
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKey}
            maxLength={32}
            placeholder="Ex : Marie, Équipe A…"
            className={shake ? 'shake-btn' : ''}
            style={{
              width: '100%',
              padding: '12px 16px',
              fontFamily: 'Georgia, serif',
              fontSize: 17,
              color: C.ink,
              background: '#FFFAF2',
              border: `2px solid ${shake ? C.red : C.accent}`,
              borderRadius: 8,
              outline: 'none',
              textAlign: 'center',
              letterSpacing: 0.5,
              transition: 'border-color 0.2s',
              boxSizing: 'border-box',
            }}
          />
          {shake && (
            <p style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 12,
              color: C.red,
              marginTop: 6,
              textAlign: 'left',
            }}>
              ⚠ Veuillez saisir votre nom pour continuer.
            </p>
          )}
        </div>

        {/* Bouton */}
        <button
          onClick={handleSubmit}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '13px 32px',
            background: `linear-gradient(180deg, ${C.goldHi} 0%, ${C.gold} 100%)`,
            color: C.ink,
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: 0.3,
            border: `1.5px solid ${C.accent}`,
            borderRadius: 10,
            cursor: 'pointer',
            boxShadow: '0 8px 22px rgba(212,168,83,0.35), inset 0 1px 0 rgba(255,255,255,0.45)',
          }}
        >
          🔬 Entrer dans le laboratoire
        </button>

        {/* Note de confidentialité */}
        <p style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: 11,
          color: '#9a7a5a',
          marginTop: 18,
          fontStyle: 'italic',
        }}>
          Votre nom est utilisé uniquement dans ce module.
        </p>
      </div>
    </div>
  );
}

/* =========================================================================
 * ÉCRAN 1 — Intro
 * ========================================================================= */
function Screen1Intro({ onStart, playerName }) {
  // Activate vivid bakery background only on intro screen
  React.useEffect(() => {
    const bg = document.querySelector('.bakery-bg');
    if (bg) bg.classList.add('intro-visible');
    return () => { if (bg) bg.classList.remove('intro-visible'); };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "70px 24px 60px",
        animation: "screenFade 0.3s ease both",
      }}
    >
      <ScreenTag index={1} title="Intro · Alerte boulangerie" />


      {/* Alert badge */}
      <div
        style={{
          marginTop: 30,
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 26px",
          background: `linear-gradient(180deg, ${C.red} 0%, ${C.redDeep} 100%)`,
          color: "#FFF",
          fontFamily: "Georgia, serif",
          fontWeight: 700,
          fontSize: 18,
          letterSpacing: 2,
          borderRadius: 999,
          border: "1.5px solid rgba(255,255,255,0.15)",
          animation: "pulseAlert 1.6s ease-in-out infinite",
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: "#FFF",
            boxShadow: "0 0 8px #FFF",
          }}
        />
        ALERTE
        
      </div>

      {/* Central card */}
      <div
        style={{
          marginTop: 70,
          background: C.ivory,
          color: C.ink,
          borderRadius: 14,
          padding: "44px 56px 38px",
          maxWidth: 560,
          width: "100%",
          boxShadow:
            "0 28px 60px rgba(0,0,0,0.55), 0 6px 16px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(139,69,19,0.08)",
          textAlign: "center",
          position: "relative",
        }}
      >
        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 34,
            fontWeight: 400,
            marginBottom: 22,
            letterSpacing: 0.2,
            color: C.ink,
          }}
        >
          Alerte en boulangerie&nbsp;!
        </h1>
        <p
          style={{
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 15,
            lineHeight: 1.7,
            color: "#3b2812",
            marginBottom: 18,
            textWrap: "pretty",
          }}
        >
          6h00 du matin. La boulangerie Durand ouvre dans 12 minutes.
          <br />
          La levure mère a disparu. Sans elle, pas de fermentation… pas de pain&nbsp;!
          <br />
          Les 4 verrous de sécurité du labo sont activés.
          <br />
          <em>Seule la connaissance peut les ouvrir.</em>
        </p>
        <p
          style={{
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            fontSize: 15,
            color: "#5a3d1b",
            marginBottom: 28,
          }}
        >
          Êtes-vous prêt,{" "}<strong style={{ color: C.accent }}>{playerName}</strong>&nbsp;?
        </p>

        <button
          onClick={() => { AudioEngine.playCTA(); onStart(); }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 28px",
            background: `linear-gradient(180deg, ${C.goldHi} 0%, ${C.gold} 100%)`,
            color: C.ink,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: 0.3,
            border: `1.5px solid ${C.accent}`,
            borderRadius: 10,
            cursor: "pointer",
            boxShadow:
              "0 8px 22px rgba(212,168,83,0.35), inset 0 1px 0 rgba(255,255,255,0.45)",
            transition: "transform 0.15s ease, box-shadow 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow =
              "0 12px 26px rgba(212,168,83,0.45), inset 0 1px 0 rgba(255,255,255,0.55)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow =
              "0 8px 22px rgba(212,168,83,0.35), inset 0 1px 0 rgba(255,255,255,0.45)";
          }}
        >
          <span style={{ fontSize: 18 }} aria-hidden="true">🔬</span>
          Entrer dans le laboratoire
        </button>
      </div>
    </div>
  );
}

/* =========================================================================
 * ÉCRAN 2 — Hub Laboratoire
 * ========================================================================= */
function Screen2Hub({ chrono, cadenas, onChooseVerrou, onZero }) {
  const verrous = [
    { id: 1, label: "Verrou 1", subLabel: "Anatomie cellule" },
    { id: 2, label: "Verrou 2", subLabel: "Bourgeonnement" },
    { id: 3, label: "Verrou 3", subLabel: "Types de levures" },
    { id: 4, label: "Verrou 4", subLabel: "Dosage" },
  ];
  const resolved = cadenas.filter(Boolean).length;
  // The first unresolved padlock is the active one (sequential unlock).
  const firstUnresolvedIdx = cadenas.findIndex((c) => !c);
  const activeId = firstUnresolvedIdx === -1 ? null : firstUnresolvedIdx + 1;

  const [hovered, setHovered] = useState(null);

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        padding: "70px 24px 40px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        animation: "screenFade 0.3s ease both",
      }}
    >
      <ScreenTag index={2} title="Hub · Vue d'ensemble laboratoire" />
      <ChronoTimer secondes={chrono} running={true} onZero={onZero} />

      {/* Title */}
      <div style={{ textAlign: "center", marginTop: 18, marginBottom: 26 }}>
        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontWeight: 400,
            fontSize: 34,
            color: C.ivory,
            letterSpacing: 0.2,
          }}
        >
          Laboratoire — Établi du fournil
        </h1>
        <p
          style={{
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 14,
            color: C.ivoryDim,
            opacity: 0.75,
            marginTop: 8,
          }}
        >
          Choisissez un verrou pour ouvrir l'énigme correspondante
        </p>
      </div>


      {/* Workbench */}
      <div
        className="workbench-bg"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 1080,
          borderRadius: 14,
          border: `2px solid ${C.accent}`,
          padding: "34px 32px 26px",
          boxShadow:
            "0 22px 50px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.4)",
        }}
      >
        {/* Hatch pattern lines visible on side margins */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            borderRadius: 12,
            background:
              "repeating-linear-gradient(45deg, rgba(139,69,19,0.05) 0 1px, transparent 1px 14px)",
          }}
        />

        {/* Padlock grid */}
        <div
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 18,
          }}
        >
          {verrous.map((v) => {
            const isResolved = cadenas[v.id - 1];
            const isActive = v.id === activeId && !isResolved;
            const isDisabled = !isActive && !isResolved;
            const isHover = hovered === v.id && isActive;

            return (
              <PadlockCard
                key={v.id}
                verrou={v}
                state={isResolved ? "resolved" : isActive ? "active" : "disabled"}
                hover={isHover}
                onMouseEnter={() => setHovered(v.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => isActive && onChooseVerrou(v.id)}
              />
            );
          })}
        </div>

        {/* Bench legs/feet stripe at bottom */}
        <div
          aria-hidden="true"
          style={{
            marginTop: 18,
            height: 14,
            borderTop: `1px dashed ${C.accent}`,
            background:
              "repeating-linear-gradient(90deg, transparent 0 22px, rgba(139,69,19,0.18) 22px 23px)",
            borderRadius: "0 0 10px 10px",
          }}
        />
      </div>

      {/* Progress bar */}
      <div
        style={{
          marginTop: 44,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {[0, 1, 2, 3].map((i) => (
            <React.Fragment key={i}>
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: cadenas[i] ? C.gold : "transparent",
                  border: `1.5px solid ${cadenas[i] ? C.gold : C.ivoryDim}`,
                  opacity: cadenas[i] ? 1 : 0.55,
                  boxShadow: cadenas[i]
                    ? "0 0 10px rgba(212,168,83,0.55)"
                    : "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontFamily: "Georgia, serif",
                  color: C.ink,
                  fontWeight: 700,
                }}
              >
                {i + 1}
              </div>
              {i < 3 && (
                <span
                  style={{
                    width: 36,
                    borderTop: `1.5px dashed ${C.ivoryDim}`,
                    opacity: 0.45,
                  }}
                />
              )}
            </React.Fragment>
          ))}
        </div>
        <p
          style={{
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            fontSize: 12,
            color: C.ivoryDim,
            opacity: 0.7,
          }}
        >
          énigme {Math.min(resolved + 1, 4)}/4 · résolues : {resolved}
        </p>
      </div>
    </div>
  );
}

/* ---------- PadlockCard ---------- */
function PadlockCard({ verrou, state, hover, onMouseEnter, onMouseLeave, onClick }) {
  const isActive = state === "active";
  const isResolved = state === "resolved";
  const isDisabled = state === "disabled";

  const baseBg = "#FFF8F0";
  const cardStyle = {
    position: "relative",
    background: baseBg,
    borderRadius: 10,
    padding: "14px 14px 18px",
    minHeight: 230,
    display: "flex",
    flexDirection: "column",
    cursor: isActive ? "pointer" : "default",
    border: isActive
      ? `2.5px solid ${C.gold}`
      : isResolved
        ? `2px solid ${C.accent}`
        : `1.5px solid rgba(139,69,19,0.35)`,
    opacity: isDisabled ? 0.4 : 1,
    animation: isActive ? "shimmer 2.2s ease-in-out infinite" : "none",
    boxShadow: isActive
      ? "0 14px 32px rgba(0,0,0,0.25)"
      : "0 6px 14px rgba(0,0,0,0.18)",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
    transform: hover ? "translateY(-3px)" : "translateY(0)",
  };

  const hatchOverlay = isDisabled && (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 10,
        pointerEvents: "none",
        background:
          "repeating-linear-gradient(45deg, rgba(0,0,0,0.06) 0 2px, transparent 2px 8px)",
      }}
    />
  );

  return (
    <div
      style={cardStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      role={isActive ? "button" : undefined}
      tabIndex={isActive ? 0 : -1}
      onKeyDown={(e) => {
        if (isActive && (e.key === "Enter" || e.key === " ")) onClick();
      }}
    >
      {hatchOverlay}

      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <span
          style={{
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            color: C.ink,
            fontSize: 14,
          }}
        >
          {verrou.label}
        </span>
        <LockGlyph open={isResolved} active={isActive} />
      </div>

      {/* Asset placeholder (monospace explainer) */}
      <div
        style={{
          marginTop: 22,
          marginBottom: 18,
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 100,
        }}
      >
        <VerrouIcon
          id={verrou.id}
          state={state}
        />
      </div>

      {/* Sub-label footer */}
      <div
        style={{
          textAlign: "center",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 11.5,
          color: "#5a3d1b",
          letterSpacing: 0.4,
          opacity: 0.85,
          borderTop: `1px solid rgba(139,69,19,0.18)`,
          paddingTop: 8,
          marginTop: 4,
        }}
      >
        {verrou.subLabel}
      </div>

      {/* Tooltip on hover for active */}
      {hover && isActive && (
        <div
          style={{
            position: "absolute",
            bottom: -36,
            left: "50%",
            transform: "translateX(-50%)",
            background: C.ink,
            color: C.ivory,
            padding: "6px 12px",
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            fontSize: 12,
            borderRadius: 6,
            whiteSpace: "nowrap",
            boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
            zIndex: 20,
          }}
        >
          Cliquez pour ouvrir
        </div>
      )}
    </div>
  );
}

function LockGlyph({ open, active }) {
  const color = active ? C.gold : open ? C.accent : "rgba(139,69,19,0.6)";
  return (
    <svg width="20" height="22" viewBox="0 0 20 22" fill="none" aria-hidden="true">
      {open ? (
        <>
          <path
            d="M5 10V7a5 5 0 019-3"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <rect x="3" y="10" width="14" height="10" rx="1.5" stroke={color} strokeWidth="1.8" fill="none" />
          <circle cx="10" cy="15" r="1.2" fill={color} />
        </>
      ) : (
        <>
          <path
            d="M5 10V7a5 5 0 0110 0v3"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <rect x="3" y="10" width="14" height="10" rx="1.5" stroke={color} strokeWidth="1.8" fill="none" />
          <circle cx="10" cy="15" r="1.2" fill={color} />
        </>
      )}
    </svg>
  );
}

/* Iconography for each verrou (hub cards) */
function VerrouIcon({ id, state }) {
  const tint =
    state === "active" ? C.accent : state === "resolved" ? "#2E8B57" : "rgba(139,69,19,0.55)";
  const fill = state === "active" ? "#FBEFD4" : state === "resolved" ? "#E8F5E9" : "#F4E6CC";
  const size = 96;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      aria-hidden="true"
      style={{
        filter: state === "active" ? "drop-shadow(0 4px 8px rgba(212,168,83,0.25))" : "none",
      }}
    >
      {id === 1 && <IconJarLevureMere tint={tint} fill={fill} />}
      {id === 2 && <IconBudding tint={tint} fill={fill} />}
      {id === 3 && <IconLabeledJars tint={tint} fill={fill} />}
      {id === 4 && <IconBalance tint={tint} fill={fill} />}
    </svg>
  );
}

/* — bocal de levure mère (jar with bubbles) — */
function IconJarLevureMere({ tint, fill }) {
  return (
    <g>
      {/* Cap */}
      <rect x="32" y="14" width="32" height="10" rx="2" fill={tint} />
      <rect x="36" y="11" width="24" height="5" rx="1.5" fill={tint} opacity="0.7" />
      {/* Body */}
      <path
        d="M28 26 Q28 24 30 24 L66 24 Q68 24 68 26 L68 78 Q68 84 60 84 L36 84 Q28 84 28 78 Z"
        fill={fill}
        stroke={tint}
        strokeWidth="1.8"
      />
      {/* Liquid level */}
      <path
        d="M30 56 Q48 50 66 56 L66 78 Q66 82 60 82 L36 82 Q30 82 30 78 Z"
        fill={tint}
        opacity="0.22"
      />
      {/* Bubbles */}
      <circle cx="40" cy="66" r="3" fill={tint} opacity="0.55" />
      <circle cx="52" cy="60" r="2.2" fill={tint} opacity="0.55" />
      <circle cx="56" cy="72" r="2.6" fill={tint} opacity="0.55" />
      <circle cx="44" cy="74" r="1.8" fill={tint} opacity="0.55" />
      {/* Label */}
      <rect x="36" y="38" width="24" height="12" rx="1.5" fill="#FFF8F0" stroke={tint} strokeWidth="1.2" />
      <line x1="40" y1="43" x2="56" y2="43" stroke={tint} strokeWidth="1" opacity="0.7" />
      <line x1="40" y1="46" x2="52" y2="46" stroke={tint} strokeWidth="1" opacity="0.5" />
    </g>
  );
}

/* — cellule en bourgeonnement (two cells, one budding) — */
function IconBudding({ tint, fill }) {
  return (
    <g>
      <ellipse cx="38" cy="50" rx="22" ry="20" fill={fill} stroke={tint} strokeWidth="1.8" />
      <circle cx="38" cy="50" r="6" fill={tint} opacity="0.7" />
      <circle cx="32" cy="44" r="1.8" fill={tint} opacity="0.45" />
      <circle cx="46" cy="58" r="1.8" fill={tint} opacity="0.45" />
      {/* Bud */}
      <ellipse cx="68" cy="36" rx="12" ry="11" fill={fill} stroke={tint} strokeWidth="1.8" />
      <circle cx="68" cy="36" r="3.2" fill={tint} opacity="0.7" />
      {/* Neck */}
      <path d="M55 42 Q60 39 62 38" stroke={tint} strokeWidth="1.4" fill="none" opacity="0.6" />
      <path d="M58 50 Q63 44 64 42" stroke={tint} strokeWidth="1.4" fill="none" opacity="0.6" />
      {/* Arrow indicating growth */}
      <path
        d="M22 78 Q40 86 80 76"
        stroke={tint}
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="3 3"
        opacity="0.7"
      />
      <path d="M77 73 L82 76 L77 80" stroke={tint} strokeWidth="1.5" fill="none" />
    </g>
  );
}

/* — 5 bocaux étiquetés alignés — */
function IconLabeledJars({ tint, fill }) {
  const jars = [
    [16, 32], [33, 36], [50, 30], [67, 36], [82, 32],
  ];
  return (
    <g>
      {jars.map(([x, y], i) => (
        <g key={i} transform={`translate(${x - 6}, ${y})`}>
          <rect x="0" y="0" width="12" height="3" rx="1" fill={tint} />
          <rect
            x="-1"
            y="3"
            width="14"
            height="38"
            rx="2"
            fill={fill}
            stroke={tint}
            strokeWidth="1.4"
          />
          {/* Label */}
          <rect
            x="0.5"
            y="14"
            width="11"
            height="14"
            fill="#FFF8F0"
            stroke={tint}
            strokeWidth="0.8"
          />
          <line x1="2" y1="18" x2="10" y2="18" stroke={tint} strokeWidth="0.8" opacity="0.6" />
          <line x1="2" y1="22" x2="8"  y2="22" stroke={tint} strokeWidth="0.8" opacity="0.5" />
          <line x1="2" y1="25" x2="9"  y2="25" stroke={tint} strokeWidth="0.8" opacity="0.4" />
        </g>
      ))}
      {/* Shelf */}
      <line x1="8" y1="76" x2="88" y2="76" stroke={tint} strokeWidth="1.4" opacity="0.6" />
    </g>
  );
}

/* — balance simple — */
function IconBalance({ tint, fill }) {
  return (
    <g>
      {/* Base */}
      <rect x="36" y="74" width="24" height="6" rx="1.5" fill={tint} />
      <rect x="46" y="36" width="4" height="38" fill={tint} />
      <circle cx="48" cy="34" r="3.5" fill={tint} />
      {/* Beam */}
      <rect x="14" y="32" width="68" height="4" rx="1.5" fill={tint} />
      {/* Left pan */}
      <line x1="22" y1="36" x2="22" y2="50" stroke={tint} strokeWidth="1.4" />
      <ellipse cx="22" cy="52" rx="12" ry="3" fill={tint} opacity="0.9" />
      <path d="M10 52 Q22 60 34 52 L31 56 Q22 62 13 56 Z" fill={fill} stroke={tint} strokeWidth="1.2" />
      {/* Right pan */}
      <line x1="74" y1="36" x2="74" y2="50" stroke={tint} strokeWidth="1.4" />
      <ellipse cx="74" cy="52" rx="12" ry="3" fill={tint} opacity="0.9" />
      <path d="M62 52 Q74 60 86 52 L83 56 Q74 62 65 56 Z" fill={fill} stroke={tint} strokeWidth="1.2" />
      {/* Brick on right pan */}
      <rect x="68" y="44" width="12" height="6" rx="1" fill={tint} opacity="0.85" />
      {/* Flour pile on left pan */}
      <ellipse cx="22" cy="47" rx="8" ry="3" fill="#FFF8F0" opacity="0.85" />
      <ellipse cx="22" cy="44" rx="5" ry="2" fill="#FFF8F0" />
    </g>
  );
}

/* =========================================================================
 * ÉCRAN 3 — Verrou 1 : Anatomie de la cellule (drag & drop)
 * ========================================================================= */

/* Drop zone definitions — coords in SVG viewBox (0 0 700 480) */
const CELL_ZONES = [
  { id: 1, x: 360, y: 240, r: 36, label: "Noyau",              hint: "grand cercle central" },
  { id: 2, x: 470, y: 285, r: 28, label: "Enzymes",            hint: "petits points dispersés" },
  { id: 3, x: 235, y: 310, r: 34, label: "Vacuole",            hint: "cercle moyen en bas-gauche" },
  { id: 4, x: 220, y: 100, r: 30, label: "Paroi cellulaire",   hint: "ellipse extérieure" },
  { id: 5, x: 510, y: 165, r: 30, label: "Membrane cellulaire",hint: "ellipse intérieure" },
  { id: 6, x: 360, y: 395, r: 30, label: "Cytoplasme",         hint: "zone diffuse autour" },
];
const CELL_LABELS = [
  "Noyau", "Vacuole", "Cytoplasme",
  "Membrane cellulaire", "Paroi cellulaire", "Enzymes",
];

function Screen3Enigme1({ chrono, tentatives, onBack, onSuccess, onUpdateTentatives, onZero }) {
  // placed: { [zoneId]: labelName } — only correct placements persist.
  const [placed, setPlaced] = useState({});
  const [shakeZone, setShakeZone] = useState(null);   // zoneId currently shaking on wrong drop
  const [dragLabel, setDragLabel] = useState(null);
  const [hoverZone, setHoverZone] = useState(null);
  const [unlocking, setUnlocking] = useState(false);
  const [shakeVer, setShakeVer] = useState(false);

  const placedCount = Object.keys(placed).length;
  const allFilled = placedCount === 6;
  const usedLabels = new Set(Object.values(placed));

  const handleDragStart = (e, label) => {
    setDragLabel(label);
    e.dataTransfer.setData("text/plain", label);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragEnd = () => {
    setDragLabel(null);
    setHoverZone(null);
  };

  const handleDrop = (e, zone) => {
    e.preventDefault();
    setHoverZone(null);
    const label = e.dataTransfer.getData("text/plain") || dragLabel;
    if (!label) return;
    if (placed[zone.id]) return; // zone already correctly filled — no-op
    if (usedLabels.has(label)) return; // label already correctly placed elsewhere — no-op

    if (label === zone.label) {
      AudioEngine.playDropCorrect();
      setPlaced((p) => ({ ...p, [zone.id]: label }));
    } else {
      AudioEngine.playDropWrong();
      setShakeZone(zone.id);
      onUpdateTentatives(1, 1); // verrou 1, +1 tentative
      setTimeout(() => setShakeZone((z) => (z === zone.id ? null : z)), 600);
    }
  };

  const handleVerify = () => {
    if (!allFilled) return;
    // All placed labels are by definition correct (wrong drops never persist) → success
    AudioEngine.playUnlock();
    setUnlocking(true);
    setTimeout(() => onSuccess(), 1100);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        padding: "60px 24px 50px",
        animation: "screenFade 0.3s ease both",
      }}
    >
      <ScreenTag index={3} title="Énigme 1 · Anatomie cellule" />
      <ChronoTimer secondes={chrono} running={true} onZero={onZero} />

      {/* Back link */}
      <button
        onClick={onBack}
        style={{
          position: "absolute",
          top: 60,
          left: 90,
          background: C.ivory,
          color: C.ink,
          border: `1.5px solid ${C.accent}`,
          padding: "6px 12px",
          borderRadius: 8,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
          zIndex: 10,
        }}
      >
        ← Retour au hub
      </button>

      {/* Title block */}
      <div style={{ maxWidth: 1100, margin: "42px auto 22px" }}>
        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontWeight: 400,
            fontSize: 30,
            color: C.ivory,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 26 }}>🔬</span>
          Verrou 1 — Anatomie de la cellule
        </h1>
        <p
          style={{
            marginTop: 6,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 14,
            color: C.ivoryDim,
            opacity: 0.85,
            maxWidth: 760,
          }}
        >
          Le bocal de levure mère est étiqueté mais les étiquettes ont été décollées&nbsp;!
          Replacez les bons termes.
        </p>
      </div>

      {/* Main two-column area */}
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 320px",
          gap: 28,
          alignItems: "start",
        }}
      >
        {/* === Left : SVG schema === */}
        <div
          style={{
            position: "relative",
            background: C.ivory,
            border: `2px solid ${C.accent}`,
            borderRadius: 12,
            padding: "18px 18px 22px",
            boxShadow: "0 16px 36px rgba(0,0,0,0.45)",
          }}
        >
          

          <CellSchema
            zones={CELL_ZONES}
            placed={placed}
            shakeZone={shakeZone}
            hoverZone={hoverZone}
            dragLabel={dragLabel}
            unlocking={unlocking}
            onDragOver={(e, zoneId) => {
              e.preventDefault();
              setHoverZone(zoneId);
            }}
            onDragLeave={(zoneId) =>
              setHoverZone((h) => (h === zoneId ? null : h))
            }
            onDrop={handleDrop}
          />
        </div>

        {/* === Right : Labels palette === */}
        <div>
          <div
            style={{
              fontFamily: "Georgia, serif",
              fontStyle: "italic",
              color: C.ivory,
              fontSize: 14,
              marginBottom: 10,
            }}
          >
            Étiquettes à glisser ↓
          </div>

          <div
            style={{
              background: C.ivory,
              border: `2px solid ${C.accent}`,
              borderRadius: 12,
              padding: 14,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              boxShadow: "0 12px 28px rgba(0,0,0,0.4)",
            }}
          >
            {CELL_LABELS.map((lbl) => {
              const used = usedLabels.has(lbl);
              return (
                <LabelChip
                  key={lbl}
                  label={lbl}
                  used={used}
                  dragging={dragLabel === lbl}
                  onDragStart={(e) => handleDragStart(e, lbl)}
                  onDragEnd={handleDragEnd}
                />
              );
            })}
          </div>

          {/* Counter + verify */}
          <div
            style={{
              marginTop: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span
              style={{
                fontFamily: "Georgia, serif",
                fontStyle: "italic",
                color: C.ivoryDim,
                fontSize: 13,
              }}
            >
              Tentatives&nbsp;: <strong style={{ fontStyle: "normal", color: C.ivory }}>{tentatives[1] || 0}</strong>
            </span>

            <button
              onClick={() => {
                if (!allFilled) {
                  if (shakeVer) return;
                  setShakeVer(true);
                  setTimeout(() => setShakeVer(false), 520);
                  return;
                }
                handleVerify();
              }}
              className={shakeVer ? "shake-btn no-lift" : ""}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "11px 22px",
                background: allFilled
                  ? `linear-gradient(180deg, ${C.goldHi} 0%, ${C.gold} 100%)`
                  : "rgba(212,168,83,0.25)",
                color: allFilled ? C.ink : "rgba(255,248,240,0.55)",
                border: `1.5px solid ${allFilled ? C.accent : "rgba(139,69,19,0.4)"}`,
                borderRadius: 10,
                fontFamily: "Arial, Helvetica, sans-serif",
                fontWeight: 700,
                fontSize: 14,
                cursor: allFilled ? "pointer" : "not-allowed",
                boxShadow: allFilled
                  ? "0 8px 20px rgba(212,168,83,0.4)"
                  : "none",
                transition: "all 0.2s ease",
              }}
            >
              Vérifier ✓
            </button>
          </div>

          {/* Progress mini */}
          <div
            style={{
              marginTop: 14,
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 11.5,
              color: C.ivoryDim,
              opacity: 0.65,
              letterSpacing: 0.4,
            }}
          >
            {placedCount}/6 étiquettes placées
          </div>
        </div>
      </div>

      {/* Bottom sticky + progress */}
      <div style={{ maxWidth: 1100, margin: "30px auto 0", position: "relative" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            marginTop: 30,
          }}
        >
          <ProgressDots active={1} resolved={[]} />
        </div>
      </div>

      {/* Unlocking overlay */}
      {unlocking && <UnlockOverlay verrouNum={1} />}
    </div>
  );
}

/* ---------- Cell schema SVG ---------- */
function CellSchema({
  zones, placed, shakeZone, hoverZone, dragLabel, unlocking,
  onDragOver, onDragLeave, onDrop,
}) {
  // Static decorative enzyme dots (avoid overlap with zones)
  const enzymeDots = [
    [330, 200], [400, 320], [450, 220], [490, 270], [305, 350],
    [415, 380], [350, 165], [275, 250], [495, 320], [380, 285],
  ];

  return (
    <svg
      viewBox="0 0 700 480"
      width="100%"
      style={{ display: "block", aspectRatio: "700 / 480" }}
      aria-label="Schéma d'une cellule de levure"
    >
      {/* Background subtle pattern */}
      <defs>
        <pattern id="hatch" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(139,69,19,0.07)" strokeWidth="1" />
        </pattern>
        <radialGradient id="cytoGrad" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#FDF1D6" />
          <stop offset="100%" stopColor="#F4E0B0" />
        </radialGradient>
        <radialGradient id="nucGrad" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#E9C58A" />
          <stop offset="100%" stopColor="#C68A3D" />
        </radialGradient>
        <radialGradient id="vacGrad" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#F4D69E" />
          <stop offset="100%" stopColor="#D9B27B" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="700" height="480" fill="url(#hatch)" />

      {/* Outer ellipse — paroi cellulaire */}
      <ellipse cx="360" cy="245" rx="300" ry="195" fill="url(#cytoGrad)" stroke={C.accent} strokeWidth="2.5" />
      {/* Inner ellipse — membrane cellulaire */}
      <ellipse cx="360" cy="245" rx="275" ry="172" fill="none" stroke={C.accent2} strokeWidth="1.4" strokeDasharray="5 4" opacity="0.85" />

      {/* Nucleus */}
      <circle cx="360" cy="240" r="42" fill="url(#nucGrad)" stroke={C.accent} strokeWidth="1.5" />
      <circle cx="360" cy="240" r="42" fill="none" stroke="rgba(139,69,19,0.25)" strokeWidth="0.8" strokeDasharray="2 3" />

      {/* Vacuole */}
      <circle cx="235" cy="310" r="40" fill="url(#vacGrad)" stroke={C.accent} strokeWidth="1.4" />

      {/* Enzyme dots */}
      {enzymeDots.map((d, i) => (
        <circle key={i} cx={d[0]} cy={d[1]} r="3" fill={C.accent2} opacity="0.7" />
      ))}

      {/* Leader lines from edge zones */}
      <line x1="220" y1="100" x2="190" y2="75" stroke={C.accent} strokeWidth="1" strokeDasharray="3 3" />
      <line x1="510" y1="165" x2="560" y2="120" stroke={C.accent} strokeWidth="1" strokeDasharray="3 3" />

      {/* Drop zones */}
      {zones.map((z) => {
        const isPlaced = !!placed[z.id];
        const isShake = shakeZone === z.id;
        const isHover = hoverZone === z.id && !isPlaced && dragLabel;
        return (
          <DropZone
            key={z.id}
            zone={z}
            placed={placed[z.id]}
            shake={isShake}
            hover={isHover}
            onDragOver={(e) => onDragOver(e, z.id)}
            onDragLeave={() => onDragLeave(z.id)}
            onDrop={(e) => onDrop(e, z)}
          />
        );
      })}
    </svg>
  );
}

function DropZone({ zone, placed, shake, hover, onDragOver, onDragLeave, onDrop }) {
  const isPlaced = !!placed;
  // For dropzone events on SVG: use foreignObject so HTML drag events work reliably.
  const w = 130, h = 36;
  return (
    <g>
      {/* Visual zone circle */}
      <circle
        cx={zone.x}
        cy={zone.y}
        r={zone.r}
        fill={isPlaced ? "rgba(50,140,70,0.12)" : hover ? "rgba(212,168,83,0.22)" : "rgba(255,248,240,0.0)"}
        stroke={isPlaced ? "#2E8B57" : hover ? C.gold : C.accent}
        strokeWidth={isPlaced ? 2 : hover ? 2.2 : 1.6}
        strokeDasharray={isPlaced ? "none" : "4 4"}
        style={{
          transition: "fill 0.2s ease, stroke 0.2s ease",
          filter: hover ? "drop-shadow(0 0 8px rgba(212,168,83,0.6))" : "none",
        }}
      />

      {/* Zone number badge (only when empty) */}
      {!isPlaced && (
        <g>
          <circle cx={zone.x} cy={zone.y} r="11" fill={C.ivory} stroke={C.accent} strokeWidth="1" />
          <text
            x={zone.x}
            y={zone.y + 4}
            textAnchor="middle"
            fontFamily="Georgia, serif"
            fontSize="13"
            fill={C.ink}
            fontWeight="600"
          >
            {zone.id}
          </text>
        </g>
      )}

      {/* Placed label (foreignObject for nice text) */}
      {isPlaced && (
        <foreignObject
          x={zone.x - w / 2}
          y={zone.y - h / 2}
          width={w}
          height={h}
          style={{ overflow: "visible" }}
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              width: "100%",
              height: "100%",
              background: "#E8F5E9",
              border: "1.5px solid #2E8B57",
              borderRadius: 6,
              color: "#1B5E20",
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 12,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 6px rgba(46,139,87,0.35)",
              animation: "correctPop 0.4s ease both",
              padding: "0 6px",
              textAlign: "center",
              lineHeight: 1.1,
            }}
          >
            ✓ {placed}
          </div>
        </foreignObject>
      )}

      {/* Shake overlay (red flash) on wrong drop */}
      {shake && (
        <foreignObject
          x={zone.x - w / 2}
          y={zone.y - h / 2}
          width={w}
          height={h}
          style={{ overflow: "visible" }}
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            className="shake-wrong"
            style={{
              width: "100%",
              height: "100%",
              background: "#FFE5E5",
              border: "1.5px solid #CC0000",
              borderRadius: 6,
              color: "#8B0000",
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 12,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 8px rgba(204,0,0,0.4)",
            }}
          >
            ✕ erreur
          </div>
        </foreignObject>
      )}

      {/* Drop catcher — transparent rect covering zone */}
      <rect
        x={zone.x - zone.r}
        y={zone.y - zone.r}
        width={zone.r * 2}
        height={zone.r * 2}
        fill="transparent"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{ cursor: "pointer" }}
      />
    </g>
  );
}

/* ---------- Label chip (draggable) ---------- */
function LabelChip({ label, used, dragging, onDragStart, onDragEnd }) {
  return (
    <div
      draggable={!used}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={dragging ? "levure-dragging" : ""}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        background: used ? "#E8F5E9" : C.ivory,
        border: `1.5px solid ${used ? "#2E8B57" : C.accent}`,
        borderRadius: 8,
        cursor: used ? "default" : dragging ? "grabbing" : "grab",
        opacity: used ? 0.55 : dragging ? 0.55 : 1,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontWeight: 600,
        fontSize: 13,
        color: used ? "#1B5E20" : C.ink,
        boxShadow: dragging ? "0 14px 30px rgba(0,0,0,0.4), 0 4px 10px rgba(0,0,0,0.25)" : "0 2px 5px rgba(0,0,0,0.12)",
        userSelect: "none",
        transition: "opacity 0.15s ease, transform 0.15s ease",
        transform: dragging ? "scale(1.04)" : "scale(1)",
        textDecoration: used ? "line-through" : "none",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          color: "#a0764a",
          letterSpacing: -1,
          fontFamily: "ui-monospace, monospace",
          fontSize: 14,
        }}
      >
        ⠿
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {used && <span style={{ color: "#2E8B57", fontWeight: 700 }}>✓</span>}
    </div>
  );
}

/* ---------- Progress dots (compact, for puzzle screens) ---------- */
function ProgressDots({ active, resolved }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {[1, 2, 3, 4].map((i, idx) => {
        const isResolved = resolved.includes(i);
        const isActive = active === i;
        return (
          <React.Fragment key={i}>
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: isResolved ? C.gold : isActive ? "rgba(212,168,83,0.25)" : "transparent",
                border: `1.5px solid ${isResolved || isActive ? C.gold : C.ivoryDim}`,
                opacity: isResolved || isActive ? 1 : 0.55,
                boxShadow: isResolved ? "0 0 10px rgba(212,168,83,0.55)" : "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontFamily: "Georgia, serif",
                color: isResolved ? C.ink : C.ivoryDim,
                fontWeight: 700,
              }}
            >
              {i}
            </div>
            {idx < 3 && (
              <span
                style={{
                  width: 36,
                  borderTop: `1.5px dashed ${C.ivoryDim}`,
                  opacity: 0.45,
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ---------- Unlock overlay (animated padlock opening) ---------- */
function UnlockOverlay({ verrouNum }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(42,21,5,0.78)",
        backdropFilter: "blur(2px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        zIndex: 100,
        animation: "fadeIn 0.25s ease both",
      }}
    >
      <svg width="110" height="130" viewBox="0 0 110 130" aria-hidden="true">
        <g style={{ transformOrigin: "55px 50px", animation: "unlockArm 0.7s ease forwards" }}>
          <path
            d="M30 55 V35 a25 25 0 0 1 50 0 V55"
            stroke={C.gold}
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
          />
        </g>
        <rect x="20" y="55" width="70" height="60" rx="6" fill={C.gold} stroke={C.accent} strokeWidth="2" />
        <circle cx="55" cy="82" r="5" fill={C.ink} />
        <rect x="52" y="85" width="6" height="14" rx="2" fill={C.ink} />
      </svg>
      <style>{`
        @keyframes unlockArm {
          0% { transform: rotate(0deg) translate(0,0); }
          100% { transform: rotate(-35deg) translate(-6px,-2px); }
        }
      `}</style>
      <div
        style={{
          fontFamily: "Georgia, serif",
          color: C.gold,
          fontSize: 26,
          letterSpacing: 1,
        }}
      >
        Verrou {verrouNum} ouvert
      </div>
      <div
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          color: C.ivoryDim,
          fontSize: 13,
          opacity: 0.85,
        }}
      >
        Retour à l'établi…
      </div>
    </div>
  );
}

/* =========================================================================
 * ÉCRAN 4 — Verrou 2 : La chaîne de reproduction (séquençage)
 * ========================================================================= */

const BUDDING_STEPS = [
  { id: 1, text: "Cellule avec noyau + chromosomes" },
  { id: 2, text: "Apparition d'un bourgeon" },
  { id: 3, text: "Séparation en 2 noyaux distincts" },
  { id: 4, text: "Migration du noyau dans le bourgeon" },
  { id: 5, text: "Étranglement puis séparation" },
  { id: 6, text: "Deux cellules identiques" },
];

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Screen4Enigme2({ chrono, tentatives, onBack, onSuccess, onUpdateTentatives, onZero }) {
  // Pool : array of card IDs visible in upper zone (initial random shuffle).
  const [pool, setPool] = useState(() => shuffleArray([1, 2, 3, 4, 5, 6]));
  // Slots : 6-array of (cardId | null).
  const [slots, setSlots] = useState([null, null, null, null, null, null]);
  // Drag state.
  const [dragInfo, setDragInfo] = useState(null); // { cardId, from: 'pool' | slotIdx }
  const [hoverTarget, setHoverTarget] = useState(null); // 'pool' | slotIdx
  // Validation state : null | { results: [{slotIdx, cardId, correct, expected}] }
  const [validation, setValidation] = useState(null);
  const [unlocking, setUnlocking] = useState(false);
  const [shakeVer, setShakeVer] = useState(false);

  const cardById = (id) => BUDDING_STEPS.find((s) => s.id === id);
  const allFilled = slots.every((s) => s !== null);

  const handleDragStart = (e, cardId, from) => {
    setDragInfo({ cardId, from });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify({ cardId, from }));
    // Clear any active validation when user starts moving things again.
    if (validation) setValidation(null);
  };

  const handleDragEnd = () => {
    setDragInfo(null);
    setHoverTarget(null);
  };

  const readPayload = (e) => {
    try {
      const d = e.dataTransfer.getData("text/plain");
      return d ? JSON.parse(d) : dragInfo;
    } catch {
      return dragInfo;
    }
  };

  // Remove card from its current location.
  const removeFrom = (cardId, from, poolDraft, slotsDraft) => {
    if (from === "pool") {
      const idx = poolDraft.indexOf(cardId);
      if (idx > -1) poolDraft.splice(idx, 1);
    } else {
      slotsDraft[from] = null;
    }
  };

  const handleDropOnSlot = (e, targetIdx) => {
    e.preventDefault();
    setHoverTarget(null);
    const payload = readPayload(e);
    if (!payload) return;
    const { cardId, from } = payload;
    if (from === targetIdx) return;

    const poolDraft = [...pool];
    const slotsDraft = [...slots];

    const evictedCard = slotsDraft[targetIdx];
    removeFrom(cardId, from, poolDraft, slotsDraft);
    slotsDraft[targetIdx] = cardId;

    // If we displaced a card, put it where the dragged card came from.
    if (evictedCard) {
      if (from === "pool") {
        poolDraft.push(evictedCard);
      } else {
        slotsDraft[from] = evictedCard;
      }
    }

    setPool(poolDraft);
    setSlots(slotsDraft);
    setDragInfo(null);
  };

  const handleDropOnPool = (e) => {
    e.preventDefault();
    setHoverTarget(null);
    const payload = readPayload(e);
    if (!payload) return;
    const { cardId, from } = payload;
    if (from === "pool") return;

    const poolDraft = [...pool];
    const slotsDraft = [...slots];
    removeFrom(cardId, from, poolDraft, slotsDraft);
    poolDraft.push(cardId);
    setPool(poolDraft);
    setSlots(slotsDraft);
    setDragInfo(null);
  };

  const handleSubmit = () => {
    if (!allFilled || validation) return;
    const results = slots.map((cardId, i) => ({
      slotIdx: i,
      cardId,
      correct: cardId === i + 1,
      expected: cardId, // card id == expected slot (1-indexed)
    }));
    const allCorrect = results.every((r) => r.correct);
    setValidation({ results });

    if (allCorrect) {
      setTimeout(() => {
        setUnlocking(true);
        AudioEngine.playUnlock();
        setTimeout(() => onSuccess(), 1100);
      }, 700);
    } else {
      onUpdateTentatives(2, 1);
      // After 2.4s : return wrong cards to pool, keep correct ones in place.
      setTimeout(() => {
        const newSlots = slots.map((cardId, i) =>
          cardId === i + 1 ? cardId : null
        );
        const newPoolIds = slots
          .map((cardId, i) => (cardId !== null && cardId !== i + 1 ? cardId : null))
          .filter((x) => x !== null);
        setSlots(newSlots);
        setPool((p) => [...p, ...newPoolIds]);
        setValidation(null);
      }, 2400);
    }
  };

  const cardStateFor = (cardId, location) => {
    // location: 'pool' | slotIdx
    if (!validation) return "idle";
    if (location === "pool") return "idle";
    const r = validation.results.find((x) => x.slotIdx === location);
    return r && r.cardId === cardId ? (r.correct ? "correct" : "wrong") : "idle";
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        padding: "60px 24px 50px",
        animation: "screenFade 0.3s ease both",
      }}
    >
      <ScreenTag index={4} title="Énigme 2 · Bourgeonnement (séquençage)" />
      <ChronoTimer secondes={chrono} running={true} onZero={onZero} />

      <button
        onClick={onBack}
        style={{
          position: "absolute",
          top: 60,
          left: 90,
          background: C.ivory,
          color: C.ink,
          border: `1.5px solid ${C.accent}`,
          padding: "6px 12px",
          borderRadius: 8,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
          zIndex: 10,
        }}
      >
        ← Retour au hub
      </button>

      {/* Title */}
      <div style={{ maxWidth: 1100, margin: "42px auto 22px" }}>
        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontWeight: 400,
            fontSize: 30,
            color: C.ivory,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 26 }}>🧬</span>
          Verrou 2 — La chaîne de reproduction
        </h1>
        <p
          style={{
            marginTop: 6,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 14,
            color: C.ivoryDim,
            opacity: 0.85,
            maxWidth: 760,
          }}
        >
          Les fiches de procédure sont mélangées&nbsp;! Remettez les 6 étapes du
          bourgeonnement dans le bon ordre.
        </p>
      </div>

      {/* === Upper zone : pool of cards === */}
      <div style={{ maxWidth: 1100, margin: "0 auto 38px", position: "relative" }}>
        <div
          style={{
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            color: C.ivory,
            fontSize: 14,
            marginBottom: 10,
          }}
        >
          Cartes en vrac (drag) ↓
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setHoverTarget("pool");
          }}
          onDragLeave={() => setHoverTarget((h) => (h === "pool" ? null : h))}
          onDrop={handleDropOnPool}
          style={{
            background: "rgba(255,248,240,0.04)",
            border: `2px dashed ${hoverTarget === "pool" ? C.gold : C.accent}`,
            borderRadius: 12,
            padding: "18px 16px",
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: pool.length > 0 ? "flex-start" : "center",
            minHeight: 160,
            transition: "border-color 0.2s ease, background 0.2s ease",
            position: "relative",
          }}
        >
          {pool.length === 0 && (
            <div
              style={{
                fontFamily: "Georgia, serif",
                fontStyle: "italic",
                color: C.ivoryDim,
                opacity: 0.55,
                fontSize: 13,
                alignSelf: "center",
              }}
            >
              Toutes les cartes sont placées. Vérifiez l'ordre puis soumettez →
            </div>
          )}
          {pool.map((cardId) => (
            <BuddingCard
              key={cardId}
              card={cardById(cardId)}
              onDragStart={(e) => handleDragStart(e, cardId, "pool")}
              onDragEnd={handleDragEnd}
              dragging={dragInfo && dragInfo.cardId === cardId}
              state="idle"
            />
          ))}
        </div>
      </div>

      {/* === Lower zone : ordered slots === */}
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div
          style={{
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            color: C.ivory,
            fontSize: 14,
            marginBottom: 10,
          }}
        >
          Ordre attendu →
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 12,
          }}
        >
          {slots.map((cardId, idx) => (
            <SequenceSlot
              key={idx}
              idx={idx}
              card={cardId != null ? cardById(cardId) : null}
              state={cardId != null ? cardStateFor(cardId, idx) : "empty"}
              isHover={hoverTarget === idx && !!dragInfo}
              onDragOver={(e) => {
                e.preventDefault();
                setHoverTarget(idx);
              }}
              onDragLeave={() =>
                setHoverTarget((h) => (h === idx ? null : h))
              }
              onDrop={(e) => handleDropOnSlot(e, idx)}
              onCardDragStart={
                cardId != null
                  ? (e) => handleDragStart(e, cardId, idx)
                  : undefined
              }
              onCardDragEnd={handleDragEnd}
              dragging={dragInfo && dragInfo.cardId === cardId}
            />
          ))}
        </div>

        {/* Counter + submit */}
        <div
          style={{
            marginTop: 22,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: "Georgia, serif",
              fontStyle: "italic",
              color: C.ivoryDim,
              fontSize: 13,
            }}
          >
            Tentatives&nbsp;:{" "}
            <strong style={{ fontStyle: "normal", color: C.ivory }}>
              {tentatives[2] || 0}
            </strong>
          </span>

          <button
            onClick={() => {
              const valid = allFilled && !validation;
              if (!valid) {
                if (validation || shakeVer) return;
                setShakeVer(true);
                setTimeout(() => setShakeVer(false), 520);
                return;
              }
              handleSubmit();
            }}
            className={shakeVer ? "shake-btn no-lift" : ""}
            style={{
              padding: "11px 22px",
              background:
                allFilled && !validation
                  ? `linear-gradient(180deg, ${C.goldHi} 0%, ${C.gold} 100%)`
                  : "rgba(212,168,83,0.25)",
              color: allFilled && !validation ? C.ink : "rgba(255,248,240,0.55)",
              border: `1.5px solid ${
                allFilled && !validation ? C.accent : "rgba(139,69,19,0.4)"
              }`,
              borderRadius: 10,
              fontFamily: "Arial, Helvetica, sans-serif",
              fontWeight: 700,
              fontSize: 14,
              cursor: allFilled && !validation ? "pointer" : "not-allowed",
              boxShadow:
                allFilled && !validation
                  ? "0 8px 20px rgba(212,168,83,0.4)"
                  : "none",
              transition: "all 0.2s ease",
            }}
          >
            Soumettre l'ordre ✓
          </button>
        </div>

        {/* Bottom progress */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 32,
          }}
        >
          <ProgressDots active={2} resolved={[1]} />
        </div>
      </div>

      {unlocking && <UnlockOverlay verrouNum={2} />}
    </div>
  );
}

/* ---------- Budding stage illustrations (6 SVGs) ---------- */
function BuddingStageSVG({ stage, tint }) {
  const fill = "#FBEFD4";       // cell membrane fill
  const nucFill = "#E9C58A";    // nucleus fill
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 100 56"
      style={{ display: "block", maxHeight: 56 }}
      aria-hidden="true"
    >
      {stage === 1 && (
        <g>
          {/* Big cell with nucleus + chromosomes */}
          <ellipse cx="50" cy="28" rx="26" ry="20" fill={fill} stroke={tint} strokeWidth="1.4" />
          <circle cx="50" cy="28" r="10" fill={nucFill} stroke={tint} strokeWidth="1" />
          {/* Chromosomes — X shapes inside nucleus */}
          <g stroke={tint} strokeWidth="1.3" strokeLinecap="round">
            <line x1="46" y1="24" x2="50" y2="28" />
            <line x1="50" y1="24" x2="46" y2="28" />
            <line x1="52" y1="29" x2="56" y2="33" />
            <line x1="56" y1="29" x2="52" y2="33" />
            <line x1="44" y1="32" x2="48" y2="32" />
          </g>
        </g>
      )}
      {stage === 2 && (
        <g>
          {/* Main cell */}
          <ellipse cx="42" cy="32" rx="22" ry="18" fill={fill} stroke={tint} strokeWidth="1.4" />
          <circle cx="42" cy="32" r="6" fill={nucFill} stroke={tint} strokeWidth="0.9" />
          {/* Small bud emerging top-right */}
          <circle cx="68" cy="20" r="7" fill={fill} stroke={tint} strokeWidth="1.4" />
          <path d="M58 24 Q62 20 64 19" stroke={tint} strokeWidth="1" fill="none" opacity="0.5" />
          {/* Arrow */}
          <path d="M76 16 L82 12" stroke={tint} strokeWidth="1.2" strokeLinecap="round" />
          <path d="M82 12 L79 12 L82 12 L82 15" stroke={tint} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </g>
      )}
      {stage === 3 && (
        <g>
          {/* Main cell with two distinct nuclei */}
          <ellipse cx="42" cy="32" rx="22" ry="18" fill={fill} stroke={tint} strokeWidth="1.4" />
          <circle cx="34" cy="32" r="6" fill={nucFill} stroke={tint} strokeWidth="0.9" />
          {/* Division indicator between nuclei */}
          <line x1="42" y1="26" x2="42" y2="38" stroke={tint} strokeWidth="0.8" strokeDasharray="2 2" opacity="0.6" />
          <circle cx="50" cy="32" r="6" fill={nucFill} stroke={tint} strokeWidth="0.9" />
          {/* Bud (still small, empty) */}
          <circle cx="74" cy="20" r="8" fill={fill} stroke={tint} strokeWidth="1.4" />
        </g>
      )}
      {stage === 4 && (
        <g>
          {/* Main cell with one nucleus */}
          <ellipse cx="38" cy="32" rx="20" ry="17" fill={fill} stroke={tint} strokeWidth="1.4" />
          <circle cx="33" cy="32" r="6" fill={nucFill} stroke={tint} strokeWidth="0.9" />
          {/* Bud now contains a migrating nucleus */}
          <circle cx="74" cy="22" r="10" fill={fill} stroke={tint} strokeWidth="1.4" />
          <circle cx="74" cy="22" r="4.5" fill={nucFill} stroke={tint} strokeWidth="0.9" />
          {/* Migration arrow */}
          <path d="M48 30 Q58 24 64 22" stroke={tint} strokeWidth="1.2" fill="none" strokeDasharray="2 2" />
          <path d="M62 19 L66 22 L62 25" stroke={tint} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </g>
      )}
      {stage === 5 && (
        <g>
          {/* Two cells with narrow neck between them */}
          <ellipse cx="32" cy="32" rx="18" ry="16" fill={fill} stroke={tint} strokeWidth="1.4" />
          <circle cx="30" cy="32" r="5" fill={nucFill} stroke={tint} strokeWidth="0.9" />
          {/* Pinch / neck */}
          <path
            d="M48 28 Q52 31 56 28 L56 36 Q52 33 48 36 Z"
            fill={fill}
            stroke={tint}
            strokeWidth="1.4"
          />
          {/* Scissors hint marks above/below neck */}
          <path d="M52 24 L52 19" stroke={tint} strokeWidth="0.8" strokeDasharray="1.5 1.5" />
          <path d="M52 40 L52 45" stroke={tint} strokeWidth="0.8" strokeDasharray="1.5 1.5" />
          <ellipse cx="72" cy="32" rx="14" ry="13" fill={fill} stroke={tint} strokeWidth="1.4" />
          <circle cx="72" cy="32" r="4.5" fill={nucFill} stroke={tint} strokeWidth="0.9" />
        </g>
      )}
      {stage === 6 && (
        <g>
          {/* Two identical, fully separated cells */}
          <ellipse cx="30" cy="32" rx="16" ry="14" fill={fill} stroke={tint} strokeWidth="1.4" />
          <circle cx="30" cy="32" r="5" fill={nucFill} stroke={tint} strokeWidth="0.9" />
          <ellipse cx="70" cy="32" rx="16" ry="14" fill={fill} stroke={tint} strokeWidth="1.4" />
          <circle cx="70" cy="32" r="5" fill={nucFill} stroke={tint} strokeWidth="0.9" />
          {/* Equals/separation hint */}
          <line x1="48" y1="30" x2="52" y2="30" stroke={tint} strokeWidth="1" />
          <line x1="48" y1="34" x2="52" y2="34" stroke={tint} strokeWidth="1" />
        </g>
      )}
    </svg>
  );
}

/* ---------- Budding step card ---------- */
function BuddingCard({ card, onDragStart, onDragEnd, dragging, state, inSlot }) {
  const colorByState = {
    idle: { bg: C.ivory, border: C.accent, text: C.ink },
    correct: { bg: "#E8F5E9", border: "#2E8B57", text: "#1B5E20" },
    wrong:   { bg: "#FFE5E5", border: C.red,    text: C.redDeep },
  };
  const colors = colorByState[state] || colorByState.idle;
  return (
    <div
      draggable={state !== "correct"}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={dragging ? "levure-dragging" : ""}
      style={{
        width: inSlot ? "100%" : 150,
        minHeight: inSlot ? 132 : 132,
        background: colors.bg,
        border: `1.8px solid ${colors.border}`,
        borderRadius: 8,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        cursor: state === "correct" ? "default" : dragging ? "grabbing" : "grab",
        opacity: dragging ? 0.55 : 1,
        boxShadow:
          dragging
            ? "0 16px 32px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.25)"
            : state === "idle"
              ? "0 4px 10px rgba(0,0,0,0.18)"
              : state === "correct"
                ? "0 4px 10px rgba(46,139,87,0.3)"
                : "0 4px 10px rgba(204,0,0,0.3)",
        userSelect: "none",
        position: "relative",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        transform: dragging ? "scale(1.04)" : "scale(1)",
        animation: state === "wrong" ? "shakeWrong 0.55s ease-in-out" : "none",
      }}
    >
      {/* SVG illustration of this budding stage */}
      <div
        style={{
          background: "#FFFCF4",
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 4,
        }}
      >
        <BuddingStageSVG stage={card.id} tint={colors.border} stateColor={colors.text} />
      </div>

      {/* Caption */}
      <div
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 11.5,
          fontWeight: 600,
          color: colors.text,
          lineHeight: 1.3,
          flex: 1,
          textWrap: "pretty",
        }}
      >
        {card.text}
      </div>

      {/* State badge */}
      {state === "correct" && (
        <div
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            background: "#2E8B57",
            color: "#FFF",
            width: 20,
            height: 20,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
          }}
        >
          ✓
        </div>
      )}
      {state === "wrong" && (
        <div
          style={{
            position: "absolute",
            top: -10,
            right: -10,
            background: C.red,
            color: "#FFF",
            padding: "3px 7px",
            borderRadius: 10,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 10,
            fontWeight: 700,
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
            whiteSpace: "nowrap",
          }}
        >
          → slot {card.id}
        </div>
      )}
    </div>
  );
}

/* ---------- Sequence slot ---------- */
function SequenceSlot({
  idx, card, state, isHover,
  onDragOver, onDragLeave, onDrop,
  onCardDragStart, onCardDragEnd, dragging,
}) {
  const isCorrect = state === "correct";
  const isWrong = state === "wrong";
  const isEmpty = !card;

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        position: "relative",
        borderRadius: 10,
        minHeight: 152,
        padding: 6,
        background: isCorrect
          ? "rgba(46,139,87,0.10)"
          : isWrong
            ? "rgba(204,0,0,0.08)"
            : isHover
              ? "rgba(212,168,83,0.10)"
              : "rgba(255,248,240,0.03)",
        border: `2px dashed ${
          isCorrect
            ? "#2E8B57"
            : isWrong
              ? C.red
              : isHover
                ? C.gold
                : C.accent
        }`,
        transition: "all 0.2s ease",
        boxShadow: isHover ? "0 0 0 3px rgba(212,168,83,0.18)" : "none",
      }}
    >
      {/* Slot number badge top-left */}
      <div
        style={{
          position: "absolute",
          top: -10,
          left: 8,
          background: C.bg,
          padding: "2px 8px",
          fontFamily: "Georgia, serif",
          fontSize: 13,
          color: isCorrect ? "#2E8B57" : isWrong ? C.red : C.gold,
          border: `1.5px solid ${isCorrect ? "#2E8B57" : isWrong ? C.red : C.gold}`,
          borderRadius: 999,
          fontWeight: 700,
          lineHeight: 1.2,
          minWidth: 20,
          textAlign: "center",
        }}
      >
        {idx + 1}
      </div>

      {isEmpty ? (
        <div
          style={{
            height: "100%",
            minHeight: 140,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            color: C.ivoryDim,
            opacity: 0.55,
            fontFamily: "Georgia, serif",
          }}
        >
          <div
            style={{
              fontSize: 36,
              fontFamily: "Georgia, serif",
              color: C.ivoryDim,
              opacity: 0.5,
              lineHeight: 1,
            }}
          >
            {idx + 1}
          </div>
          <div style={{ fontStyle: "italic", fontSize: 11.5 }}>déposer ici</div>
        </div>
      ) : (
        <BuddingCard
          card={card}
          state={state}
          inSlot={true}
          dragging={dragging}
          onDragStart={onCardDragStart}
          onDragEnd={onCardDragEnd}
        />
      )}
    </div>
  );
}

/* =========================================================================
 * ÉCRAN 5 — Verrou 3 : La salle des levures (association par fils)
 * ========================================================================= */

const YEAST_DESCRIPTIONS = [
  { id: "A", text: "Peut être utilisée pour tous les types de production" },
  { id: "B", text: "Obtenue par lyophilisation" },
  { id: "C", text: "Permet des pesages très précis (machine auto.)" },
  { id: "D", text: "Utilisée comme adjuvant" },
  { id: "E", text: "Mêmes vertus que la levure pressée" },
];
const YEAST_NAMES = [
  { id: "a", name: "Levure émiettée" },
  { id: "b", name: "Levure sèche active" },
  { id: "c", name: "Levure liquide" },
  { id: "d", name: "Levure désactivée" },
  { id: "e", name: "Levure surgelée" },
];
const YEAST_CORRECT = { A: "a", B: "b", C: "c", D: "d", E: "e" };

function Screen5Enigme3({ chrono, tentatives, onBack, onSuccess, onUpdateTentatives, onZero }) {
  // Shuffle right-column display order once.
  const rightOrder = useMemo(
    () => shuffleArray(YEAST_NAMES.map((y) => y.id)),
    []
  );

  const [links, setLinks] = useState([]);           // [{left:'A', right:'a'}, ...]
  const [selection, setSelection] = useState(null); // {side:'left'|'right', id} | null
  const [validation, setValidation] = useState(null); // null | {results:[...]}
  const [unlocking, setUnlocking] = useState(false);
  const [shakeVer, setShakeVer] = useState(false);

  // Fixed pixel layout for crisp line math.
  const ROW_H = 62;
  const ROW_GAP = 14;
  const COL_W = 340;
  const MID_W = 240;
  const PANEL_PAD_X = 24;
  const PANEL_PAD_Y = 26;
  const PANEL_W = COL_W * 2 + MID_W + PANEL_PAD_X * 2;
  const PANEL_H = 5 * ROW_H + 4 * ROW_GAP + PANEL_PAD_Y * 2;

  // Connector positions (in panel-local coords).
  const leftConnX = PANEL_PAD_X + COL_W;
  const rightConnX = PANEL_PAD_X + COL_W + MID_W;
  const rowY = (i) => PANEL_PAD_Y + i * (ROW_H + ROW_GAP) + ROW_H / 2;

  const leftRowIdxOf = (id) => YEAST_DESCRIPTIONS.findIndex((d) => d.id === id);
  const rightRowIdxOf = (id) => rightOrder.indexOf(id);

  const leftHasLink  = (id) => links.find((l) => l.left === id);
  const rightHasLink = (id) => links.find((l) => l.right === id);

  const handleConnectorClick = (side, id) => {
    if (validation || unlocking) return;
    const existing = side === "left" ? leftHasLink(id) : rightHasLink(id);
    if (existing) {
      setLinks(links.filter((l) => l !== existing));
      setSelection(null);
      return;
    }
    if (selection && selection.side !== side) {
      const left = side === "left" ? id : selection.id;
      const right = side === "right" ? id : selection.id;
      const filtered = links.filter((l) => l.left !== left && l.right !== right);
      setLinks([...filtered, { left, right }]);
      setSelection(null);
      return;
    }
    if (selection && selection.side === side && selection.id === id) {
      setSelection(null);
      return;
    }
    setSelection({ side, id });
  };

  const handleVerify = () => {
    if (links.length !== 5 || validation) return;
    const results = links.map((l) => ({
      ...l,
      correct: YEAST_CORRECT[l.left] === l.right,
    }));
    const allCorrect = results.every((r) => r.correct);
    setValidation({ results });

            AudioEngine.playValidation();
if (allCorrect) {
      setTimeout(() => {
        setUnlocking(true);
        AudioEngine.playUnlock();
        setTimeout(() => onSuccess(), 1100);
      }, 800);
    } else {
      onUpdateTentatives(3, 1);
      setTimeout(() => {
        const correctLinks = results
          .filter((r) => r.correct)
          .map(({ correct, ...rest }) => rest);
        setLinks(correctLinks);
        setValidation(null);
      }, 2400);
    }
  };

  const linkVerdict = (link) => {
    if (!validation) return null;
    const r = validation.results.find(
      (x) => x.left === link.left && x.right === link.right
    );
    return r ? r.correct : null;
  };

  const linkStrokeColor = (link) => {
    const v = linkVerdict(link);
    if (v === true) return "#2E8B57";
    if (v === false) return C.red;
    return C.gold;
  };

  const pathBetween = (x1, y1, x2, y2) => {
    const dx = (x2 - x1) * 0.55;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  // Row highlight if connector or row is part of selection / hovered link.
  const leftRowState = (id) => {
    if (validation) {
      const link = leftHasLink(id);
      if (link) {
        const v = linkVerdict(link);
        if (v === true) return "correct";
        if (v === false) return "wrong";
      }
    }
    if (selection && selection.side === "left" && selection.id === id) return "selected";
    if (leftHasLink(id)) return "linked";
    return "idle";
  };
  const rightRowState = (id) => {
    if (validation) {
      const link = rightHasLink(id);
      if (link) {
        const v = linkVerdict(link);
        if (v === true) return "correct";
        if (v === false) return "wrong";
      }
    }
    if (selection && selection.side === "right" && selection.id === id) return "selected";
    if (rightHasLink(id)) return "linked";
    return "idle";
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        padding: "60px 24px 50px",
        animation: "screenFade 0.3s ease both",
      }}
    >
      <ScreenTag index={5} title="Énigme 3 · Association types de levures" />
      <ChronoTimer secondes={chrono} running={true} onZero={onZero} />

      <button
        onClick={onBack}
        style={{
          position: "absolute",
          top: 60,
          left: 90,
          background: C.ivory,
          color: C.ink,
          border: `1.5px solid ${C.accent}`,
          padding: "6px 12px",
          borderRadius: 8,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
          zIndex: 10,
        }}
      >
        ← Retour au hub
      </button>

      {/* Title */}
      <div style={{ maxWidth: 1100, margin: "42px auto 22px" }}>
        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontWeight: 400,
            fontSize: 30,
            color: C.ivory,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 24 }}>🏷️</span>
          Verrou 3 — La salle des levures
        </h1>
        <p
          style={{
            marginTop: 6,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 14,
            color: C.ivoryDim,
            opacity: 0.85,
            maxWidth: 760,
          }}
        >
          Les bocaux sont déclassés&nbsp;! Reliez chaque description à la bonne
          levure (clic gauche puis clic droite).
        </p>
      </div>

      {/* Panel */}
      <div
        style={{
          width: PANEL_W,
          maxWidth: "100%",
          margin: "0 auto",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "relative",
            width: PANEL_W,
            height: PANEL_H,
            background: C.ivory,
            border: `2px solid ${C.accent}`,
            borderRadius: 14,
            boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
          }}
        >
          {/* Left column */}
          {YEAST_DESCRIPTIONS.map((d, i) => (
            <AssocRow
              key={d.id}
              side="left"
              text={d.text}
              state={leftRowState(d.id)}
              x={PANEL_PAD_X}
              y={PANEL_PAD_Y + i * (ROW_H + ROW_GAP)}
              w={COL_W}
              h={ROW_H}
              connX={leftConnX}
              connY={rowY(i)}
              onConnectorClick={() => handleConnectorClick("left", d.id)}
            />
          ))}

          {/* Right column */}
          {rightOrder.map((yid, i) => {
            const yeast = YEAST_NAMES.find((y) => y.id === yid);
            return (
              <AssocRow
                key={yid}
                side="right"
                text={yeast.name}
                state={rightRowState(yid)}
                x={PANEL_PAD_X + COL_W + MID_W}
                y={PANEL_PAD_Y + i * (ROW_H + ROW_GAP)}
                w={COL_W}
                h={ROW_H}
                connX={rightConnX}
                connY={rowY(i)}
                onConnectorClick={() => handleConnectorClick("right", yid)}
              />
            );
          })}

          {/* SVG overlay for the wires */}
          <svg
            width={PANEL_W}
            height={PANEL_H}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
          >
            {/* Drawn links */}
            {links.map((l, i) => {
              const li = leftRowIdxOf(l.left);
              const ri = rightRowIdxOf(l.right);
              const stroke = linkStrokeColor(l);
              const v = linkVerdict(l);
              return (
                <g key={`${l.left}-${l.right}`}>
                  <path
                    d={pathBetween(leftConnX, rowY(li), rightConnX, rowY(ri))}
                    stroke={stroke}
                    strokeWidth={v === false ? 2.4 : 2.2}
                    fill="none"
                    strokeLinecap="round"
                    style={{
                      filter:
                        v === true
                          ? "drop-shadow(0 0 4px rgba(46,139,87,0.55))"
                          : v === false
                            ? "drop-shadow(0 0 4px rgba(204,0,0,0.55))"
                            : "drop-shadow(0 0 3px rgba(212,168,83,0.45))",
                    }}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        {/* Footer counter + verify */}
        <div
          style={{
            marginTop: 20,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: "Georgia, serif",
              fontStyle: "italic",
              color: C.ivoryDim,
              fontSize: 13,
            }}
          >
            Fils&nbsp;: <strong style={{ fontStyle: "normal", color: C.ivory }}>{links.length}</strong>/5
            &nbsp; · &nbsp;
            Tentatives&nbsp;:{" "}
            <strong style={{ fontStyle: "normal", color: C.ivory }}>
              {tentatives[3] || 0}
            </strong>
          </span>

          <button
            onClick={handleVerify}
            disabled={links.length !== 5 || !!validation}
            style={{
              padding: "11px 22px",
              background:
                links.length === 5 && !validation
                  ? `linear-gradient(180deg, ${C.goldHi} 0%, ${C.gold} 100%)`
                  : "rgba(212,168,83,0.25)",
              color:
                links.length === 5 && !validation
                  ? C.ink
                  : "rgba(255,248,240,0.55)",
              border: `1.5px solid ${
                links.length === 5 && !validation
                  ? C.accent
                  : "rgba(139,69,19,0.4)"
              }`,
              borderRadius: 999,
              fontFamily: "Arial, Helvetica, sans-serif",
              fontWeight: 700,
              fontSize: 14,
              cursor:
                links.length === 5 && !validation ? "pointer" : "not-allowed",
              boxShadow:
                links.length === 5 && !validation
                  ? "0 8px 20px rgba(212,168,83,0.4)"
                  : "none",
              transition: "all 0.2s ease",
            }}
          >
            Vérifier ✓
          </button>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 28,
          }}
        >
          <ProgressDots active={3} resolved={[1, 2]} />
        </div>
      </div>

      {unlocking && <UnlockOverlay verrouNum={3} />}
    </div>
  );
}

/* ---------- AssocRow : description or yeast name with connector ---------- */
function AssocRow({ side, text, state, x, y, w, h, connX, connY, onConnectorClick }) {
  const palette = {
    idle:     { bg: C.ivory,    border: C.accent,      text: C.ink,     ring: C.accent },
    linked:   { bg: "#FFF1D8", border: C.gold,        text: C.ink,     ring: C.gold },
    selected: { bg: "#FFE9B8", border: C.gold,        text: C.ink,     ring: C.gold },
    correct:  { bg: "#E8F5E9", border: "#2E8B57",     text: "#1B5E20", ring: "#2E8B57" },
    wrong:    { bg: "#FFE5E5", border: C.red,         text: C.redDeep, ring: C.red },
  };
  const p = palette[state] || palette.idle;

  return (
    <>
      {/* Row card */}
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: w,
          height: h,
          background: p.bg,
          border: `1.6px solid ${p.border}`,
          borderRadius: 8,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: side === "left" ? "flex-start" : "flex-end",
          fontFamily: side === "left" ? "Arial, Helvetica, sans-serif" : "Georgia, serif",
          fontStyle: side === "right" ? "italic" : "normal",
          fontSize: 13,
          fontWeight: side === "left" ? 500 : 400,
          color: p.text,
          boxShadow:
            state === "selected"
              ? "0 0 0 3px rgba(212,168,83,0.3), 0 6px 14px rgba(0,0,0,0.15)"
              : "0 3px 8px rgba(0,0,0,0.1)",
          transition: "all 0.2s ease",
          textAlign: side === "left" ? "left" : "right",
          lineHeight: 1.25,
        }}
      >
        {text}
      </div>

      {/* Connector (positioned absolutely on the panel) */}
      <button
        onClick={onConnectorClick}
        aria-label={`Connecteur ${side === "left" ? "droite" : "gauche"} — ${text}`}
        style={{
          position: "absolute",
          left: connX - 9,
          top: connY - 9,
          width: 18,
          height: 18,
          background:
            state === "selected"
              ? C.gold
              : state === "linked"
                ? C.gold
                : state === "correct"
                  ? "#2E8B57"
                  : state === "wrong"
                    ? C.red
                    : C.ivory,
          border: `2px solid ${p.ring}`,
          borderRadius: "50%",
          padding: 0,
          cursor: "pointer",
          boxShadow:
            state === "selected"
              ? "0 0 0 5px rgba(212,168,83,0.3)"
              : state === "linked" || state === "correct" || state === "wrong"
                ? "0 0 0 2px rgba(255,255,255,0.6)"
                : "0 2px 4px rgba(0,0,0,0.2)",
          zIndex: 5,
          animation: state === "selected" ? "zonePulse 1.2s ease-in-out infinite" : "none",
          transition: "all 0.15s ease",
        }}
      />
    </>
  );
}

/* =========================================================================
 * ÉCRAN 6 — Verrou 4 : La balance de précision (calcul)
 * ========================================================================= */

const BALANCE_VARIANTS = {
  1: {
    farineKg: 2.5,
    farineLabel: "2,5 kg",
    answer: 50,
    question:
      "La recette utilise 2,5 kg de farine. Quelle dose de levure pressée faut-il peser ?",
  },
  2: {
    farineKg: 0.8,
    farineLabel: "800 g",
    answer: 16,
    question:
      "Pour une brioche festive, le chef utilise 800 g de farine. Quelle quantité de levure ?",
  },
  3: {
    farineKg: 3.0,
    farineLabel: "3 kg",
    answer: 60,
    question:
      "La boulangère prépare 3 kg de farine. Combien de grammes de levure ?",
  },
};
const BALANCE_TOLERANCE = 2;

function Screen6Enigme4({
  chrono, tentatives, variante, onBack, onSuccess, onUpdateTentatives, onZero,
}) {
  const cfg = BALANCE_VARIANTS[variante] || BALANCE_VARIANTS[1];
  const [value, setValue] = useState("");
  const [feedback, setFeedback] = useState(null); // null | 'low' | 'high' | 'ok'
  const [pesages, setPesages] = useState(0); // local attempt count
  const [unlocking, setUnlocking] = useState(false);
  const [confetti, setConfetti] = useState(false);

  const handlePeser = () => {
    if (feedback === "ok" || unlocking) return;
    const n = parseFloat(value);
    if (Number.isNaN(n)) {
      setFeedback("low"); // treat empty/invalid as too low so balance tilts left
      return;
    }
    const diff = n - cfg.answer;
    if (Math.abs(diff) <= BALANCE_TOLERANCE) {
      setFeedback("ok");
      setConfetti(true);
      setTimeout(() => {
        setUnlocking(true);
        AudioEngine.playUnlock();
        setTimeout(() => onSuccess(), 1100);
      }, 1300);
    } else {
      setFeedback(diff < 0 ? "low" : "high");
      onUpdateTentatives(4, 1);
      setPesages((p) => p + 1);
      // Clear tilt after a moment so user can try again.
      setTimeout(() => setFeedback(null), 1800);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter") handlePeser();
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        padding: "60px 24px 50px",
        animation: "screenFade 0.3s ease both",
      }}
    >
      <ScreenTag index={6} title="Énigme 4 · Dosage de la levure" />
      <ChronoTimer secondes={chrono} running={true} onZero={onZero} />

      <button
        onClick={onBack}
        style={{
          position: "absolute",
          top: 60,
          left: 90,
          background: C.ivory,
          color: C.ink,
          border: `1.5px solid ${C.accent}`,
          padding: "6px 12px",
          borderRadius: 8,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
          zIndex: 10,
        }}
      >
        ← Retour au hub
      </button>

      {/* Title */}
      <div style={{ maxWidth: 1100, margin: "42px auto 22px" }}>
        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontWeight: 400,
            fontSize: 30,
            color: C.ivory,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 26 }}>⚖️</span>
          Verrou 4 — La balance de précision
        </h1>
        <p
          style={{
            marginTop: 6,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 14,
            color: C.ivoryDim,
            opacity: 0.85,
            maxWidth: 760,
          }}
        >
          La recette du chef est urgente&nbsp;! Calculez la bonne dose de
          levure pressée avant que le four ne refroidisse.
        </p>
      </div>

      {/* Two columns */}
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)",
          gap: 24,
          alignItems: "stretch",
        }}
      >
        {/* Left: chef's notebook */}
        <NotebookCard cfg={cfg} />

        {/* Right: balance panel */}
        <div
          style={{
            position: "relative",
            background: C.ivory,
            border: `2px solid ${C.accent}`,
            borderRadius: 12,
            padding: "22px 24px 28px",
            boxShadow: "0 16px 36px rgba(0,0,0,0.45)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <BalanceSVG state={feedback} />

          {/* Input + button */}
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              gap: 10,
              marginTop: 18,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: "#FFFCF4",
                border: `1.6px solid ${
                  feedback === "ok"
                    ? "#2E8B57"
                    : feedback === "low" || feedback === "high"
                      ? C.red
                      : C.accent
                }`,
                borderRadius: 10,
                overflow: "hidden",
                boxShadow: "inset 0 1px 3px rgba(0,0,0,0.08)",
                transition: "border-color 0.25s ease",
              }}
            >
              <input
                type="number"
                inputMode="decimal"
                step="1"
                min="0"
                value={value}
                placeholder="0"
                onChange={(e) => {
                  setValue(e.target.value);
                  if (feedback) setFeedback(null);
                }}
                onKeyDown={handleKey}
                disabled={feedback === "ok"}
                style={{
                  width: 110,
                  padding: "12px 16px",
                  fontFamily: "Georgia, serif",
                  fontSize: 28,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: C.ink,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  textAlign: "center",
                }}
                aria-label="Dose de levure en grammes"
              />
              <div
                style={{
                  padding: "0 14px",
                  borderLeft: `1.5px solid ${C.accent}`,
                  display: "flex",
                  alignItems: "center",
                  fontFamily: "Georgia, serif",
                  fontSize: 18,
                  color: "#7a5024",
                  background: "rgba(212,168,83,0.08)",
                }}
              >
                g
              </div>
            </div>

            <button
              onClick={handlePeser}
              disabled={feedback === "ok"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "0 22px",
                background:
                  feedback === "ok"
                    ? "#2E8B57"
                    : `linear-gradient(180deg, ${C.goldHi} 0%, ${C.gold} 100%)`,
                color: feedback === "ok" ? "#FFF" : C.ink,
                border: `1.5px solid ${
                  feedback === "ok" ? "#1B5E20" : C.accent
                }`,
                borderRadius: 999,
                fontFamily: "Arial, Helvetica, sans-serif",
                fontWeight: 700,
                fontSize: 15,
                cursor: feedback === "ok" ? "default" : "pointer",
                boxShadow:
                  feedback === "ok"
                    ? "0 8px 20px rgba(46,139,87,0.4)"
                    : "0 8px 20px rgba(212,168,83,0.4)",
                transition: "all 0.2s ease",
              }}
            >
              {feedback === "ok" ? "Équilibré ✓" : (
                <>Peser <span aria-hidden="true">🏋</span></>
              )}
            </button>
          </div>

          {/* Tolerance hint */}
          <p
            style={{
              fontFamily: "Georgia, serif",
              fontStyle: "italic",
              fontSize: 12,
              color: "#7a5024",
              marginTop: 10,
              opacity: 0.85,
            }}
          >
            Tolérance ±2&nbsp;g acceptée
          </p>

          {/* Feedback message */}
          <div
            style={{
              minHeight: 22,
              marginTop: 8,
              fontFamily: "Georgia, serif",
              fontStyle: "italic",
              fontWeight: 600,
              fontSize: 14,
              color:
                feedback === "ok"
                  ? "#1B5E20"
                  : feedback
                    ? C.red
                    : "transparent",
              transition: "color 0.2s ease",
            }}
          >
            {feedback === "ok"
              ? "Pesée exacte — verrou en cours d'ouverture…"
              : feedback === "low"
                ? "Recalculez ! Trop léger."
                : feedback === "high"
                  ? "Recalculez ! Trop lourd."
                  : "—"}
          </div>

          {/* Counter */}
          <div
            style={{
              marginTop: 12,
              fontFamily: "Georgia, serif",
              fontStyle: "italic",
              color: "#7a5024",
              fontSize: 12,
              opacity: 0.75,
            }}
          >
            Pesées&nbsp;: {pesages} · Tentatives totales sur le verrou :{" "}
            {tentatives[4] || 0}
          </div>
        </div>
      </div>

      {/* Bottom progress */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: 30,
        }}
      >
        <ProgressDots active={4} resolved={[1, 2, 3]} />
      </div>

      {confetti && <FlourConfetti />}
      {unlocking && <UnlockOverlay verrouNum={4} />}
    </div>
  );
}

/* ---------- NotebookCard ---------- */
function NotebookCard({ cfg }) {
  // Highlight the flour quantity inline.
  const renderQuestion = () => {
    const parts = cfg.question.split(cfg.farineLabel);
    if (parts.length < 2) return cfg.question;
    return (
      <>
        {parts[0]}
        <span
          style={{
            background: "rgba(212,168,83,0.35)",
            padding: "1px 6px",
            borderRadius: 4,
            fontWeight: 700,
            fontStyle: "normal",
            color: C.ink,
          }}
        >
          {cfg.farineLabel}
        </span>
        {parts[1]}
      </>
    );
  };

  return (
    <div
      style={{
        position: "relative",
        background: "#FBF3DC",
        border: `2px solid ${C.accent}`,
        borderRadius: 12,
        padding: "22px 26px 26px",
        boxShadow: "0 16px 36px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.5)",
        backgroundImage:
          "repeating-linear-gradient(to bottom, transparent 0 28px, rgba(139,69,19,0.07) 28px 29px)",
      }}
    >
      {/* Red margin line */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 24,
          top: 18,
          bottom: 18,
          width: 1.5,
          background: "rgba(204,0,0,0.25)",
        }}
      />
      <div style={{ paddingLeft: 14 }}>
        <h3
          style={{
            fontFamily: "Georgia, serif",
            fontWeight: 400,
            fontSize: 18,
            color: C.ink,
            marginBottom: 16,
            paddingBottom: 6,
            borderBottom: `1px dashed ${C.accent}`,
          }}
        >
          Carnet du chef
        </h3>

        <p
          style={{
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            fontSize: 17,
            lineHeight: 1.8,
            color: "#3a2407",
            marginBottom: 22,
            textWrap: "pretty",
          }}
        >
          «&nbsp;{renderQuestion()}&nbsp;»
        </p>

        {/* Rappel callout */}
        <div
          style={{
            background: "#FFE9A1",
            border: `1.4px solid #C39A3F`,
            borderLeft: `4px solid ${C.gold}`,
            padding: "10px 14px",
            borderRadius: 6,
            fontFamily: "Georgia, serif",
            fontSize: 13.5,
            color: "#4a3309",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ fontWeight: 700 }}>Rappel&nbsp;:</strong>{" "}
          20&nbsp;g de levure pressée par kg de farine.
        </div>

        <p
          style={{
            marginTop: 20,
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            fontSize: 11.5,
            color: "#7a5024",
            opacity: 0.7,
          }}
        >
          3 variantes tirées aléatoirement (50&nbsp;g / 16&nbsp;g / 60&nbsp;g)
        </p>
      </div>
    </div>
  );
}

/* ---------- BalanceSVG ---------- */
function BalanceSVG({ state }) {
  // state : null | 'low' | 'high' | 'ok'
  const tilt =
    state === "low" ? -10 : state === "high" ? 10 : 0;
  const beamAnimation =
    state === "ok" ? "beamWobble 1.2s ease-in-out 2" : "none";

  return (
    <svg
      viewBox="0 0 460 240"
      width="100%"
      style={{
        display: "block",
        maxWidth: 460,
        background:
          "repeating-linear-gradient(135deg, rgba(139,69,19,0.06) 0 4px, rgba(255,248,240,0) 4px 12px)",
        border: `1.5px solid ${C.accent}`,
        borderRadius: 10,
        padding: 8,
      }}
      aria-label="Balance de cuisine ancienne"
    >
      <defs>
        <linearGradient id="brassGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E9BE6A" />
          <stop offset="60%" stopColor="#C68A3D" />
          <stop offset="100%" stopColor="#8B5A1F" />
        </linearGradient>
        <linearGradient id="woodGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9B5B22" />
          <stop offset="100%" stopColor="#5B2E0A" />
        </linearGradient>
      </defs>

      {/* Base / pied */}
      <ellipse cx="230" cy="212" rx="110" ry="10" fill="rgba(0,0,0,0.18)" />
      <rect x="170" y="195" width="120" height="16" rx="3" fill="url(#woodGrad)" stroke={C.accent} strokeWidth="1.2" />
      <rect x="218" y="100" width="24" height="100" rx="4" fill="url(#woodGrad)" stroke={C.accent} strokeWidth="1.2" />

      {/* Pivot */}
      <circle cx="230" cy="100" r="9" fill="url(#brassGrad)" stroke={C.accent} strokeWidth="1.4" />

      {/* Beam group (rotates with state) */}
      <g
        style={{
          transformOrigin: "230px 100px",
          transform: `rotate(${tilt}deg)`,
          transition: "transform 0.55s cubic-bezier(.45,1.5,.55,1)",
          animation: beamAnimation,
        }}
      >
        {/* Beam */}
        <rect x="70" y="96" width="320" height="8" rx="3" fill="url(#brassGrad)" stroke={C.accent} strokeWidth="1.2" />
        {/* Indicator needle pointing up */}
        <path
          d="M230 96 L226 70 L234 70 Z"
          fill="url(#brassGrad)"
          stroke={C.accent}
          strokeWidth="1"
        />
        {/* Hangers */}
        <line x1="90" y1="104" x2="90" y2="140" stroke={C.accent} strokeWidth="1.6" />
        <line x1="370" y1="104" x2="370" y2="140" stroke={C.accent} strokeWidth="1.6" />
        {/* Plates */}
        <ellipse cx="90" cy="148" rx="50" ry="7" fill="url(#brassGrad)" stroke={C.accent} strokeWidth="1.3" />
        <path d="M40 148 Q90 168 140 148 L132 156 Q90 172 48 156 Z" fill="#A87131" stroke={C.accent} strokeWidth="1.2" />
        <ellipse cx="370" cy="148" rx="50" ry="7" fill="url(#brassGrad)" stroke={C.accent} strokeWidth="1.3" />
        <path d="M320 148 Q370 168 420 148 L412 156 Q370 172 328 156 Z" fill="#A87131" stroke={C.accent} strokeWidth="1.2" />

        {/* Left plate: flour pile (always present) */}
        <ellipse cx="90" cy="143" rx="34" ry="7" fill="#FFF8F0" opacity="0.85" />
        <ellipse cx="90" cy="138" rx="24" ry="5" fill="#FFF8F0" opacity="0.95" />
        <ellipse cx="90" cy="134" rx="14" ry="3" fill="#FFFFFF" />

        {/* Right plate: yeast brick (varies subtle with state) */}
        <g transform={`translate(370, 138) scale(${state === 'ok' ? 1 : state === 'high' ? 1.15 : 0.85})`}>
          <rect x="-18" y="-8" width="36" height="14" rx="2" fill="#E5C28A" stroke="#8B5A1F" strokeWidth="1" />
          <line x1="-18" y1="-2" x2="18" y2="-2" stroke="#8B5A1F" strokeWidth="0.6" opacity="0.4" />
          <line x1="-6" y1="-8" x2="-6" y2="6" stroke="#8B5A1F" strokeWidth="0.6" opacity="0.4" />
          <line x1="6"  y1="-8" x2="6"  y2="6" stroke="#8B5A1F" strokeWidth="0.6" opacity="0.4" />
        </g>
      </g>

      {/* Scale graduations */}
      <g opacity="0.55">
        {[-30, -15, 0, 15, 30].map((deg, i) => {
          const cx = 230, cy = 100;
          const r1 = 38, r2 = 44;
          const rad = (deg - 90) * Math.PI / 180;
          return (
            <line
              key={i}
              x1={cx + Math.cos(rad) * r1}
              y1={cy + Math.sin(rad) * r1}
              x2={cx + Math.cos(rad) * r2}
              y2={cy + Math.sin(rad) * r2}
              stroke={C.accent}
              strokeWidth={deg === 0 ? 1.6 : 1}
            />
          );
        })}
      </g>
    </svg>
  );
}

/* ---------- FlourConfetti ---------- */
function FlourConfetti() {
  const particles = useMemo(() => {
    return Array.from({ length: 36 }).map((_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 2.4 + Math.random() * 1.6,
      size: 4 + Math.random() * 8,
      dx: (Math.random() - 0.5) * 200,
      rotate: Math.random() * 360,
      shape: Math.random() > 0.5 ? "circle" : "square",
    }));
  }, []);
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 60,
        overflow: "hidden",
      }}
    >
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            left: `${p.left}%`,
            top: "-5%",
            width: p.size,
            height: p.size,
            background: p.id % 4 === 0 ? "#D4A853" : "#FFF8F0",
            borderRadius: p.shape === "circle" ? "50%" : 2,
            opacity: 0.85,
            boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
            animation: `flourFall ${p.duration}s linear ${p.delay}s forwards`,
            "--dx": `${p.dx}px`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/* =========================================================================
 * Placeholder Screen (7 + 9)
 * ========================================================================= */
function ScreenPlaceholder({ screenNum, title, chrono, onBack, onZero }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        padding: "70px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        animation: "screenFade 0.3s ease both",
      }}
    >
      <ScreenTag index={screenNum} title={title} />
      <ChronoTimer secondes={chrono} running={true} onZero={onZero} />

      <div
        style={{
          background: C.ivory,
          color: C.ink,
          padding: "48px 64px",
          borderRadius: 14,
          textAlign: "center",
          boxShadow: "0 22px 50px rgba(0,0,0,0.5)",
          maxWidth: 480,
        }}
      >
        <p
          style={{
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            fontSize: 13,
            color: "#8B4513",
            letterSpacing: 1,
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          écran {screenNum}
        </p>
        <h2
          style={{
            fontFamily: "Georgia, serif",
            fontWeight: 400,
            fontSize: 28,
            marginBottom: 8,
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 14,
            color: "#5a3d1b",
            marginBottom: 28,
            opacity: 0.8,
          }}
        >
          à venir — gabarit à compléter
        </p>
        <button
          onClick={onBack}
          style={{
            padding: "10px 20px",
            background: C.gold,
            color: C.ink,
            border: `1.5px solid ${C.accent}`,
            borderRadius: 8,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: 0.3,
            cursor: "pointer",
            boxShadow: "0 6px 14px rgba(212,168,83,0.35)",
          }}
        >
          ← Retour au hub
        </button>
      </div>
    </div>
  );
}

/* =========================================================================
 * Helpers shared by écrans 7 / 8 / 9
 * ========================================================================= */

const VERROU_NAMES = {
  1: "Anatomie de la cellule",
  2: "Bourgeonnement (séquençage)",
  3: "Types de levures",
  4: "Dosage levure pressée",
};

function computeScore({ cadenas, tentatives, chrono }) {
  const solved = cadenas.filter(Boolean).length;
  const tentativesTotales = Object.values(tentatives).reduce(
    (a, b) => a + (b || 0),
    0
  );
  const reussite = solved * 15; // 0..60
  const sansErreur = Math.max(0, 20 - tentativesTotales * 2);
  const tempsRestant = Math.round((chrono / 720) * 20);
  return {
    solved,
    tentativesTotales,
    reussite,
    sansErreur,
    tempsRestant,
    total: reussite + sansErreur + tempsRestant,
    cadenas: [...cadenas],
  };
}

/* ---------- Reusable confetti ---------- */
function Confetti({ palette = ["#FFF8F0", "#D4A853", "#FFE9A1"], count = 60 }) {
  const particles = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 1.4,
        duration: 2.6 + Math.random() * 2.2,
        size: 5 + Math.random() * 10,
        dx: (Math.random() - 0.5) * 260,
        rotate: Math.random() * 360,
        color: palette[i % palette.length],
        shape: Math.random() > 0.5 ? "circle" : "square",
      })),
    [count]
  );
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 60,
        overflow: "hidden",
      }}
    >
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            left: `${p.left}%`,
            top: "-5%",
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.shape === "circle" ? "50%" : 2,
            opacity: 0.92,
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            animation: `flourFall ${p.duration}s linear ${p.delay}s forwards`,
            "--dx": `${p.dx}px`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/* ---------- Big open-lock glyph for victory cascade ---------- */
function OpenLockBig({ color = "#2A1505", size = 56 }) {
  return (
    <svg
      width={size}
      height={(size * 70) / 56}
      viewBox="0 0 56 70"
      fill="none"
      aria-hidden="true"
    >
      {/* Open shackle: tilted to the upper-right */}
      <path
        d="M12 28 V18 a14 14 0 0 1 24 -6"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      {/* Body */}
      <rect
        x="6"
        y="28"
        width="44"
        height="36"
        rx="4"
        fill={color}
        stroke={color}
        strokeWidth="1.5"
      />
      <circle cx="28" cy="44" r="4" fill="#FFF8F0" />
      <rect x="26" y="46" width="4" height="10" rx="1.2" fill="#FFF8F0" />
    </svg>
  );
}

/* =========================================================================
 * ÉCRAN 7 — Victoire · Pain sauvé
 * ========================================================================= */
function Screen7Victoire({
  chrono, cadenas, tentatives, onRejouer, onBilan, onTerminer, playerName,
}) {
  const score = computeScore({ cadenas, tentatives, chrono });
  const [terminated, setTerminated] = useState(false);

  const handleTerminer = () => {
    setTerminated(true);
    onTerminer && onTerminer(score);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        padding: "60px 24px 70px",
        animation: "screenFade 0.3s ease both",
      }}
    >
      <ScreenTag index={7} title="Victoire · Pain sauvé" />
      <Confetti count={70} palette={["#FFF8F0", "#D4A853", "#FFE9A1", "#F4E0B0"]} />

      {/* Title */}
      <div
        style={{
          textAlign: "center",
          maxWidth: 920,
          margin: "30px auto 0",
          animation: "screenFade 0.4s ease both",
        }}
      >
        <div
          style={{
            fontSize: 56,
            lineHeight: 1,
            marginBottom: 8,
            display: "inline-block",
            animation: "victoryTrophy 1.2s ease both",
          }}
          aria-hidden="true"
        >
          🏆
        </div>
        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontWeight: 400,
            fontSize: 36,
            color: C.ivory,
            lineHeight: 1.25,
            textWrap: "balance",
          }}
        >
          Bravo,{" "}<strong style={{ color: C.gold }}>{playerName}</strong>&nbsp;! <br />
          La boulangerie Durand est sauvée.
        </h1>
      </div>

      {/* Lock cascade */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 48,
          marginTop: 38,
          flexWrap: "wrap",
        }}
      >
        {[1, 2, 3, 4].map((n, i) => (
          <div
            key={n}
            style={{
              textAlign: "center",
              animation: `lockCascade 0.6s ease both`,
              animationDelay: `${0.3 + i * 0.3}s`,
              opacity: 0,
            }}
          >
            <OpenLockBig color={C.ivory} size={54} />
            <div
              style={{
                marginTop: 8,
                fontFamily: "Georgia, serif",
                fontStyle: "italic",
                fontSize: 13,
                color: C.ivoryDim,
                letterSpacing: 0.5,
              }}
            >
              Verrou {n}
            </div>
          </div>
        ))}
      </div>

      {/* Score + badge */}
      <div
        style={{
          maxWidth: 960,
          margin: "44px auto 0",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 24,
        }}
      >
        {/* Score card */}
        <div
          style={{
            background: C.ivory,
            color: C.ink,
            border: `2px solid ${C.accent}`,
            borderRadius: 14,
            padding: "22px 26px 24px",
            boxShadow: "0 16px 36px rgba(0,0,0,0.4)",
          }}
        >
          <h3
            style={{
              fontFamily: "Georgia, serif",
              fontWeight: 400,
              fontSize: 18,
              marginBottom: 10,
              paddingBottom: 6,
              borderBottom: `1px dashed ${C.accent}`,
            }}
          >
            Votre score
          </h3>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 14,
            }}
          >
            <span
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 64,
                fontWeight: 700,
                color: C.ink,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {score.total}
            </span>
            <span
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 22,
                color: "#7a5024",
              }}
            >
              / 100
            </span>
          </div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 13.5,
              color: "#3a2812",
              lineHeight: 1.9,
            }}
          >
            <li>
              <span style={{ color: "#7a5024" }}>•</span>{" "}
              Énigmes réussies&nbsp;:{" "}
              <strong>
                {score.reussite} / 60
              </strong>{" "}
              <span style={{ color: "#7a5024", fontSize: 12 }}>
                ({score.solved}/4)
              </span>
            </li>
            <li>
              <span style={{ color: "#7a5024" }}>•</span>{" "}
              Sans erreur&nbsp;: <strong>{score.sansErreur} / 20</strong>{" "}
              <span style={{ color: "#7a5024", fontSize: 12 }}>
                ({score.tentativesTotales} tentative
                {score.tentativesTotales > 1 ? "s" : ""})
              </span>
            </li>
            <li>
              <span style={{ color: "#7a5024" }}>•</span>{" "}
              Temps restant&nbsp;:{" "}
              <strong>
                {score.tempsRestant} / 20
              </strong>{" "}
              <span style={{ color: "#7a5024", fontSize: 12 }}>
                ({fmtTime(chrono)})
              </span>
            </li>
          </ul>
        </div>

        {/* Badge card */}
        <div
          style={{
            background: `linear-gradient(135deg, ${C.goldHi} 0%, ${C.gold} 60%, #B98931 100%)`,
            color: C.ink,
            border: `2px solid ${C.accent}`,
            borderRadius: 14,
            padding: "22px 26px 24px",
            boxShadow:
              "0 16px 36px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.45)",
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Subtle radial glow */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.35), transparent 60%)",
              pointerEvents: "none",
            }}
          />
          <h3
            style={{
              fontFamily: "Georgia, serif",
              fontWeight: 400,
              fontSize: 18,
              marginBottom: 14,
              paddingBottom: 6,
              borderBottom: `1px dashed rgba(42,21,5,0.35)`,
              position: "relative",
            }}
          >
            Badge débloqué
          </h3>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              position: "relative",
              flex: 1,
            }}
          >
            <div
              style={{
                width: 84,
                height: 84,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle at 35% 30%, #FFE9A1, #C68A3D 70%, #8B5A1F 100%)",
                border: `3px solid ${C.accent}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 42,
                boxShadow:
                  "inset 0 -4px 8px rgba(0,0,0,0.25), 0 6px 16px rgba(0,0,0,0.3)",
                animation: "badgeShine 2.4s ease-in-out infinite",
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              🥐
            </div>
            <div>
              <div
                style={{
                  fontFamily: "Georgia, serif",
                  fontSize: 22,
                  fontWeight: 400,
                  fontStyle: "italic",
                  color: "#2A1505",
                  lineHeight: 1.2,
                }}
              >
                Maître Fermenteur
              </div>
              <div
                style={{
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontSize: 12,
                  color: "rgba(42,21,5,0.7)",
                  marginTop: 4,
                  letterSpacing: 0.4,
                }}
              >
                Niveau 1 / 5
              </div>
              {/* Star tracker */}
              <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 14,
                      color: i === 1 ? "#3a2812" : "rgba(42,21,5,0.25)",
                    }}
                    aria-hidden="true"
                  >
                    ★
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div
        style={{
          maxWidth: 960,
          margin: "32px auto 0",
          display: "flex",
          justifyContent: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <VictoryButton variant="ghost" onClick={onRejouer}>
          <span aria-hidden="true">🔁</span> Rejouer
        </VictoryButton>
        <VictoryButton variant="ghost" onClick={onBilan}>
          <span aria-hidden="true">📋</span> Voir le bilan
        </VictoryButton>
        <VictoryButton variant="gold" onClick={handleTerminer} disabled={terminated}>
          <span aria-hidden="true">{terminated ? "📡" : "✅"}</span>{" "}
          {terminated ? "Score envoyé" : "Terminer"}
        </VictoryButton>
      </div>
    </div>
  );
}

function VictoryButton({ variant = "ghost", children, onClick, disabled }) {
  const isGold = variant === "gold";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "11px 22px",
        background: disabled
          ? "rgba(46,139,87,0.25)"
          : isGold
            ? `linear-gradient(180deg, ${C.goldHi} 0%, ${C.gold} 100%)`
            : C.ivory,
        color: disabled
          ? "#1B5E20"
          : isGold
            ? C.ink
            : C.ink,
        border: `1.5px solid ${
          disabled ? "#1B5E20" : isGold ? C.accent : C.accent
        }`,
        borderRadius: 999,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontWeight: 700,
        fontSize: 14,
        cursor: disabled ? "default" : "pointer",
        boxShadow: isGold
          ? "0 8px 20px rgba(212,168,83,0.45)"
          : "0 4px 12px rgba(0,0,0,0.3)",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {children}
    </button>
  );
}

/* =========================================================================
 * ÉCRAN 8 — Défaite · Temps écoulé
 * ========================================================================= */
function Screen8Defaite({ failedAtVerrou, cadenas, onRestart, onRevoirCours }) {
  const verrouLabel = failedAtVerrou
    ? VERROU_NAMES[failedAtVerrou] || "Énigme inconnue"
    : "Énigme inconnue";
  const verrouNum = failedAtVerrou || "—";
  const solved = cadenas.filter(Boolean).length;

  return (
    <>
      {/* Black overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#0A0A0A",
          zIndex: 0,
        }}
        aria-hidden="true"
      />
      <div
        style={{
          minHeight: "100vh",
          position: "relative",
          zIndex: 1,
          padding: "50px 24px",
          color: C.ivory,
          animation: "screenFade 0.3s ease both",
        }}
      >
        <ScreenTag index={8} title="Défaite · Temps écoulé" />

        {/* FERMÉ sign */}
        <div
          style={{
            textAlign: "center",
            marginTop: 36,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "inline-block",
              padding: "16px 64px",
              background: `linear-gradient(180deg, ${C.red} 0%, ${C.redDeep} 100%)`,
              color: C.ivory,
              fontFamily: "Georgia, serif",
              fontWeight: 700,
              fontSize: 42,
              letterSpacing: 8,
              transform: "rotate(-5deg)",
              border: "3px solid rgba(255,255,255,0.18)",
              borderRadius: 6,
              boxShadow: "0 18px 36px rgba(0,0,0,0.7), inset 0 -4px 0 rgba(0,0,0,0.3)",
              animation: "ferméSwing 3.5s ease-in-out infinite",
              transformOrigin: "top center",
            }}
          >
            FERMÉ
          </div>
        </div>

        {/* Card */}
        <div
          style={{
            maxWidth: 520,
            margin: "0 auto",
            background: C.ivory,
            color: C.ink,
            borderRadius: 14,
            padding: "32px 38px 30px",
            boxShadow: "0 22px 50px rgba(0,0,0,0.6)",
            textAlign: "center",
          }}
        >
          <h2
            style={{
              fontFamily: "Georgia, serif",
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: 26,
              marginBottom: 14,
              color: C.ink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <span aria-hidden="true">⏰</span>
            Le temps est écoulé…
          </h2>
          <p
            style={{
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 14,
              lineHeight: 1.6,
              color: "#3a2812",
              marginBottom: 6,
            }}
          >
            La boulangerie reste fermée aujourd'hui.
          </p>
          <p
            style={{
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 14,
              lineHeight: 1.6,
              color: "#5a3d1b",
              marginBottom: 22,
            }}
          >
            Pas de panique — revoyez vos notes et retentez votre chance.
          </p>

          {/* Pink dashed callout */}
          <div
            style={{
              background: "#FCEEEE",
              border: "1.6px dashed #CC0000",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 24,
            }}
          >
            <div
              style={{
                fontFamily: "Georgia, serif",
                fontStyle: "italic",
                fontSize: 14,
                color: "#8B0000",
                fontWeight: 600,
              }}
            >
              Énigme bloquante&nbsp;: Verrou {verrouNum} — {verrouLabel}
            </div>
            <div
              style={{
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 12,
                color: "#5a3d1b",
                marginTop: 4,
              }}
            >
              {solved} verrou{solved > 1 ? "s" : ""} ouvert{solved > 1 ? "s" : ""} sur 4
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={onRestart}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "11px 22px",
                background: `linear-gradient(180deg, ${C.goldHi} 0%, ${C.gold} 100%)`,
                color: C.ink,
                border: `1.5px solid ${C.accent}`,
                borderRadius: 999,
                fontFamily: "Arial, Helvetica, sans-serif",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                boxShadow: "0 8px 20px rgba(212,168,83,0.4)",
              }}
            >
              <span aria-hidden="true">🔁</span> Recommencer
            </button>
            <button
              onClick={onRevoirCours}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "11px 22px",
                background: C.ivory,
                color: C.ink,
                border: `1.5px solid ${C.accent}`,
                borderRadius: 999,
                fontFamily: "Arial, Helvetica, sans-serif",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
            >
              <span aria-hidden="true">📖</span> Revoir le cours
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* =========================================================================
 * ÉCRAN 9 — Bilan pédagogique
 * ========================================================================= */
function Screen9Bilan({ chrono, cadenas, tentatives, puzzleDurations, onBack }) {
  const score = computeScore({ cadenas, tentatives, chrono });

  // Per-puzzle competence percentage:
  // solved + 0 errors → 100; each error -20, floor 20. Not solved → 0.
  const puzzlePct = (idx /* 1..4 */) => {
    if (!cadenas[idx - 1]) return 0;
    const errs = tentatives[idx] || 0;
    return Math.max(20, 100 - errs * 20);
  };

  const competences = [
    { name: "Composition cellulaire de la levure", pct: puzzlePct(1) },
    { name: "Cycle de reproduction par bourgeonnement", pct: puzzlePct(2) },
    {
      name: "Identifier les types de levures + dosage",
      pct: Math.round((puzzlePct(3) + puzzlePct(4)) / 2),
    },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        padding: "60px 24px 60px",
        animation: "screenFade 0.3s ease both",
      }}
    >
      <ScreenTag index={9} title="Bilan pédagogique détaillé" />

      <div style={{ maxWidth: 1140, margin: "30px auto 0" }}>
        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontWeight: 400,
            fontSize: 30,
            color: C.ivory,
          }}
        >
          Bilan pédagogique
        </h1>
        <p
          style={{
            marginTop: 4,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 13.5,
            color: C.ivoryDim,
            opacity: 0.8,
            maxWidth: 720,
          }}
        >
          Rappel des notions clés du module «&nbsp;La levure&nbsp;» et taux de maîtrise.
        </p>

        {/* 4 score mini-cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 14,
            marginTop: 22,
            position: "relative",
          }}
        >
          <BilanMiniCard
            label="Score global"
            big={score.total}
            unit="/ 100"
            sub=""
          />
          <BilanMiniCard
            label="Réussites"
            big={`${score.reussite} pts`}
            sub={`${score.solved} énigmes / 4`}
          />
          <BilanMiniCard
            label="Sans erreur"
            big={`${score.sansErreur} / 20`}
            sub={
              score.tentativesTotales === 0
                ? "aucune erreur"
                : `${score.tentativesTotales} tentative${
                    score.tentativesTotales > 1 ? "s" : ""
                  } ratée${score.tentativesTotales > 1 ? "s" : ""}`
            }
          />
          <BilanMiniCard
            label="Temps"
            big={`${score.tempsRestant} / 20`}
            sub={`${fmtTime(chrono)} sauvegardées`}
          />
        </div>

        {/* Table + Compétences */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
            gap: 24,
            marginTop: 28,
            alignItems: "start",
          }}
        >
          {/* Détail par énigme */}
          <div>
            <h3
              style={{
                fontFamily: "Georgia, serif",
                fontWeight: 400,
                fontSize: 18,
                color: C.ivory,
                marginBottom: 10,
              }}
            >
              Détail par énigme
            </h3>
            <div
              style={{
                background: C.ivory,
                color: C.ink,
                border: `2px solid ${C.accent}`,
                borderRadius: 12,
                padding: 4,
                boxShadow: "0 16px 36px rgba(0,0,0,0.4)",
                overflow: "hidden",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontSize: 13.5,
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "rgba(212,168,83,0.10)",
                      color: "#7a5024",
                      fontFamily: "Georgia, serif",
                      fontStyle: "italic",
                      fontSize: 12.5,
                      letterSpacing: 0.3,
                    }}
                  >
                    <th style={bilanTh(60)}>#</th>
                    <th style={bilanTh(null, "left")}>Notion</th>
                    <th style={bilanTh(120)}>Statut</th>
                    <th style={bilanTh(90)}>Tentat.</th>
                    <th style={bilanTh(80)}>Temps</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4].map((n) => {
                    const ok = cadenas[n - 1];
                    return (
                      <tr
                        key={n}
                        style={{
                          borderTop: `1px solid rgba(139,69,19,0.15)`,
                        }}
                      >
                        <td style={bilanTd("#7a5024", "center", "Georgia, serif")}>
                          {n}
                        </td>
                        <td style={bilanTd(C.ink, "left")}>
                          {VERROU_NAMES[n]}
                        </td>
                        <td style={bilanTd("", "center")}>
                          <StatusBadge ok={ok} />
                        </td>
                        <td style={bilanTd("#3a2812", "center")}>
                          {tentatives[n] || 0}
                        </td>
                        <td
                          style={{
                            ...bilanTd("#3a2812", "center"),
                            fontFamily:
                              "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
                            fontSize: 12.5,
                          }}
                        >
                          {fmtTime(puzzleDurations[n] || 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Compétences */}
          <div>
            <h3
              style={{
                fontFamily: "Georgia, serif",
                fontWeight: 400,
                fontSize: 18,
                color: C.ivory,
                marginBottom: 10,
              }}
            >
              Compétences travaillées
            </h3>
            <div
              style={{
                background: C.ivory,
                color: C.ink,
                border: `2px solid ${C.accent}`,
                borderRadius: 12,
                padding: "18px 20px 22px",
                boxShadow: "0 16px 36px rgba(0,0,0,0.4)",
              }}
            >
              {competences.map((c, i) => (
                <CompetenceBar key={i} name={c.name} pct={c.pct} />
              ))}

              <button
                onClick={onBack}
                style={{
                  marginTop: 18,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 18px",
                  background: C.ivory,
                  color: C.ink,
                  border: `1.5px dashed ${C.accent}`,
                  borderRadius: 999,
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#FBF3DC")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = C.ivory)
                }
              >
                ← Retour au résumé
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const bilanTh = (width, align = "center") => ({
  padding: "10px 12px",
  fontWeight: 400,
  textAlign: align,
  width: width || "auto",
});
const bilanTd = (color, align = "center", family) => ({
  padding: "12px 12px",
  color: color || "#3a2812",
  textAlign: align,
  fontFamily: family || "Arial, Helvetica, sans-serif",
  fontWeight: align === "left" ? 500 : 400,
});

function StatusBadge({ ok }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 12px",
        borderRadius: 999,
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: 0.3,
        background: ok ? "#E8F5E9" : "#FFE5E5",
        color: ok ? "#1B5E20" : C.redDeep,
        border: `1.2px solid ${ok ? "#2E8B57" : C.red}`,
      }}
    >
      {ok ? "Réussie" : "Échouée"}
    </span>
  );
}

function BilanMiniCard({ label, big, unit, sub }) {
  return (
    <div
      style={{
        background: C.ivory,
        color: C.ink,
        border: `2px solid ${C.accent}`,
        borderRadius: 12,
        padding: "16px 18px 18px",
        boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <span
        style={{
          fontFamily: "Georgia, serif",
          fontStyle: "italic",
          fontSize: 12.5,
          color: "#7a5024",
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 30,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color: C.ink,
            lineHeight: 1.1,
          }}
        >
          {big}
        </span>
        {unit && (
          <span style={{ fontFamily: "Georgia, serif", fontSize: 16, color: "#7a5024" }}>
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <span
          style={{
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 11.5,
            color: "#7a5024",
            opacity: 0.85,
          }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

function CompetenceBar({ name, pct }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 5,
        }}
      >
        <span
          style={{
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 12.5,
            color: C.ink,
            fontWeight: 500,
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 13,
            fontWeight: 700,
            color: pct >= 60 ? "#7a5024" : C.redDeep,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {pct}%
        </span>
      </div>
      <div
        style={{
          height: 10,
          background: "rgba(139,69,19,0.10)",
          borderRadius: 999,
          overflow: "hidden",
          border: `1px solid rgba(139,69,19,0.2)`,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background:
              pct >= 60
                ? `linear-gradient(90deg, ${C.gold}, ${C.accent})`
                : `linear-gradient(90deg, ${C.red}, ${C.redDeep})`,
            transition: "width 0.6s ease",
            borderRadius: 999,
          }}
        />
      </div>
    </div>
  );
}

/* =========================================================================
 * App root
 * ========================================================================= */
function App() {
  const [playerName, setPlayerName] = useState('');
  const [showNameModal, setShowNameModal] = useState(true);
  const [ecranActuel, setEcranActuel] = useState(1);
  const [chrono, setChrono] = useState(720);
  const [chronoRunning, setChronoRunning] = useState(false);

  // Ambiance music follows current screen
  useAmbience(showNameModal ? 0 : ecranActuel);
  const [cadenas, setCadenas] = useState([false, false, false, false]);
  const [tentatives, setTentatives] = useState({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const [puzzleDurations, setPuzzleDurations] = useState({
    1: 0, 2: 0, 3: 0, 4: 0,
  });
  const [failedAtVerrou, setFailedAtVerrou] = useState(null);
  const variante = useMemo(() => Math.floor(Math.random() * 3) + 1, []);

  // Refs to read latest state from inside the chrono interval callback.
  const ecranRef = useRef(ecranActuel);
  const cadenasRef = useRef(cadenas);
  const chronoRef = useRef(chrono);
  const puzzleStartChronoRef = useRef({ 1: 0, 2: 0, 3: 0, 4: 0 });
  useEffect(() => { ecranRef.current = ecranActuel; }, [ecranActuel]);
  useEffect(() => { cadenasRef.current = cadenas; }, [cadenas]);
  useEffect(() => { chronoRef.current = chrono; }, [chrono]);

  /* Chrono effect */
  useEffect(() => {
    if (!chronoRunning) return;
    const id = setInterval(() => {
      setChrono((s) => {
        if (s <= 1) {
          clearInterval(id);
          setChronoRunning(false);
          // Determine which verrou the user got stuck on.
          const ec = ecranRef.current;
          let blocking;
          if (ec >= 3 && ec <= 6) {
            blocking = ec - 2;
          } else {
            const idx = cadenasRef.current.findIndex((c) => !c);
            blocking = idx === -1 ? 4 : idx + 1;
          }
          // Accumulate time spent on the puzzle that was open.
          if (ec >= 3 && ec <= 6) {
            const pid = ec - 2;
            const start = puzzleStartChronoRef.current[pid];
            if (start) {
              setPuzzleDurations((prev) => ({
                ...prev,
                [pid]: (prev[pid] || 0) + start, // start - 0 == start
              }));
              puzzleStartChronoRef.current[pid] = 0;
            }
          }
          setFailedAtVerrou(blocking);
          setEcranActuel(8);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [chronoRunning]);

  /* Time tracking helpers */
  const enterPuzzle = (id) => {
    puzzleStartChronoRef.current[id] = chronoRef.current;
  };
  const leavePuzzleAccumulate = (id) => {
    const start = puzzleStartChronoRef.current[id];
    if (!start) return;
    const elapsed = start - chronoRef.current;
    if (elapsed > 0) {
      setPuzzleDurations((prev) => ({
        ...prev,
        [id]: (prev[id] || 0) + elapsed,
      }));
    }
    puzzleStartChronoRef.current[id] = 0;
  };

  const handleStart = () => {
    setChronoRunning(true);
    setEcranActuel(2);
  };

  const handleChooseVerrou = (id) => {
    enterPuzzle(id);
    setEcranActuel(2 + id);
  };

  const handleBackToHub = () => {
    const curId = ecranActuel - 2;
    if (curId >= 1 && curId <= 4) leavePuzzleAccumulate(curId);
    setEcranActuel(2);
  };

  const handleZero = () => setEcranActuel(8);

  const restart = () => {
    setShowNameModal(true);
    setPlayerName('');
    setEcranActuel(1);
    setChrono(720);
    setChronoRunning(false);
    setCadenas([false, false, false, false]);
    setTentatives({ 1: 0, 2: 0, 3: 0, 4: 0 });
    setPuzzleDurations({ 1: 0, 2: 0, 3: 0, 4: 0 });
    setFailedAtVerrou(null);
    puzzleStartChronoRef.current = { 1: 0, 2: 0, 3: 0, 4: 0 };
  };

  const handlePuzzleSuccess = (verrouId) => {
    leavePuzzleAccumulate(verrouId);
    setCadenas((c) => {
      const next = [...c];
      next[verrouId - 1] = true;
      return next;
    });
    if (verrouId === 4) {
      setChronoRunning(false);
      setEcranActuel(7);
    } else {
      setEcranActuel(2);
    }
  };

  return (
    <>
      {showNameModal && (
        <PlayerNameModal
          onConfirm={(name) => {
            setPlayerName(name);
            setShowNameModal(false);
            AudioEngine.startIntroAmbience();
          }}
        />
      )}
      {!showNameModal && ecranActuel === 1 && <Screen1Intro onStart={handleStart} playerName={playerName} />}
      {ecranActuel === 2 && (
        <Screen2Hub
          chrono={chrono}
          cadenas={cadenas}
          onChooseVerrou={handleChooseVerrou}
          onZero={handleZero}
        />
      )}
      {ecranActuel === 3 && (
        <Screen3Enigme1
          chrono={chrono}
          tentatives={tentatives}
          onBack={handleBackToHub}
          onUpdateTentatives={(verrouId, delta) =>
            setTentatives((t) => ({ ...t, [verrouId]: (t[verrouId] || 0) + delta }))
          }
          onSuccess={() => handlePuzzleSuccess(1)}
          onZero={handleZero}
        />
      )}
      {ecranActuel === 4 && (
        <Screen4Enigme2
          chrono={chrono}
          tentatives={tentatives}
          onBack={handleBackToHub}
          onUpdateTentatives={(verrouId, delta) =>
            setTentatives((t) => ({ ...t, [verrouId]: (t[verrouId] || 0) + delta }))
          }
          onSuccess={() => handlePuzzleSuccess(2)}
          onZero={handleZero}
        />
      )}
      {ecranActuel === 5 && (
        <Screen5Enigme3
          chrono={chrono}
          tentatives={tentatives}
          onBack={handleBackToHub}
          onUpdateTentatives={(verrouId, delta) =>
            setTentatives((t) => ({ ...t, [verrouId]: (t[verrouId] || 0) + delta }))
          }
          onSuccess={() => handlePuzzleSuccess(3)}
          onZero={handleZero}
        />
      )}
      {ecranActuel === 6 && (
        <Screen6Enigme4
          chrono={chrono}
          tentatives={tentatives}
          variante={variante}
          onBack={handleBackToHub}
          onUpdateTentatives={(verrouId, delta) =>
            setTentatives((t) => ({ ...t, [verrouId]: (t[verrouId] || 0) + delta }))
          }
          onSuccess={() => handlePuzzleSuccess(4)}
          onZero={handleZero}
        />
      )}
      {ecranActuel === 7 && (
        <Screen7Victoire
          chrono={chrono}
          cadenas={cadenas}
          tentatives={tentatives}
          playerName={playerName}
          onRejouer={restart}
          onBilan={() => setEcranActuel(9)}
          onTerminer={(score) => {
            // SCORM bridge — sends score to LMS if available, otherwise console.
            if (window.scormBridge && window.scormBridge.complete) {
              window.scormBridge.complete(score);
            } else {
              console.log("[Dr. Levure] Score envoyé :", score);
            }
          }}
        />
      )}
      {ecranActuel === 8 && (
        <Screen8Defaite
          failedAtVerrou={failedAtVerrou}
          cadenas={cadenas}
          onRestart={restart}
          onRevoirCours={() => {
            // Placeholder for course module deep-link.
            alert("Module pédagogique « La levure » — à connecter au LMS.");
          }}
        />
      )}
      {ecranActuel === 9 && (
        <Screen9Bilan
          chrono={chrono}
          cadenas={cadenas}
          tentatives={tentatives}
          puzzleDurations={puzzleDurations}
          onBack={() => setEcranActuel(7)}
        />
      )}
    </>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
