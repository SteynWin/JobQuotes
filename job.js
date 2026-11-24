/* Job / quote editor page. */
(function () {
  "use strict";
  Q.renderChrome("jobs");

  var jobId = Q.param("id");
  var state = null;      // latest { catalog, jobs } from the store
  var job = null;        // working copy being edited on this page
  var dirty = false;     // unsaved local edits pending
  var lastRev = null;    // rev of our last save, to ignore our own echo
  var firstRender = true;

  var $ = function (id) { return document.getElementById(id); };
  var saveStateEl = $("saveState");

  var EXPENSE_TYPES = ["Materials", "Hardware", "Labour / wages", "Subcontractor", "Appliances", "Delivery", "Other"];

  // ---------------------------------------------------------------- saving
  function doSave() {
    if (!job) return Promise.resolve();
    job.updatedAt = Date.now();
    job.rev = Q.uid();
    lastRev = job.rev;
    dirty = false;
    saveStateEl.textContent = "Saving…";
    return Promise.resolve(QuoteStore.saveJob(job)).then(function () {
      if (!dirty) saveStateEl.textContent = "All changes saved";
    });
  }
  var saveSoon = Q.debounce(doSave, 600);
  function changed() {
    dirty = true;
    saveStateEl.textContent = "Editing…";
    saveSoon();
  }
  function flush() { if (dirty) saveSoon.flush(); }
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });

  // Navigate after the current save finishes (or a short timeout when offline).
  function saveThenGo(url) {
    var p = dirty ? (saveSoon.flush(), Promise.resolve(QuoteStore.saveJob(job))) : Promise.resolve();
    var done = false;
    function go() { if (!done) { done = true; window.location.href = url; } }
    p.then(go, go);
    setTimeout(go, 1200);
  }

  // ------------------------------------------------------------- rendering
  function catIndex(cat) {
    var i = state.catalog.categories.indexOf(cat);
    return i === -1 ? 9999 : i;
  }

  function moneyInput(list, line, field) {
    return '<input type="number" step="0.01" inputmode="decimal" data-list="' + list + '" data-id="' + Q.esc(line.id) +
      '" data-f="' + field + '" value="' + Q.esc(line[field]) + '">';
  }
  function textInput(list, line, field, ph) {
    return '<input type="text" data-list="' + list + '" data-id="' + Q.esc(line.id) + '" data-f="' + field +
      '" value="' + Q.esc(line[field]) + '"' + (ph ? ' placeholder="' + Q.esc(ph) + '"' : "") + '>';
  }

  function renderMaterials() {
    var tbody = $("matBody");
    var lines = job.materials.slice();
    if (!lines.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-note">No materials yet. Pick an item below, or add the whole price list and type in quantities.</td></tr>';
      return;
    }
    lines.sort(function (a, b) { return catIndex(a.category) - catIndex(b.category); });
    var html = "", lastCat = null;
    lines.forEach(function (l) {
      if (l.category !== lastCat) {
        lastCat = l.category;
        html += '<tr class="cat-row"><td colspan="7">' + Q.esc(l.category || "Other") + '</td>' +
          '<td class="num" data-cattotal="' + Q.esc(l.category) + '"></td><td></td></tr>';
      }
      html += '<tr data-row="' + Q.esc(l.id) + '"' + (Q.num(l.qty) ? "" : ' class="zero"') + '>' +
        '<td>' + textInput("materials", l, "name") + '</td>' +
        '<td>' + textInput("materials", l, "description") + '</td>' +
        '<td class="num col-qty">' + moneyInput("materials", l, "qty") + '</td>' +
        '<td class="col-unit">' + textInput("materials", l, "unit") + '</td>' +
        '<td class="num col-money">' + moneyInput("materials", l, "cost") + '</td>' +
        '<td class="num col-money">' + moneyInput("materials", l, "price") + '</td>' +
        '<td class="num col-pct">' + moneyInput("materials", l, "markup") + '</td>' +
        '<td class="num col-total" data-linetotal="' + Q.esc(l.id) + '"></td>' +
        '<td class="col-del"><button type="button" class="icon-btn" data-del="materials" data-id="' + Q.esc(l.id) + '" title="Remove">&times;</button></td>' +
        '</tr>';
    });
    tbody.innerHTML = html;
  }

  // Every labour type from the Labour Rates page always has a row (hours
  // start at 0). Lines from types that have since been removed stay
  // visible, with a remove button, so nothing on an old quote disappears.
  function syncLabourLines() {
    state.catalog.labourRates.forEach(function (r) {
      if (job.labour.some(function (l) { return l.rateId === r.id; })) return;
      // Older jobs may have this type without a rateId: match by name.
      var byName = job.labour.find(function (l) {
        return !l.rateId && String(l.name).trim().toLowerCase() === String(r.name).trim().toLowerCase();
      });
      if (byName) { byName.rateId = r.id; return; }
      job.labour.push({ id: Q.uid(), rateId: r.id, name: r.name, description: "", unit: r.unit || "Hrs",
        qty: 0, cost: Q.num(r.cost), price: Q.num(r.rate), markup: 0 });
    });
    var order = state.catalog.labourRates.map(function (r) { return r.id; });
    job.labour.sort(function (a, b) {
      var ia = order.indexOf(a.rateId), ib = order.indexOf(b.rateId);
      return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
    });
  }

  function renderLabour() {
    syncLabourLines();
    var tbody = $("labBody");
    var known = {};
    state.catalog.labourRates.forEach(function (r) { known[r.id] = r; });
    tbody.innerHTML = job.labour.map(function (l) {
      var r = known[l.rateId];
      var label = r ? r.name : (l.name || "Labour");
      return '<tr data-row="' + Q.esc(l.id) + '"' + (Q.num(l.qty) ? "" : ' class="zero"') + '>' +
        '<td><strong>' + Q.esc(label) + '</strong>' + (r ? "" : ' <span class="muted">(no longer on Labour Rates)</span>') + '</td>' +
        '<td class="num col-qty">' + moneyInput("labour", l, "qty") + '</td>' +
        '<td class="num col-money">' + moneyInput("labour", l, "price") + '</td>' +
        '<td class="num col-total" data-linetotal="' + Q.esc(l.id) + '"></td>' +
        '<td class="col-del">' + (r ? "" : '<button type="button" class="icon-btn" data-del="labour" data-id="' + Q.esc(l.id) + '" title="Remove">&times;</button>') + '</td>' +
        '</tr>';
    }).join("");
  }

  function renderAddOns() {
    var tbody = $("addBody");
    if (!job.addOns.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-note">No add-ons.</td></tr>';
      return;
    }
    tbody.innerHTML = job.addOns.map(function (a) {
      return '<tr data-row="' + Q.esc(a.id) + '">' +
        '<td>' + textInput("addOns", a, "name") + '</td>' +
        '<td class="num col-money">' + moneyInput("addOns", a, "cost") + '</td>' +
        '<td class="num col-money">' + moneyInput("addOns", a, "amount") + '</td>' +
        '<td class="col-del"><button type="button" class="icon-btn" data-del="addOns" data-id="' + Q.esc(a.id) + '" title="Remove">&times;</button></td>' +
        '</tr>';
    }).join("");
  }

  function renderExpenses() {
    var tbody = $("expBody");
    if (!job.expenses.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-note">No costs logged yet.</td></tr>';
      return;
    }
    tbody.innerHTML = job.expenses.map(function (x) {
      return '<tr data-row="' + Q.esc(x.id) + '">' +
        '<td><input type="date" data-list="expenses" data-id="' + Q.esc(x.id) + '" data-f="date" value="' + Q.esc(x.date) + '"></td>' +
        '<td><select data-list="expenses" data-id="' + Q.esc(x.id) + '" data-f="type">' +
          EXPENSE_TYPES.map(function (t) { return '<option' + (t === x.type ? " selected" : "") + '>' + Q.esc(t) + '</option>'; }).join("") +
        '</select></td>' +
        '<td>' + textInput("expenses", x, "description", "e.g. Polytec invoice #1234") + '</td>' +
        '<td class="num col-total">' + moneyInput("expenses", x, "amount") + '</td>' +
        '<td class="col-del"><button type="button" class="icon-btn" data-del="expenses" data-id="' + Q.esc(x.id) + '" title="Remove">&times;</button></td>' +
        '</tr>';
    }).join("");
  }

  function renderPickers() {
    var cat = state.catalog;
    var groups = {};
    cat.items.forEach(function (it) { (groups[it.category] = groups[it.category] || []).push(it); });
    var order = cat.categories.slice();
    Object.keys(groups).forEach(function (g) { if (order.indexOf(g) === -1) order.push(g); });
    $("matPicker").innerHTML = '<option value="">Choose a price list item…</option>' + order.filter(function (g) { return groups[g]; }).map(function (g) {
      return '<optgroup label="' + Q.esc(g) + '">' + groups[g].map(function (it) {
        return '<option value="' + Q.esc(it.id) + '">' + Q.esc(it.name) + ' – ' + Q.money(it.price) + '/' + Q.esc(it.unit) + '</option>';
      }).join("") + '</optgroup>';
    }).join("");
    $("addPicker").innerHTML = cat.addOnPresets.map(function (p) {
      return '<option value="' + Q.esc(p.id) + '">' + Q.esc(p.name) + (Q.num(p.amount) ? ' – ' + Q.money(p.amount) : "") + '</option>';
    }).join("") + '<option value="">Custom add-on</option>';
  }

  function renderFields() {
    $("f_status").innerHTML = Q.STATUSES.map(function (s) { return '<option>' + Q.esc(s) + '</option>'; }).join("");
    document.querySelectorAll("[data-field]").forEach(function (el) {
      el.value = job[el.getAttribute("data-field")] || "";
    });
    $("quoteNoLabel").textContent = job.quoteNo || "";
    $("jobTitle").textContent = job.name || "New job";
    document.title = (job.name || "Job") + " – Job Quotes";
    $("viewQuoteBtn").href = "quote.html?id=" + encodeURIComponent(job.id);
  }

  function buildSummary() {
    var tax = state.catalog.settings.taxName || "Tax";
    $("summaryTable").innerHTML =
      row("Materials", "s_mat") + row("Labour", "s_lab") + row("Add-ons", "s_add") +
      '<tr class="strong"><td>Items total</td><td id="s_items"></td></tr>' +
      '<tr><td>Margin <input class="pct-input" data-pct="marginPct" type="number" step="0.1" inputmode="decimal"> %</td><td id="s_margin"></td></tr>' +
      '<tr class="strong"><td>Subtotal</td><td id="s_sub"></td></tr>' +
      '<tr><td>' + Q.esc(tax) + ' <input class="pct-input" data-pct="taxPct" type="number" step="0.1" inputmode="decimal"> %</td><td id="s_tax"></td></tr>' +
      '<tr class="strong big"><td>Total</td><td id="s_total"></td></tr>' +
      '<tr><td>Deposit <input class="pct-input" data-pct="depositPct" type="number" step="1" inputmode="decimal"> %</td><td id="s_dep"></td></tr>' +
      row("Balance due", "s_bal") +
      '<tr class="sep"><td colspan="2"></td></tr>' +
      '<tr><td class="muted">Est. cost</td><td id="s_cost" class="muted"></td></tr>' +
      '<tr class="strong"><td>Est. profit</td><td id="s_profit"></td></tr>' +
      '<tr><td class="muted">Spent so far</td><td id="s_actual" class="muted"></td></tr>' +
      '<tr><td class="muted">Profit after spend</td><td id="s_actprofit"></td></tr>';
    function row(label, id) { return '<tr><td>' + label + '</td><td id="' + id + '"></td></tr>'; }
    document.querySelectorAll("[data-pct]").forEach(function (el) { el.value = job[el.getAttribute("data-pct")]; });
  }

  // Refresh every computed number without touching inputs (keeps focus).
  function updateNumbers() {
    var c = Q.calcJob(job);
    var set = function (id, v) { var el = $(id); if (el) el.textContent = v; };
    set("s_mat", Q.money(c.materials)); set("s_lab", Q.money(c.labour)); set("s_add", Q.money(c.addOns));
    set("s_items", Q.money(c.itemsTotal)); set("s_margin", Q.money(c.margin)); set("s_sub", Q.money(c.subtotal));
    set("s_tax", Q.money(c.tax)); set("s_total", Q.money(c.total)); set("s_dep", Q.money(c.deposit));
    set("s_bal", Q.money(c.balance)); set("s_cost", Q.money(c.cost));
    set("s_profit", Q.money(c.profit) + " (" + c.profitPct.toFixed(1) + "%)");
    $("s_profit").className = c.profit >= 0 ? "pos" : "neg";
    set("s_actual", Q.money(c.actual));
    set("s_actprofit", c.actual ? Q.money(c.actualProfit) : "–");
    $("s_actprofit").className = !c.actual ? "muted" : (c.actualProfit >= 0 ? "pos" : "neg");

    set("matTotal", Q.money(c.materials)); set("labTotal", Q.money(c.labour)); set("labHours", c.hours);
    set("addTotal", Q.money(c.addOns)); set("expTotal", Q.money(c.actual)); set("expBudget", Q.money(c.cost));

    var catTotals = {};
    job.materials.concat(job.labour).forEach(function (l) {
      var cell = document.querySelector('[data-linetotal="' + cssEsc(l.id) + '"]');
      if (cell) cell.textContent = Q.money(Q.lineSell(l));
      if (l.category != null) catTotals[l.category] = (catTotals[l.category] || 0) + Q.lineSell(l);
    });
    document.querySelectorAll("[data-cattotal]").forEach(function (el) {
      el.textContent = Q.money(catTotals[el.getAttribute("data-cattotal")] || 0);
    });
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'); }

  function renderAll() {
    renderFields();
    renderPickers();
    renderMaterials();
    renderLabour();
    renderAddOns();
    renderExpenses();
    buildSummary();
    updateNumbers();
  }

  // ---------------------------------------------------------------- events
  document.querySelectorAll("[data-field]").forEach(function (el) {
    el.addEventListener("input", function () {
      job[el.getAttribute("data-field")] = el.value;
      if (el.id === "f_name") { $("jobTitle").textContent = el.value || "New job"; }
      if (el.id === "f_quoteNo") { $("quoteNoLabel").textContent = el.value; }
      changed();
    });
  });

  var NUMERIC = { qty: 1, cost: 1, price: 1, markup: 1, amount: 1 };
  $("jobLayout").addEventListener("input", function (e) {
    var el = e.target;
    var pct = el.getAttribute("data-pct");
    if (pct) { job[pct] = Q.num(el.value); updateNumbers(); changed(); return; }
    var list = el.getAttribute("data-list");
    if (!list) return;
    var line = job[list].find(function (l) { return l.id === el.getAttribute("data-id"); });
    if (!line) return;
    var f = el.getAttribute("data-f");
    line[f] = NUMERIC[f] ? (el.value === "" ? "" : Q.num(el.value)) : el.value;
    if ((list === "materials" || list === "labour") && f === "qty") {
      var tr = el.closest("tr");
      if (tr) tr.classList.toggle("zero", !Q.num(line.qty));
    }
    updateNumbers();
    changed();
  });
  $("jobLayout").addEventListener("change", function (e) {
    // <select> in expenses fires change, not always input
    if (e.target.tagName === "SELECT" && e.target.getAttribute("data-list")) {
      e.target.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  $("jobLayout").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-del]");
    if (!btn) return;
    var list = btn.getAttribute("data-del");
    job[list] = job[list].filter(function (l) { return l.id !== btn.getAttribute("data-id"); });
    rerender(list);
    changed();
  });

  function rerender(list) {
    if (list === "materials") renderMaterials();
    if (list === "labour") renderLabour();
    if (list === "addOns") renderAddOns();
    if (list === "expenses") renderExpenses();
    updateNumbers();
  }

  function fromItem(it) {
    return { id: Q.uid(), itemId: it.id, category: it.category, name: it.name, description: it.description || "",
      unit: it.unit, qty: 1, cost: Q.num(it.cost), price: Q.num(it.price), markup: 0 };
  }
  function focusRow(id, field) {
    var el = document.querySelector('[data-id="' + cssEsc(id) + '"][data-f="' + field + '"]');
    if (el) { el.focus(); if (el.select) el.select(); }
  }

  $("matAddBtn").addEventListener("click", function () {
    var id = $("matPicker").value;
    var it = state.catalog.items.find(function (x) { return x.id === id; });
    if (!it) { $("matPicker").focus(); return; }
    var existing = job.materials.find(function (l) { return l.itemId === it.id; });
    if (existing) { focusRow(existing.id, "qty"); return; }
    var line = fromItem(it);
    job.materials.push(line);
    rerender("materials"); changed();
    focusRow(line.id, "qty");
  });
  $("matPicker").addEventListener("change", function () { $("matAddBtn").click(); });
  $("matCustomBtn").addEventListener("click", function () {
    var line = { id: Q.uid(), itemId: null, category: "Other", name: "", description: "", unit: "#", qty: 1, cost: 0, price: 0, markup: 0 };
    job.materials.push(line);
    rerender("materials"); changed();
    focusRow(line.id, "name");
  });
  $("matAllBtn").addEventListener("click", function () {
    var have = {};
    job.materials.forEach(function (l) { if (l.itemId) have[l.itemId] = 1; });
    var added = 0;
    state.catalog.items.forEach(function (it) {
      if (have[it.id]) return;
      var l = fromItem(it); l.qty = 0;
      job.materials.push(l); added++;
    });
    rerender("materials");
    if (added) changed();
  });
  $("matRefreshBtn").addEventListener("click", function () {
    var byId = {};
    state.catalog.items.forEach(function (it) { byId[it.id] = it; });
    var n = 0;
    job.materials.forEach(function (l) {
      var it = byId[l.itemId];
      if (it && (Q.num(l.price) !== Q.num(it.price) || Q.num(l.cost) !== Q.num(it.cost))) {
        l.price = Q.num(it.price); l.cost = Q.num(it.cost); n++;
      }
    });
    job.labour.forEach(function (l) {
      var r = state.catalog.labourRates.find(function (x) { return x.id === l.rateId; });
      if (r && (Q.num(l.price) !== Q.num(r.rate) || Q.num(l.cost) !== Q.num(r.cost))) {
        l.price = Q.num(r.rate); l.cost = Q.num(r.cost); n++;
      }
    });
    rerender("materials"); rerender("labour");
    if (n) changed();
    saveStateEl.textContent = n ? n + " line(s) updated to current prices" : "Prices already up to date";
  });
  $("matClearZeroBtn").addEventListener("click", function () {
    var before = job.materials.length;
    job.materials = job.materials.filter(function (l) { return Q.num(l.qty) !== 0; });
    if (job.materials.length !== before) { rerender("materials"); changed(); }
  });

  $("addAddBtn").addEventListener("click", function () {
    var id = $("addPicker").value;
    var p = state.catalog.addOnPresets.find(function (x) { return x.id === id; });
    var a = { id: Q.uid(), name: p ? p.name : "", cost: 0, amount: p ? Q.num(p.amount) : 0 };
    job.addOns.push(a);
    rerender("addOns"); changed();
    focusRow(a.id, p ? "amount" : "name");
  });

  $("expAddBtn").addEventListener("click", function () {
    var x = { id: Q.uid(), date: Q.todayISO(), type: "Materials", description: "", amount: "" };
    job.expenses.push(x);
    rerender("expenses"); changed();
    focusRow(x.id, "description");
  });

  $("viewQuoteBtn").addEventListener("click", function (e) {
    e.preventDefault();
    saveThenGo("quote.html?id=" + encodeURIComponent(job.id));
  });

  $("delJobBtn").addEventListener("click", function () {
    if (!confirm('Delete "' + (job.name || job.quoteNo) + '"? This can\'t be undone.')) return;
    saveSoon.cancel(); dirty = false;
    var done = false;
    function go() { if (!done) { done = true; window.location.href = "index.html"; } }
    Promise.resolve(QuoteStore.deleteJob(job.id)).then(go, go);
    setTimeout(go, 1200);
  });

  $("dupJobBtn").addEventListener("click", function () {
    flush();
    var copy = Q.clone(job);
    var fresh = Q.newJob(state.catalog);
    copy.id = fresh.id; copy.quoteNo = fresh.quoteNo; copy.status = "Draft"; copy.date = fresh.date;
    copy.name = (job.name || "Job") + " (copy)"; copy.expenses = []; copy.createdAt = Date.now(); copy.rev = null;
    var cat = Q.clone(state.catalog);
    cat.settings.nextQuoteNumber = (Q.num(cat.settings.nextQuoteNumber) || 1) + 1;
    QuoteStore.saveCatalog(cat);
    QuoteStore.saveJob(copy);
    saveThenGo("job.html?id=" + encodeURIComponent(copy.id));
  });

  // ------------------------------------------------------------------ load
  function normaliseJob(j) {
    ["materials", "labour", "addOns", "expenses"].forEach(function (k) { if (!Array.isArray(j[k])) j[k] = []; });
    return j;
  }

  QuoteStore.init({
    onStatus: Q.setSyncStatus,
    onChange: function (s) {
      state = s;
      var incoming = s.jobs[jobId];
      if (!incoming) {
        if (!job) { $("notFound").classList.remove("hidden"); }
        return;
      }
      $("notFound").classList.add("hidden");
      $("jobLayout").classList.remove("hidden");
      // Ignore the echo of our own save, and don't clobber unsaved typing.
      if (job && (dirty || incoming.rev === lastRev)) {
        renderPickers();
        return;
      }
      job = normaliseJob(Q.clone(incoming));
      renderAll();
      if (firstRender) {
        firstRender = false;
        saveStateEl.textContent = "Changes save automatically";
        if (Q.param("new")) { $("f_name").focus(); }
      }
    }
  });
})();
