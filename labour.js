/* Labour Rates page: labour types (cost vs charge rate) and add-on presets. */
(function () {
  "use strict";
  Q.renderChrome("labour");

  var catalog = null, dirty = false, lastRev = null;
  var $ = function (id) { return document.getElementById(id); };

  function doSave() {
    catalog.rev = Q.uid(); lastRev = catalog.rev; dirty = false;
    return QuoteStore.saveCatalog(catalog);
  }
  var saveSoon = Q.debounce(doSave, 600);
  function changed() { dirty = true; saveSoon(); }
  window.addEventListener("pagehide", function () { if (dirty) saveSoon.flush(); });

  function marginText(r) {
    var rate = Q.num(r.rate), cost = Q.num(r.cost);
    if (!rate) return "–";
    return ((rate - cost) / rate * 100).toFixed(0) + "%";
  }
  function inp(list, obj, f, type) {
    return '<input type="' + type + '"' + (type === "number" ? ' step="0.01" inputmode="decimal"' : "") +
      ' data-list="' + list + '" data-id="' + Q.esc(obj.id) + '" data-f="' + f + '" value="' + Q.esc(obj[f]) + '">';
  }

  function render() {
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
    if (!list) return;
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
    if (!b) return;
    var list = b.getAttribute("data-del");
    catalog[list] = catalog[list].filter(function (x) { return x.id !== b.getAttribute("data-id"); });
    render(); changed();
  });

  function addAndFocus(list, obj) {
    catalog[list].push(obj);
    render(); changed();
    var el = document.querySelector('[data-id="' + obj.id + '"][data-f="name"]');
    if (el) el.focus();
  }
  $("rateAddBtn").addEventListener("click", function () {
    addAndFocus("labourRates", { id: Q.uid(), name: "", unit: "Hrs", rate: 0, cost: 0 });
  });
  $("presetAddBtn").addEventListener("click", function () {
    addAndFocus("addOnPresets", { id: Q.uid(), name: "", amount: 0 });
  });

  QuoteStore.init({
    onStatus: Q.setSyncStatus,
    onChange: function (s) {
      if (catalog && (dirty || s.catalog.rev === lastRev)) return;
      catalog = s.catalog;
      render();
    }
  });
})();
