/* Dr. Levure — SCORM 1.2 bridge
 * Discovers the LMS API object in parent windows, exposes a tiny façade.
 * No-op when no API is found (preview / standalone HTML).
 */
(function () {
  "use strict";

  function findAPI(win) {
    let depth = 0;
    while (depth < 10) {
      try {
        if (win && win.API) return win.API;
      } catch (_) {
        // Cross-origin frame — stop walking up.
        return null;
      }
      if (!win || !win.parent || win.parent === win) return null;
      try {
        win = win.parent;
      } catch (_) {
        return null;
      }
      depth++;
    }
    return null;
  }

  function getAPI() {
    let api = findAPI(window);
    if (!api && window.opener) {
      try { api = findAPI(window.opener); } catch (_) {}
    }
    return api;
  }

  const API = getAPI();
  const connected = !!API;

  if (connected) {
    try {
      API.LMSInitialize("");
      // Default session status: incomplete; will be flipped to completed on success.
      API.LMSSetValue("cmi.core.lesson_status", "incomplete");
      API.LMSSetValue("cmi.core.score.min", "0");
      API.LMSSetValue("cmi.core.score.max", "100");
      API.LMSCommit("");
      console.log("[SCORM] LMS API connected.");
    } catch (e) {
      console.warn("[SCORM] Init error:", e);
    }
  } else {
    console.log("[SCORM] No LMS API found — running standalone.");
  }

  /** Send a raw score (0..100) and optional pass/fail status, then commit. */
  function setScore(score) {
    if (!connected) return false;
    try {
      const total = Math.max(0, Math.min(100, Math.round(score.total || 0)));
      API.LMSSetValue("cmi.core.score.raw", String(total));
      API.LMSSetValue("cmi.core.score.min", "0");
      API.LMSSetValue("cmi.core.score.max", "100");
      // Mastery threshold : 60/100.
      const status = total >= 60 ? "passed" : "failed";
      API.LMSSetValue("cmi.core.lesson_status", status);
      // Optional interaction-level data : per verrou.
      if (score.cadenas) {
        score.cadenas.forEach((ok, i) => {
          const idx = i; // 0..3
          try {
            API.LMSSetValue(
              `cmi.interactions.${idx}.id`,
              `verrou_${idx + 1}`
            );
            API.LMSSetValue(
              `cmi.interactions.${idx}.result`,
              ok ? "correct" : "wrong"
            );
          } catch (_) {}
        });
      }
      // Subscores in suspend_data for the LMS to inspect if needed.
      try {
        API.LMSSetValue(
          "cmi.suspend_data",
          JSON.stringify({
            reussite: score.reussite,
            sansErreur: score.sansErreur,
            tempsRestant: score.tempsRestant,
            tentativesTotales: score.tentativesTotales,
            solved: score.solved,
          })
        );
      } catch (_) {}
      API.LMSCommit("");
      console.log("[SCORM] Score commit :", total, status);
      return true;
    } catch (e) {
      console.warn("[SCORM] setScore error:", e);
      return false;
    }
  }

  function finish() {
    if (!connected) return;
    try {
      API.LMSCommit("");
      API.LMSFinish("");
      console.log("[SCORM] Session terminated.");
    } catch (e) {
      console.warn("[SCORM] Finish error:", e);
    }
  }

  function complete(score) {
    setScore(score);
    finish();
  }

  // Best-effort cleanup if the user closes the tab.
  window.addEventListener("beforeunload", function () {
    if (connected) {
      try {
        API.LMSCommit("");
        API.LMSFinish("");
      } catch (_) {}
    }
  });

  window.scormBridge = {
    connected,
    setScore,
    finish,
    complete,
  };
})();
