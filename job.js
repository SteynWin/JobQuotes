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

  // Materials & hardware has two kinds of line:
  //  - PRICE LIST items: name, unit and price come from the Price List and
  //    can't be changed here - only the quantity. No cost/markup shown.
  //    (Prices follow the Price List until the job is Accepted or later.)
  //  - EXTRA items added to this job only: name, unit, cost and markup %
  //    are entered here (price = cost + markup), with a button to save the
  //    item to the Price List, after which it becomes a price list line.
  // Every line has an editable description for extra info on this job:
  // Price List lines keep it in "note" (the Price List description shows
  // as the placeholder and is used on the quote when no note is typed).
  // Extra lines store their cost in both "cost" and "price" and the markup
  // in "markup", so the shared quote maths (qty x price x (1 + markup%))
  // gives the marked-up price.
  function catalogItem(l) {
    return l.itemId ? state.catalog.items.find(function (x) { return x.id === l.itemId; }) : null;
  }
  function syncMaterialLines() {
    var before = JSON.stringify(job.materials);
    job.materials.forEach(function (l) {
      var it = catalogItem(l);
      if (it) {
        if (!FROZEN[job.status]) {
          l.name = it.name; l.description = it.description || ""; l.unit = it.unit; l.category = it.category;
          l.price = Q.num(it.price); l.cost = Q.num(it.cost); l.markup = 0;
        }
      } else if (l.itemId) {
        // Item was deleted from the Price List: keep the line as an extra
        // item at the same sell price, expressed as cost + markup.
        var cost = Q.num(l.cost) || Q.num(l.price);
        var sell = Q.num(l.price) * (1 + Q.num(l.markup) / 100);
        l.itemId = null; l.cost = cost; l.price = cost;
        l.markup = cost ? Q.round2((sell / cost - 1) * 100) : 0;
      }
    });
    return JSON.stringify(job.materials) !== before;
  }

  // <option>s for a row's Item dropdown: every Price List item grouped by
  // category, plus "New item" for something that isn't on the list.
  var NEW_ITEM = "__new";
  function itemOptions(selectedId, isNew) {
    var cat = state.catalog, groups = {};
    cat.items.forEach(function (it) { (groups[it.category] = groups[it.category] || []).push(it); });
    var order = cat.categories.slice();
    Object.keys(groups).forEach(function (g) { if (order.indexOf(g) === -1) order.push(g); });
    return '<option value=""' + (!selectedId && !isNew ? " selected" : "") + ' disabled>Choose an item…</option>' +
      order.filter(function (g) { return groups[g]; }).map(function (g) {
        return '<optgroup label="' + Q.esc(g) + '">' + groups[g].map(function (it) {
          return '<option value="' + Q.esc(it.id) + '"' + (it.id === selectedId ? " selected" : "") + '>' +
            Q.esc(it.name) + '</option>';
        }).join("") + '</optgroup>';
      }).join("") +
      '<option value="' + NEW_ITEM + '"' + (isNew ? " selected" : "") + '>➕ New item (not in Price List)…</option>';
  }
  function itemSelect(l, isNew) {
    return '<select class="item-select" data-list="materials" data-id="' + Q.esc(l.id) + '" data-f="pick">' +
      itemOptions(l.itemId, isNew) + '</select>';
  }

  function categoryOptions(selected) {
    var cats = state.catalog.categories.slice();
    if (selected && cats.indexOf(selected) === -1) cats.push(selected);
    return cats.map(function (c) { return '<option' + (c === selected ? " selected" : "") + '>' + Q.esc(c) + '</option>'; }).join("");
  }

  function renderMaterials() {
    if (syncMaterialLines()) changed();
    var tbody = $("matBody");
    var lines = job.materials.slice();
    if (!lines.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-note">No materials yet. Pick a Price List item below, or add the whole price list and type in quantities.</td></tr>';
      return;
    }
    // Lines still waiting for an item to be chosen go last.
    var groupOf = function (l) { return l.pending ? "\u0000new" : l.category; };
    lines.sort(function (a, b) {
      return (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || catIndex(a.category) - catIndex(b.category);
    });
    var html = "", lastCat = null;
    lines.forEach(function (l) {
      if (groupOf(l) !== lastCat) {
        lastCat = groupOf(l);
        html += '<tr class="cat-row"><td colspan="5">' + Q.esc(l.pending ? "New lines – choose an item" : (l.category || "Other")) + '</td>' +
          '<td class="num" data-cattotal="' + Q.esc(l.category) + '"></td><td></td></tr>';
      }
      var linked = !!catalogItem(l);
      var del = '<button type="button" class="icon-btn" data-del="materials" data-id="' + Q.esc(l.id) + '" title="Remove">&times;</button>';
      if (l.pending) {
        html += '<tr data-row="' + Q.esc(l.id) + '" class="pending-row">' +
          '<td colspan="2">' + itemSelect(l, false) + '</td>' +
          '<td class="num col-qty">' + moneyInput("materials", l, "qty") + '</td>' +
          '<td colspan="3" class="muted">Pick an item from the Price List, or choose “New item”.</td>' +
          '<td class="col-del">' + del + '</td></tr>';
      } else if (linked) {
        html += '<tr data-row="' + Q.esc(l.id) + '"' + (Q.num(l.qty) ? "" : ' class="zero"') + '>' +
          '<td>' + itemSelect(l, false) + '</td>' +
          '<td>' + textInput("materials", l, "note", l.description || "Extra info (optional)") + '</td>' +
          '<td class="num col-qty">' + moneyInput("materials", l, "qty") + '</td>' +
          '<td class="col-unit">' + Q.esc(l.unit) + '</td>' +
          '<td class="num col-money">' + Q.money(l.price) + '</td>' +
          '<td class="num col-total" data-linetotal="' + Q.esc(l.id) + '"></td>' +
          '<td class="col-del">' + del + '</td>' +
          '</tr>';
      } else {
        html += '<tr data-row="' + Q.esc(l.id) + '" class="extra-row' + (Q.num(l.qty) ? "" : " zero") + '">' +
          '<td>' + itemSelect(l, true) + textInput("materials", l, "name", "New item name") +
            '<div class="new-item-pricing">' +
              '<label>Cost ' + moneyInput("materials", l, "cost") + '</label>' +
              '<label>+ Markup ' + moneyInput("materials", l, "markup") + ' %</label>' +
            '</div></td>' +
          '<td>' + textInput("materials", l, "description", "Description (optional)") +
            '<select class="cat-select" data-list="materials" data-id="' + Q.esc(l.id) + '" data-f="category" title="Category">' + categoryOptions(l.category) + '</select></td>' +
          '<td class="num col-qty">' + moneyInput("materials", l, "qty") + '</td>' +
          '<td class="col-unit">' + textInput("materials", l, "unit") + '</td>' +
          '<td class="num col-money" data-unitprice="' + Q.esc(l.id) + '"></td>' +
          '<td class="num col-total" data-linetotal="' + Q.esc(l.id) + '"></td>' +
          '<td class="col-del"><button type="button" class="small-btn save-item-btn" data-saveitem="' + Q.esc(l.id) + '" title="Save this item to the Price List">Save to list</button>' + del + '</td>' +
          '</tr>';
      }
    });
    tbody.innerHTML = html;
  }

  // Labour has two parts:
  //  - the four STANDARD types (Labour, Machining, Assembly, Installation):
  //    always shown on every job, at the rate set on the Labour Rates page
  //    (not editable here). Once a job is Accepted or later its rates are
  //    frozen, so changing your rates never alters work already agreed.
  //  - OTHER labour added to this job only (e.g. Sanding, Cleaning), picked
  //    from the extra types set up in Settings - also at the Settings rate.
  // No labour rate can be edited on the job page.
  var FROZEN = { "Accepted": 1, "In Progress": 1, "Completed": 1 };
  function isStandard(l) {
    var r = state.catalog.labourRates.find(function (x) { return x.id === l.rateId; });
    return !!(r && Q.fixedLabourKey(r));
  }
  function syncLabourLines() {
    var before = JSON.stringify(job.labour);
    var standard = state.catalog.labourRates.filter(function (r) { return Q.fixedLabourKey(r); });
    // Other labour picked from Settings follows its Settings rate too.
    if (!FROZEN[job.status]) {
      job.labour.forEach(function (l) {
        var r = state.catalog.labourRates.find(function (x) { return x.id === l.rateId; });
        if (r && !Q.fixedLabourKey(r)) {
          l.name = r.name; l.unit = r.unit || "Hrs"; l.price = Q.num(r.rate); l.cost = Q.num(r.cost); l.markup = 0;
        }
      });
    }
    standard.forEach(function (r) {
      var line = job.labour.find(function (l) { return l.rateId === r.id; }) ||
        job.labour.find(function (l) {
          return !l.rateId && String(l.name).trim().toLowerCase() === String(r.name).trim().toLowerCase();
        });
      if (!line) {
        // Cutters is charged once per job, so new jobs start at 1 - unless
        // the job already charges Cutters as an add-on (older jobs).
        var flat = Q.fixedLabourKey(r) === "cutters" &&
          !job.addOns.some(function (a) { return /^cutter/i.test(String(a.name || "").trim()) && Q.num(a.amount); });
        line = { id: Q.uid(), rateId: r.id, name: r.name, description: "", unit: r.unit || "Hrs", qty: flat ? 1 : 0, cost: 0, price: 0, markup: 0 };
        job.labour.push(line);
      }
      line.rateId = r.id;
      if (!FROZEN[job.status]) {
        line.name = r.name; line.unit = r.unit || "Hrs"; line.price = Q.num(r.rate); line.cost = Q.num(r.cost); line.markup = 0;
      }
    });
    var order = standard.map(function (r) { return r.id; });
    job.labour.sort(function (a, b) {
      var ia = order.indexOf(a.rateId), ib = order.indexOf(b.rateId);
      return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
    });
    return JSON.stringify(job.labour) !== before;
  }
  // Earlier versions auto-added a 0-hour row for every labour type; drop
  // those empty non-standard rows once, when the job is loaded.
  function dropEmptyAutoLabour() {
    job.labour = job.labour.filter(function (l) {
      return isStandard(l) || Q.num(l.qty) !== 0 || !l.rateId;
    });
  }

  function renderLabour() {
    // If the standard rates changed (or a row was added), save it so the
    // printed quote uses the same numbers shown here.
    if (syncLabourLines()) changed();
    var tbody = $("labBody");
    tbody.innerHTML = job.labour.map(function (l) {
      var std = isStandard(l);
      return '<tr data-row="' + Q.esc(l.id) + '"' + (Q.num(l.qty) ? "" : ' class="zero"') + '>' +
        '<td><strong>' + Q.esc(l.name || "Labour") + '</strong>' +
          (/^(hrs?|hours?)$/i.test(l.unit || "Hrs") ? "" : ' <span class="muted">(per ' + Q.esc(String(l.unit).toLowerCase()) + ')</span>') + '</td>' +
        '<td class="num col-qty">' + moneyInput("labour", l, "qty") + '</td>' +
        '<td class="num col-money">' + Q.money(l.price) + '</td>' +
        '<td class="num col-total" data-linetotal="' + Q.esc(l.id) + '"></td>' +
        '<td class="col-del">' + (std ? "" : '<button type="button" class="icon-btn" data-del="labour" data-id="' + Q.esc(l.id) + '" title="Remove">&times;</button>') + '</td>' +
        '</tr>';
    }).join("");
  }

  // Permanent add-ons (Design) always have a row on every job, at the
  // charge/cost set on the Labour Rates page, with a tick box to include
  // or leave it out for this job. Other add-ons are added and edited here.
  function isFixedAddOn(a) {
    var p = state.catalog.addOnPresets.find(function (x) { return x.id === a.presetId; });
    return !!(p && Q.fixedAddOnKey(p));
  }
  function syncAddOns() {
    var before = JSON.stringify(job.addOns);
    var fixed = state.catalog.addOnPresets.filter(function (p) { return Q.fixedAddOnKey(p); });
    fixed.forEach(function (p) {
      var line = job.addOns.find(function (a) { return a.presetId === p.id; }) ||
        job.addOns.find(function (a) { return !a.presetId && Q.fixedAddOnKey({ name: a.name }) === Q.fixedAddOnKey(p); });
      if (!line) {
        // New and draft jobs include it; older quotes aren't changed silently.
        line = { id: Q.uid(), presetId: p.id, name: p.name, cost: 0, amount: 0, included: job.status === "Draft" };
        job.addOns.push(line);
      }
      line.presetId = p.id;
      if (line.included === undefined) line.included = true;
      if (!FROZEN[job.status]) { line.name = p.name; line.amount = Q.num(p.amount); line.cost = Q.num(p.cost); }
    });
    var order = fixed.map(function (p) { return p.id; });
    job.addOns.sort(function (a, b) {
      var ia = order.indexOf(a.presetId), ib = order.indexOf(b.presetId);
      return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
    });
    return JSON.stringify(job.addOns) !== before;
  }

  function renderAddOns() {
    if (syncAddOns()) changed();
    var tbody = $("addBody");
    if (!job.addOns.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-note">No add-ons.</td></tr>';
      return;
    }
    tbody.innerHTML = job.addOns.map(function (a) {
      if (isFixedAddOn(a)) {
        var on = a.included !== false;
        return '<tr data-row="' + Q.esc(a.id) + '"' + (on ? "" : ' class="zero"') + '>' +
          '<td><label class="include-toggle"><input type="checkbox" data-list="addOns" data-id="' + Q.esc(a.id) + '" data-f="included"' +
            (on ? " checked" : "") + '> <strong>' + Q.esc(a.name) + '</strong> <span class="muted">' + (on ? "(included)" : "(not included)") + '</span></label></td>' +
          '<td class="num col-money">' + Q.money(a.cost) + '</td>' +
          '<td class="num col-money">' + Q.money(a.amount) + '</td>' +
          '<td class="col-del"></td></tr>';
      }
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
      tbody.innerHTML = '<tr><td colspan="6" class="empty-note">No extra costs or variations yet.</td></tr>';
      return;
    }
    tbody.innerHTML = job.expenses.map(function (x) {
      return '<tr data-row="' + Q.esc(x.id) + '">' +
        '<td><input type="date" data-list="expenses" data-id="' + Q.esc(x.id) + '" data-f="date" value="' + Q.esc(x.date) + '"></td>' +
        '<td><select data-list="expenses" data-id="' + Q.esc(x.id) + '" data-f="type">' +
          EXPENSE_TYPES.map(function (t) { return '<option' + (t === x.type ? " selected" : "") + '>' + Q.esc(t) + '</option>'; }).join("") +
        '</select></td>' +
        '<td>' + textInput("expenses", x, "description", "e.g. Extra benchtop cut-out") + '</td>' +
        '<td class="num col-money">' + moneyInput("expenses", x, "amount") + '</td>' +
        '<td class="num col-money">' + moneyInput("expenses", x, "charge") + '</td>' +
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
    var others = cat.labourRates.filter(function (r) { return !Q.fixedLabourKey(r); });
    $("labPicker").innerHTML = others.length ? others.map(function (r) {
      return '<option value="' + Q.esc(r.id) + '">' + Q.esc(r.name) + ' – ' + Q.money(r.rate) + '/' + Q.esc(r.unit || "Hrs") + '</option>';
    }).join("") : '<option value="">No other labour types – add them in Settings</option>';
    $("labPicker").disabled = !others.length;
    $("labAddBtn").disabled = !others.length;
    $("addPicker").innerHTML = cat.addOnPresets.filter(function (p) { return !Q.fixedAddOnKey(p); }).map(function (p) {
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
      '<tr><td>Overheads &amp; margin <input class="pct-input" data-pct="marginPct" type="number" step="0.1" inputmode="decimal"> %</td><td id="s_margin"></td></tr>' +
      '<tr><td>Variations (charged to client)</td><td id="s_var"></td></tr>' +
      '<tr class="strong"><td>Subtotal</td><td id="s_sub"></td></tr>' +
      '<tr><td>' + Q.esc(tax) + ' <input class="pct-input" data-pct="taxPct" type="number" step="0.1" inputmode="decimal"> %</td><td id="s_tax"></td></tr>' +
      '<tr class="strong big"><td>Total</td><td id="s_total"></td></tr>' +
      '<tr><td>Deposit <input class="pct-input" data-pct="depositPct" type="number" step="1" inputmode="decimal"> %</td><td id="s_dep"></td></tr>' +
      row("Balance due", "s_bal") +
      '<tr class="sep"><td colspan="2"></td></tr>' +
      '<tr><td class="muted">Est. cost</td><td id="s_cost" class="muted"></td></tr>' +
      '<tr class="strong"><td>Est. profit</td><td id="s_profit"></td></tr>' +
      '<tr><td class="muted">Extra costs &amp; variations</td><td id="s_actual" class="muted"></td></tr>' +
      '<tr><td class="muted">Profit after extras</td><td id="s_actprofit"></td></tr>';
    function row(label, id) { return '<tr><td>' + label + '</td><td id="' + id + '"></td></tr>'; }
    document.querySelectorAll("[data-pct]").forEach(function (el) { el.value = job[el.getAttribute("data-pct")]; });
  }

  // Refresh every computed number without touching inputs (keeps focus).
  function updateNumbers() {
    var c = Q.calcJob(job);
    var set = function (id, v) { var el = $(id); if (el) el.textContent = v; };
    set("s_mat", Q.money(c.materials)); set("s_lab", Q.money(c.labour)); set("s_add", Q.money(c.addOns));
    set("s_items", Q.money(c.itemsTotal)); set("s_margin", Q.money(c.margin)); set("s_var", Q.money(c.variations)); set("s_sub", Q.money(c.subtotal));
    set("s_tax", Q.money(c.tax)); set("s_total", Q.money(c.total)); set("s_dep", Q.money(c.deposit));
    set("s_bal", Q.money(c.balance)); set("s_cost", Q.money(c.cost));
    set("s_profit", Q.money(c.profit) + " (" + c.profitPct.toFixed(1) + "%)");
    $("s_profit").className = c.profit >= 0 ? "pos" : "neg";
    set("s_actual", Q.money(c.actual));
    set("s_actprofit", c.actual ? Q.money(c.actualProfit) : "–");
    $("s_actprofit").className = !c.actual ? "muted" : (c.actualProfit >= 0 ? "pos" : "neg");

    set("matTotal", Q.money(c.materials)); set("labTotal", Q.money(c.labour)); set("labHours", c.hours);
    set("addTotal", Q.money(c.addOns)); set("expTotal", Q.money(c.actual)); set("expCharge", Q.money(c.variations));

    var catTotals = {};
    job.materials.concat(job.labour).forEach(function (l) {
      var cell = document.querySelector('[data-linetotal="' + cssEsc(l.id) + '"]');
      if (cell) cell.textContent = Q.money(Q.lineSell(l));
      if (l.category != null) catTotals[l.category] = (catTotals[l.category] || 0) + Q.lineSell(l);
    });
    job.materials.forEach(function (l) {
      var cell = document.querySelector('[data-unitprice="' + cssEsc(l.id) + '"]');
      if (cell) cell.textContent = Q.money(Q.num(l.price) * (1 + Q.num(l.markup) / 100));
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
      if (el.id === "f_status") { renderMaterials(); renderLabour(); renderAddOns(); updateNumbers(); }
      changed();
    });
  });

  var NUMERIC = { qty: 1, cost: 1, price: 1, markup: 1, amount: 1, charge: 1 };
  $("jobLayout").addEventListener("input", function (e) {
    var el = e.target;
    var pct = el.getAttribute("data-pct");
    if (pct) { job[pct] = Q.num(el.value); updateNumbers(); changed(); return; }
    var list = el.getAttribute("data-list");
    if (!list) return;
    var line = job[list].find(function (l) { return l.id === el.getAttribute("data-id"); });
    if (!line) return;
    var f = el.getAttribute("data-f");
    if (el.type === "checkbox") {
      line[f] = el.checked;
      rerender(list); changed();
      return;
    }
    line[f] = NUMERIC[f] ? (el.value === "" ? "" : Q.num(el.value)) : el.value;
    if (list === "materials" && f === "cost") line.price = line.cost;
    if (list === "materials" && f === "category") { rerender("materials"); changed(); return; }
    if (list === "materials" && f === "pick") { pickItem(line, el.value); return; }
    if ((list === "materials" || list === "labour") && f === "qty") {
      var tr = el.closest("tr");
      if (tr) tr.classList.toggle("zero", !Q.num(line.qty));
    }
    updateNumbers();
    changed();
  });
  $("jobLayout").addEventListener("change", function (e) {
    // <select> in expenses fires change, not always input
    if ((e.target.tagName === "SELECT" || e.target.type === "checkbox") && e.target.getAttribute("data-list")) {
      e.target.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  $("jobLayout").addEventListener("click", function (e) {
    var save = e.target.closest("[data-saveitem]");
    if (save) { saveToPriceList(save.getAttribute("data-saveitem")); return; }
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

  $("matLineBtn").addEventListener("click", function () {
    var line = { id: Q.uid(), itemId: null, pending: true, category: "", name: "", description: "", unit: "#",
      qty: 1, cost: 0, price: 0, markup: 0 };
    job.materials.push(line);
    rerender("materials"); changed();
    var sel = document.querySelector('[data-id="' + cssEsc(line.id) + '"][data-f="pick"]');
    if (sel) { sel.focus(); if (sel.showPicker) { try { sel.showPicker(); } catch (e) { /* not allowed */ } } }
  });

  function pickItem(line, value) {
    delete line.pick;
    line.pending = false;
    if (value === NEW_ITEM) {
      line.itemId = null; line.name = ""; line.description = ""; line.unit = "#";
      line.cost = 0; line.price = 0; line.markup = 0;
      if (!line.category || state.catalog.categories.indexOf(line.category) === -1) {
        line.category = state.catalog.categories.indexOf("Other") !== -1 ? "Other" : (state.catalog.categories[0] || "Other");
      }
      rerender("materials"); changed();
      focusRow(line.id, "name");
      return;
    }
    var it = state.catalog.items.find(function (x) { return x.id === value; });
    if (!it) return;
    line.itemId = it.id; line.markup = 0;
    line.name = it.name; line.description = it.description || ""; line.unit = it.unit; line.category = it.category;
    line.price = Q.num(it.price); line.cost = Q.num(it.cost);
    rerender("materials"); changed();
    focusRow(line.id, "qty");
  }

  function saveToPriceList(lineId) {
    var l = job.materials.find(function (x) { return x.id === lineId; });
    if (!l) return;
    var name = String(l.name || "").trim();
    if (!name) { alert("Give the item a name first."); focusRow(l.id, "name"); return; }
    var cat = Q.clone(state.catalog);
    var price = Q.round2(Q.num(l.cost) * (1 + Q.num(l.markup) / 100));
    var existing = cat.items.find(function (it) {
      return it.category === l.category && String(it.name).trim().toLowerCase() === name.toLowerCase();
    });
    if (existing) {
      if (!confirm('"' + name + '" is already in the Price List under ' + l.category + ' at ' + Q.money(existing.price) +
        '. Update it to cost ' + Q.money(l.cost) + ', price ' + Q.money(price) + '?')) return;
      existing.cost = Q.num(l.cost); existing.price = price; existing.unit = l.unit || existing.unit;
      if (l.description) existing.description = l.description;
    } else {
      existing = { id: Q.uid(), category: l.category || "Other", name: name, description: l.description || "",
        unit: l.unit || "#", cost: Q.num(l.cost), price: price };
      if (cat.categories.indexOf(existing.category) === -1) cat.categories.push(existing.category);
      cat.items.push(existing);
    }
    cat.rev = Q.uid();
    state.catalog = cat;
    QuoteStore.saveCatalog(cat);
    l.itemId = existing.id;
    renderPickers();
    rerender("materials"); changed();
    saveStateEl.textContent = '"' + name + '" saved to the Price List';
  }
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
  $("matClearZeroBtn").addEventListener("click", function () {
    var before = job.materials.length;
    job.materials = job.materials.filter(function (l) { return Q.num(l.qty) !== 0; });
    if (job.materials.length !== before) { rerender("materials"); changed(); }
  });

  $("labAddBtn").addEventListener("click", function () {
    var r = state.catalog.labourRates.find(function (x) { return x.id === $("labPicker").value; });
    if (!r) return;
    var line = { id: Q.uid(), rateId: r.id, name: r.name, description: "", unit: r.unit || "Hrs", qty: 0,
      cost: Q.num(r.cost), price: Q.num(r.rate), markup: 0 };
    job.labour.push(line);
    rerender("labour"); changed();
    focusRow(line.id, "qty");
  });

  $("addAddBtn").addEventListener("click", function () {
    var id = $("addPicker").value;
    var p = state.catalog.addOnPresets.find(function (x) { return x.id === id; });
    var a = { id: Q.uid(), name: p ? p.name : "", cost: p ? Q.num(p.cost) : 0, amount: p ? Q.num(p.amount) : 0 };
    job.addOns.push(a);
    rerender("addOns"); changed();
    focusRow(a.id, p ? "amount" : "name");
  });

  $("expAddBtn").addEventListener("click", function () {
    var x = { id: Q.uid(), date: Q.todayISO(), type: "Materials", description: "", amount: "", charge: "" };
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
        if (!dirty) { renderMaterials(); renderLabour(); renderAddOns(); updateNumbers(); }
        return;
      }
      job = normaliseJob(Q.clone(incoming));
      dropEmptyAutoLabour();
      renderAll();
      if (firstRender) {
        firstRender = false;
        saveStateEl.textContent = "Changes save automatically";
        if (Q.param("new")) { $("f_name").focus(); }
      }
    }
  });
})();
