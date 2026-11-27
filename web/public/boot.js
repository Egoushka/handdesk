// Classic script: shows why the page is dead when the app bundle did not load or threw at start (a truncated or refused asset).
(function () {
  function show(text) { var s = document.getElementById("status"); if (s && !s.textContent) s.textContent = text; }
  addEventListener("error", function (e) { show("Page error: " + (e.message || "script failed to load")); }, true);
  setTimeout(function () { if (!window.__handdesk) show("The page script did not load. Reload the page."); }, 5000);
})();
