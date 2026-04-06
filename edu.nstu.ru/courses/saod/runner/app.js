(function () {
  "use strict";

  var TOTAL_TESTS = 40;

  function clampInt(n, min, max) {
    if (typeof n !== "number" || !isFinite(n)) return min;
    n = Math.floor(n);
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function getSearchParams() {
    try {
      return new URLSearchParams(window.location.search || "");
    } catch (e) {
      var out = {};
      var s = (window.location.search || "").replace(/^\?/, "");
      if (!s) return out;
      s.split("&").forEach(function (kv) {
        var idx = kv.indexOf("=");
        var k = idx >= 0 ? kv.slice(0, idx) : kv;
        var v = idx >= 0 ? kv.slice(idx + 1) : "";
        out[decodeURIComponent(k)] = decodeURIComponent(v);
      });
      return {
        get: function (k) {
          return Object.prototype.hasOwnProperty.call(out, k) ? out[k] : null;
        },
      };
    }
  }

  function parseIntParam(params, key) {
    var raw = params.get(key);
    if (raw == null || raw === "") return null;
    var n = parseInt(String(raw), 10);
    return isFinite(n) ? n : null;
  }

  var params = getSearchParams();

  var startParam = parseIntParam(params, "start");
  var nParam = parseIntParam(params, "n");

  var startTest = clampInt(startParam == null ? 1 : startParam, 1, TOTAL_TESTS);

  // "n" is kept as optional limiter (e.g. ?start=5&n=3 will allow 5..7)
  var lastTest = TOTAL_TESTS;
  if (nParam != null) {
    var nLimit = clampInt(nParam, 1, TOTAL_TESTS);
    lastTest = clampInt(startTest + nLimit - 1, 1, TOTAL_TESTS);
  }

  var currentTest = startTest;
  var player = null;
  var ruffle = null;

  var awaitingAdvance = false;
  var advanceArmedAt = 0;

  var els = {
    mount: null,
    label: null,
    prev: null,
    next: null,
  };

  function setLabel() {
    if (!els.label) return;
    els.label.textContent = "\u0422\u0435\u0441\u0442 " + String(currentTest) + " \u0438\u0437 " + String(lastTest);
  }

  function setButtons() {
    if (els.prev) els.prev.disabled = currentTest <= startTest;
    if (els.next) els.next.disabled = currentTest >= lastTest;
  }

  function swfUrlFor(testNumber) {
    return "swf/test" + String(testNumber) + ".swf";
  }

  function ensureRuffle() {
    if (ruffle) return ruffle;
    ruffle = window.RufflePlayer && window.RufflePlayer.newest ? window.RufflePlayer.newest() : null;
    return ruffle;
  }

  function destroyPlayer() {
    if (player && typeof player.remove === "function") {
      try {
        player.remove();
      } catch (e) {}
    }
    player = null;
    if (els.mount) els.mount.innerHTML = "";
  }

  function loadTest(testNumber) {
    currentTest = clampInt(testNumber, startTest, lastTest);
    setLabel();
    setButtons();

    var url = swfUrlFor(currentTest);

    destroyPlayer();

    var r = ensureRuffle();
    if (!r || !els.mount) {
      return;
    }

    player = r.createPlayer();
    player.style.width = "800px";
    player.style.height = "600px";
    player.style.display = "inline-block";
    player.style.backgroundColor = "#ffffff";
    els.mount.appendChild(player);

    try {
      player.load({ url: url, backgroundColor: "#ffffff" });
    } catch (e) {
      try {
        player.load(url);
      } catch (e2) {}
    }
  }

  function executeJsBridge(code) {
    if (typeof code !== "string") return false;
    var s = code.replace(/^\s*javascript:\s*/i, "").trim();
    // Common wrappers: "void(...)" and trailing semicolons
    if (/^void\s*\(/i.test(s)) {
      s = s.replace(/^void\s*\(\s*/i, "").replace(/\)\s*$/, "").trim();
    }
    s = s.replace(/;\s*$/, "").trim();

    if (/^send\s*(\(\s*\))?$/i.test(s)) {
      try {
        return !!window.send();
      } catch (e) {
        return true;
      }
    }

    var m = s.match(/^result\s*\(([\s\S]*)\)\s*$/i);
    if (m) {
      var inner = m[1] == null ? "" : String(m[1]).trim();
      var args = [];
      if (inner !== "") {
        // Best-effort parse of JS-literal argument list used by getURL("javascript:result(...)")
        try {
          // eslint-disable-next-line no-new-func
          args = Function("return [" + inner + "];")();
        } catch (e) {
          args = [inner];
        }
      }
      try {
        window.result.apply(null, args);
      } catch (e) {}
      return true;
    }

    return false;
  }

  function interceptJavascriptUrl(url) {
    if (typeof url !== "string") return false;
    var s = url.trim();
    if (!/^javascript:/i.test(s)) return false;
    return executeJsBridge(s);
  }

  function installJavascriptInterceptors() {
    // Many Flash movies use getURL("javascript:send()") which Ruffle may route via window.open().
    var originalOpen = window.open;
    window.open = function (url, target, features) {
      if (interceptJavascriptUrl(url)) return null;
      if (typeof originalOpen === "function") return originalOpen.call(window, url, target, features);
      return null;
    };

    // Some variants may use location.assign/replace with javascript: URLs.
    try {
      var loc = window.location;
      if (loc && typeof loc.assign === "function") {
        var originalAssign = loc.assign.bind(loc);
        loc.assign = function (url) {
          if (interceptJavascriptUrl(url)) return;
          return originalAssign(url);
        };
      }
      if (loc && typeof loc.replace === "function") {
        var originalReplace = loc.replace.bind(loc);
        loc.replace = function (url) {
          if (interceptJavascriptUrl(url)) return;
          return originalReplace(url);
        };
      }
    } catch (e) {}
  }

  // Called from SWF via ExternalInterface (Ruffle forwards to window.*).
  window.result = function () {
    awaitingAdvance = true;
    // Arm a short moment later so the click that produced the answer
    // doesn't immediately trigger an advance.
    advanceArmedAt = Date.now() + 300;
    return true;
  };

  // Called from SWF to proceed to the next test.
  window.send = function () {
    awaitingAdvance = false;
    advanceArmedAt = 0;
    if (currentTest >= lastTest) {
      return false;
    }
    loadTest(currentTest + 1);
    return true;
  };

  function wireUi() {
    els.mount = document.getElementById("playerMount");
    els.label = document.getElementById("testLabel");
    els.prev = document.getElementById("prevBtn");
    els.next = document.getElementById("nextBtn");

    if (els.prev) {
      els.prev.addEventListener("click", function () {
        if (currentTest > startTest) loadTest(currentTest - 1);
      });
    }
    if (els.next) {
      els.next.addEventListener("click", function () {
        if (currentTest < lastTest) loadTest(currentTest + 1);
      });
    }
  }

  window.addEventListener("DOMContentLoaded", function () {
    installJavascriptInterceptors();
    document.addEventListener(
      "click",
      function () {
        if (!awaitingAdvance) return;
        if (Date.now() < advanceArmedAt) return;

        awaitingAdvance = false;
        advanceArmedAt = 0;

        loadTest(currentTest + 1);
      },
      true
    );
    wireUi();
    loadTest(startTest);
  });
})();

