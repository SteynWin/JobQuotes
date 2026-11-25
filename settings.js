/* Settings page: business details, pricing defaults, backup/restore. */
(function () {
  "use strict";
  Q.renderChrome("settings");

  var state = null, catalog = null, dirty = false, lastRev = null;
  var $ = function (id) { return document.getElementById(id); };
  var NUMERIC = { marginPct: 1, supplierMarkupPct: 1, rollLengthM: 1, taxPct: 1, depositPct: 1, validDays: 1, nextQuoteNumber: 1 };

  function doSave() {
    catalog.rev = Q.uid(); lastRev = catalog.rev; dirty = false;
    $("saveState").textContent = "Saved";
    return QuoteStore.saveCatalog(catalog);
  }
  var saveSoon = Q.debounce(doSave, 600);
  window.addEventListener("pagehide", function () { if (dirty) saveSoon.flush(); });

  function fill() {
    document.querySelectorAll("[data-key]").forEach(function (el) {
      var v = catalog.settings[el.getAttribute("data-key")];
      el.value = v == null ? "" : v;
    });
  }
  document.querySelectorAll("[data-key]").forEach(function (el) {
    el.addEventListener("input", function () {
      var k = el.getAttribute("data-key");
      catalog.settings[k] = NUMERIC[k] ? Q.num(el.value) : el.value;
      dirty = true;
      $("saveState").textContent = "Saving…";
      saveSoon();
    });
  });

  var msg = $("backupMsg");
  function say(t, ok) { msg.textContent = t; msg.classList.toggle("form-success", !!ok); }

  $("backupDownloadBtn").addEventListener("click", function () {
    if (!state) return;
    var data = { app: "job-quotes", catalog: state.catalog, jobs: state.jobs, savedAt: new Date().toISOString() };
    Q.downloadFile("job-quotes-backup-" + Q.todayISO() + ".json", JSON.stringify(data, null, 2));
    say("Backup downloaded.", true);
  });
  $("backupRestoreBtn").addEventListener("click", function () { $("backupFileInput").value = ""; $("backupFileInput").click(); });
  $("backupFileInput").addEventListener("change", function () {
    var file = this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { say("That file isn't a valid backup."); return; }
      if (!data || !data.catalog || typeof data.jobs !== "object") { say("That file isn't a Job Quotes backup."); return; }
      var n = Object.keys(data.jobs).length;
      if (!confirm("Replace ALL current jobs, prices and settings with this backup (" + n + " jobs)?" +
        (QuoteStore.isTeamSyncEnabled ? " This affects everyone using team sync." : ""))) return;
      dirty = false; saveSoon.cancel(); catalog = null;
      QuoteStore.overwriteAll({ catalog: data.catalog, jobs: data.jobs });
      say("Backup restored (" + n + " jobs).", true);
    };
    reader.readAsText(file);
  });
  $("resetCatalogBtn").addEventListener("click", function () {
    if (!confirm("Reset the price list, labour rates and add-on presets to the original defaults? Jobs and business details are kept.")) return;
    var d = Q.defaultCatalog();
    catalog.categories = d.categories; catalog.items = d.items;
    catalog.labourRates = d.labourRates; catalog.addOnPresets = d.addOnPresets;
    doSave();
    say("Price list reset.", true);
  });

  QuoteStore.init({
    onStatus: Q.setSyncStatus,
    onChange: function (s) {
      state = s;
      if (catalog && (dirty || s.catalog.rev === lastRev)) return;
      catalog = s.catalog;
      fill();
    }
  });
})();
