/* Settings page: business details, labour rates, add-on presets, pricing defaults, backup/restore. */
(function () {
  "use strict";
  Q.renderChrome("settings");

  var state = null, catalog = null, dirty = false, lastRev = null;
  var $ = function (id) { return document.getElementById(id); };
  var NUMERIC = { marginPct: 1, taxPct: 1, depositPct: 1, validDays: 1, nextQuoteNumber: 1 };

  function doSave() {
    catalog.rev = Q.uid(); lastRev = catalog.rev; dirty = false;
    $("saveState").textContent = "Saved";
    return QuoteStore.saveCatalog(catalog);
  }
  var saveSoon = Q.debounce(doSave, 600);
  window.addEventListener("pagehide", function () { if (dirty) saveSoon.flush(); });

  function changed() {
    dirty = true;
    $("saveState").textContent = "Saving…";
    saveSoon();
  }

  // ---- labour rates & add-on presets ----
  function marginText(r) {
    var rate = Q.num(r.rate), cost = Q.num(r.cost);
    if (!rate) return "–";
    return ((rate - cost) / rate * 100).toFixed(0) + "%";
  }
  function inp(list, obj, f, type) {
    return '<input type="' + type + '"' + (type === "number" ? ' step="0.01" inputmode="decimal"' : "") +
      ' data-list="' + list + '" data-id="' + Q.esc(obj.id) + '" data-f="' + f + '" value="' + Q.esc(obj[f]) + '">';
  }
  function renderLists() {
    $("rateBody").innerHTML = catalog.labourRates.length ? catalog.labourRates.map(function (r) {
      return '<tr>' +
        '<td>' + inp("labourRates", r, "name", "text") + '</td>' +
        '<td class="col-unit">' + inp("labourRates", r, "unit", "text") + '</td>' +
        '<td class="num col-money">' + inp("labourRates", r, "cost", "number") + '</td>' +
        '<td class="num col-money">' + inp("labourRates", r, "rate", "number") + '</td>' +
        '<td class="num col-pct muted" data-margin="' + Q.esc(r.id) + '">' + marginText(r) + '</td>' +
        '<td class="col-del">' + (Q.fixedLabourKey(r) ? '<span class="muted" title="Standard type – always shown on jobs">🔒</span>' :
          '<button type="button" class="icon-btn" data-del="labourRates" data-id="' + Q.esc(r.id) + '">&times;</button>') + '</td>' +
        '</tr>';
    }).join("") : '<tr><td colspan="6" class="empty-note">No labour types.</td></tr>';
    $("presetBody").innerHTML = catalog.addOnPresets.length ? catalog.addOnPresets.map(function (p) {
      return '<tr>' +
        '<td>' + inp("addOnPresets", p, "name", "text") + '</td>' +
        '<td class="num col-money">' + inp("addOnPresets", p, "amount", "number") + '</td>' +
        '<td class="col-del"><button type="button" class="icon-btn" data-del="addOnPresets" data-id="' + Q.esc(p.id) + '">&times;</button></td>' +
        '</tr>';
    }).join("") : '<tr><td colspan="3" class="empty-note">No presets.</td></tr>';
  }
  document.querySelector("main").addEventListener("input", function (e) {
    var el = e.target, list = el.getAttribute("data-list");
    if (!list || !catalog) return;
    var obj = catalog[list].find(function (x) { return x.id === el.getAttribute("data-id"); });
    if (!obj) return;
    var f = el.getAttribute("data-f");
    obj[f] = el.type === "number" ? Q.num(el.value) : el.value;
    var m = document.querySelector('[data-margin="' + obj.id + '"]');
    if (m) m.textContent = marginText(obj);
    changed();
  });
  document.querySelector("main").addEventListener("click", function (e) {
    var b = e.target.closest("[data-del]");
    if (!b || !catalog) return;
    var list = b.getAttribute("data-del");
    catalog[list] = catalog[list].filter(function (x) { return x.id !== b.getAttribute("data-id"); });
    renderLists(); changed();
  });
  function addAndFocus(list, obj) {
    if (!catalog) return;
    catalog[list].push(obj);
    renderLists(); changed();
    var el = document.querySelector('[data-id="' + obj.id + '"][data-f="name"]');
    if (el) el.focus();
  }
  $("rateAddBtn").addEventListener("click", function () {
    addAndFocus("labourRates", { id: Q.uid(), name: "", unit: "Hrs", rate: 0, cost: 0 });
  });
  $("presetAddBtn").addEventListener("click", function () {
    addAndFocus("addOnPresets", { id: Q.uid(), name: "", amount: 0 });
  });

  function fill() {
    renderLists();
    document.querySelectorAll("[data-key]").forEach(function (el) {
      var v = catalog.settings[el.getAttribute("data-key")];
      el.value = v == null ? "" : v;
    });
  }
  document.querySelectorAll("[data-key]").forEach(function (el) {
    el.addEventListener("input", function () {
      var k = el.getAttribute("data-key");
      catalog.settings[k] = NUMERIC[k] ? Q.num(el.value) : el.value;
      changed();
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
    renderLists();
    say("Price list reset.", true);
  });

  QuoteStore.init({
    onStatus: Q.setSyncStatus,
    onChange: function (s) {
      state = s;
      if (catalog && (dirty || s.catalog.rev === lastRev)) return;
      catalog = s.catalog;
      fill();
      if (location.hash === "#labour" && !window._jumped) {
        window._jumped = true;
        var t = document.getElementById("labour");
        if (t) t.scrollIntoView();
      }
    }
  });
})();
