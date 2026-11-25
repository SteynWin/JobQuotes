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
  var lastCatalogRev = null; // Price List / rates version last drawn

  // Redraw without losing the user's place: remember which box had focus
  // (and the cursor position), run the redraw, then focus it again.
  function keepFocus(redraw) {
    var el = document.activeElement, sel = null, start = null, end = null;
    if (el && el !== document.body) {
      if (el.getAttribute("data-id") && el.getAttribute("data-f")) {
        sel = '[data-id="' + cssEsc(el.getAttribute("data-id")) + '"][data-f="' + el.getAttribute("data-f") + '"]';
      } else if (el.getAttribute("data-pct")) {
        sel = '[data-pct="' + el.getAttribute("data-pct") + '"]';
      } else if (el.id) {
        sel = "#" + cssEsc(el.id);
      }
      try { start = el.selectionStart; end = el.selectionEnd; } catch (e) { /* not a text box */ }
    }
    var y = window.scrollY;
    redraw();
    if (sel) {
      var again = document.querySelector(sel);
      if (again && again !== document.activeElement) {
        again.focus({ preventScroll: true });
        try { if (start != null) again.setSelectionRange(start, end); } catch (e) { /* number inputs */ }
      }
    }
    window.scrollTo(0, y);
  }

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
        var flat = Q.fixedLabourKey(r) === "cutters" && job.status === "Draft" &&
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
    tbody.innerHTML = job.labour.filter(function (l) { return !Q.isInstallLine(l); }).map(function (l) {
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

  // Installation: the Installation Labour line, shown in its own section.
  // Hours are entered here; the rate is the Labour Rates one (locked).
  function renderInstall() {
    var l = job.labour.find(function (x) { return Q.isInstallLine(x); });
    $("instBody").innerHTML = !l ? '<tr><td colspan="4" class="empty-note">Add an Installation Labour rate on the Labour Rates page.</td></tr>' :
      '<tr data-row="' + Q.esc(l.id) + '"' + (Q.num(l.qty) ? "" : ' class="zero"') + '>' +
        '<td><strong>' + Q.esc(l.name) + '</strong></td>' +
        '<td class="num col-qty">' + moneyInput("labour", l, "qty") + '</td>' +
        '<td class="num col-money">' + Q.money(l.price) + '</td>' +
        '<td class="num col-total" data-linetotal="' + Q.esc(l.id) + '"></td>' +
      '</tr>';
  }

  // Design & delivery: fixed charges with their own section on every job.
  // The amounts come from the Labour Rates page (locked here, and frozen
  // once a job is Accepted or later); a tick box includes them or not.
  // Older jobs had them as add-on lines: those are moved here once.
  function syncFixed() {
    var before = JSON.stringify([job.fixedCharges, job.addOns]);
    if (!job.fixedCharges || typeof job.fixedCharges !== "object") job.fixedCharges = {};
    Q.FIXED_CHARGES.forEach(function (f) {
      var fc = job.fixedCharges[f.key];
      if (!fc) {
        var old = job.addOns.find(function (a) { return Q.fixedChargeKey(a.name) === f.key; });
        // Draft jobs include it; older quotes only if they already charged it.
        fc = { included: old ? old.included !== false && Q.num(old.amount) !== 0 : job.status === "Draft",
               amount: old ? Q.num(old.amount) : 0, cost: old ? Q.num(old.cost) : 0 };
        job.fixedCharges[f.key] = fc;
      }
      if (!FROZEN[job.status]) {
        var cfg = state.catalog.fixedCharges[f.key];
        fc.amount = Q.num(cfg.amount); fc.cost = Q.num(cfg.cost);
      }
    });
    // Moved elsewhere: Design/Delivery (here) and empty "Install" add-ons
    // (installation is now hours in its own section).
    job.addOns = job.addOns.filter(function (a) {
      return !Q.fixedChargeKey(a.name) && !(/^install/i.test(String(a.name || "").trim()) && !Q.num(a.amount) && !Q.num(a.cost));
    });
    return JSON.stringify([job.fixedCharges, job.addOns]) !== before;
  }

  function renderFixed() {
    if (syncFixed()) changed();
    $("fixedBody").innerHTML = Q.FIXED_CHARGES.map(function (f) {
      var fc = job.fixedCharges[f.key], on = !!fc.included;
      return '<tr' + (on ? "" : ' class="zero"') + '>' +
        '<td><label class="include-toggle"><input type="checkbox" data-fixed="' + f.key + '"' + (on ? " checked" : "") + '> ' +
          '<strong>' + Q.esc(f.name) + '</strong> <span class="muted">' + (on ? "(included)" : "(not included)") + '</span></label>' +
          (f.key === "delivery" ? ' <span class="muted small-note">added after GST</span>' : "") + '</td>' +
        '<td class="num col-money">' + Q.money(fc.cost) + '</td>' +
        '<td class="num col-money">' + Q.money(fc.amount) + '</td>' +
        '</tr>';
    }).join("");
  }

  function renderAddOns() {
    var tbody = $("addBody");
    if (!job.addOns.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-note">No extras.</td></tr>';
      return;
    }
    tbody.innerHTML = job.addOns.map(function (a) {
      return '<tr data-row="' + Q.esc(a.id) + '">' +
        '<td>' + textInput("addOns", a, "name", "Description, e.g. supplied appliance") + '</td>' +
        '<td class="num col-money">' + moneyInput("addOns", a, "cost") + '</td>' +
        '<td class="num col-pct">' + moneyInput("addOns", a, "markupPct") + '</td>' +
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
    $("approvalBtn").href = "approval.html?id=" + encodeURIComponent(job.id);
    $("approvalState").innerHTML = job.approval && job.approval.by
      ? '✔ Approved by ' + Q.esc(job.approval.by) + ' on ' + Q.esc(Q.fmtDate(job.approval.date)) : "Not yet approved by the office";
    $("approvalState").className = "approval-state" + (job.approval && job.approval.by ? " approved" : "");
  }

  function buildSummary() {
    var tax = state.catalog.settings.taxName || "Tax";
    $("summaryTable").innerHTML =
      row("Materials", "s_mat") + row("Labour", "s_lab") + row("Installation", "s_inst") + row("Design", "s_design") + row("Extras", "s_add") +
      '<tr class="strong"><td>Items total</td><td id="s_items"></td></tr>' +
      '<tr><td>Overheads &amp; margin <input class="pct-input" data-pct="marginPct" type="number" step="0.1" inputmode="decimal"> %</td><td id="s_margin"></td></tr>' +
      '<tr><td>Variations (charged to client)</td><td id="s_var"></td></tr>' +
      '<tr class="strong"><td>Subtotal</td><td id="s_sub"></td></tr>' +
      '<tr><td>' + Q.esc(tax) + ' <input class="pct-input" data-pct="taxPct" type="number" step="0.1" inputmode="decimal"> %</td><td id="s_tax"></td></tr>' +
      '<tr><td>Delivery <span class="muted">(after GST)</span></td><td id="s_deliv"></td></tr>' +
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
    set("s_mat", Q.money(c.materials)); set("s_lab", Q.money(c.labour)); set("s_add", Q.money(c.addOns)); set("s_design", Q.money(c.design)); set("s_deliv", Q.money(c.delivery));
    set("s_items", Q.money(c.itemsTotal)); set("s_margin", Q.money(c.margin)); set("s_var", Q.money(c.variations)); set("s_sub", Q.money(c.subtotal));
    set("s_tax", Q.money(c.tax)); set("s_total", Q.money(c.total)); set("s_dep", Q.money(c.deposit));
    set("s_bal", Q.money(c.balance)); set("s_cost", Q.money(c.cost));
    set("s_profit", Q.money(c.profit) + " (" + c.profitPct.toFixed(1) + "%)");
    $("s_profit").className = c.profit >= 0 ? "pos" : "neg";
    set("s_actual", Q.money(c.actual));
    set("s_actprofit", c.actual ? Q.money(c.actualProfit) : "–");
    $("s_actprofit").className = !c.actual ? "muted" : (c.actualProfit >= 0 ? "pos" : "neg");

    set("matTotal", Q.money(c.materials)); set("labTotal", Q.money(c.labour)); set("labHours", c.hours);
    set("s_inst", Q.money(c.installation)); set("instTotal", Q.money(c.installation)); set("instHours", c.installHours);
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
    renderInstall();
    renderFixed();
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
      if (el.id === "f_status") { renderMaterials(); renderLabour(); renderInstall(); renderFixed(); renderAddOns(); updateNumbers(); }
      changed();
    });
  });

  var NUMERIC = { qty: 1, cost: 1, price: 1, markup: 1, amount: 1, charge: 1, markupPct: 1 };
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
    // Extras: charge = cost + markup %. Changing cost or markup sets the
    // charge; typing a charge works out the markup instead.
    if (list === "addOns" && (f === "cost" || f === "markupPct" || f === "amount")) {
      var row = el.closest("tr");
      var setBox = function (field, v) {
        var box = row && row.querySelector('[data-f="' + field + '"]');
        if (box && box !== el) box.value = v;
      };
      if (f === "amount") {
        line.markupPct = Q.num(line.cost) && line.amount !== "" ? Q.round2((Q.num(line.amount) / Q.num(line.cost) - 1) * 100) : "";
        setBox("markupPct", line.markupPct);
      } else if (line.markupPct !== "" && line.markupPct != null && line.cost !== "") {
        line.amount = Q.round2(Q.num(line.cost) * (1 + Q.num(line.markupPct) / 100));
        setBox("amount", line.amount);
      }
    }
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
    var fk = e.target.getAttribute && e.target.getAttribute("data-fixed");
    if (fk) {
      job.fixedCharges[fk].included = e.target.checked;
      renderFixed(); updateNumbers(); changed();
      return;
    }
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
    if (list === "labour") { renderLabour(); renderInstall(); }
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
    var a = { id: Q.uid(), name: "", cost: "", amount: "" };
    job.addOns.push(a);
    rerender("addOns"); changed();
    focusRow(a.id, "name");
  });

  $("expAddBtn").addEventListener("click", function () {
    var x = { id: Q.uid(), date: Q.todayISO(), type: "Materials", description: "", amount: "", charge: "" };
    job.expenses.push(x);
    rerender("expenses"); changed();
    focusRow(x.id, "description");
  });

  $("approvalBtn").addEventListener("click", function (e) {
    e.preventDefault();
    saveThenGo("approval.html?id=" + encodeURIComponent(job.id));
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


  // ------------------------------------------------------------------ load
  function normaliseJob(j) {
    ["materials", "labour", "addOns", "expenses"].forEach(function (k) { if (!Array.isArray(j[k])) j[k] = []; });
    return j;
  }


  // ------------------------------------------------------- Mozaik import
  // Reads Mozaik's pricing-report CSV (Tax, Item, Description, QTY, Units,
  // Amount, Markup, Total). Category rows are un-indented with no QTY;
  // material rows are indented. Only names, descriptions, quantities and
  // units are used - Mozaik's prices are ignored (unless the user ticks
  // "use Mozaik price" for items new to the Price List). Labour rows
  // (Labor / Machining / Part Labor) can fill the job's labour hours.
  // Add-On rows and the totals are skipped: the app handles those itself.
  var mz = null;   // the parsed import waiting in the preview

  function normName(s) { return String(s || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function mzNum(v) { return Q.num(String(v == null ? "" : v).replace(/[$,\s]/g, "")); }

  function parseMozaik(text) {
    var rows = Q.parseCSV(String(text).replace(/^﻿/, ""));
    if (!rows.length) throw new Error("The file is empty.");
    var head = rows[0].map(function (h) { return normName(h); });
    var col = function (n) { return head.indexOf(n); };
    var ci = { tax: col("tax"), item: col("item"), desc: col("description"), qty: col("qty"), unit: col("units"), amount: col("amount") };
    if (ci.item === -1 || ci.qty === -1) throw new Error("This doesn't look like a Mozaik pricing CSV (no Item / QTY columns).");
    var out = { items: [], labour: [], skipped: 0 };
    var category = "Other";
    rows.slice(1).forEach(function (r) {
      var raw = r[ci.item] || "";
      var name = raw.replace(/\s+/g, " ").trim();
      if (!name) return;
      if (ci.tax !== -1 && /^false$/i.test(String(r[ci.tax]).trim())) return;   // subtotal / total rows
      var qtyRaw = String(r[ci.qty] || "").trim();
      var unit = String(r[ci.unit] || "").trim();
      var indented = /^\s/.test(raw);
      if (/^add-on/i.test(name)) { out.skipped++; return; }
      if (!indented && qtyRaw === "") { category = name; return; }        // category heading
      var qty = mzNum(qtyRaw);
      if (!indented) {
        if (/^(hrs?|hours?)$/i.test(unit)) out.labour.push({ name: name, qty: qty });
        else out.skipped++;                                                 // e.g. "# Legs" counts
        return;
      }
      if (!qty) { out.skipped++; return; }                                  // 0 used
      out.items.push({ category: category, name: name, description: String(r[ci.desc] || "").replace(/\s+/g, " ").trim(),
        qty: qty, unit: unit || "#", amount: ci.amount === -1 ? 0 : mzNum(r[ci.amount]) });
    });
    return out;
  }

  // Best Price List match: same name in the same category, else same name anywhere.
  function findPriceItem(it) {
    var n = normName(it.name), items = state.catalog.items;
    return items.find(function (x) { return normName(x.name) === n && x.category === it.category; }) ||
      items.find(function (x) { return normName(x.name) === n; }) || null;
  }
  // Mozaik labour name -> one of our labour types (by id), or "" to skip.
  function guessLabour(name) {
    var rates = state.catalog.labourRates, n = normName(name);
    var byKey = function (k) { var r = rates.find(function (x) { return Q.fixedLabourKey(x) === k; }); return r ? r.id : ""; };
    var exact = rates.find(function (x) { return normName(x.name) === n || normName(x.name) === n.replace("labor", "labour"); });
    if (exact) return exact.id;
    if (/^labou?r$/.test(n)) return byKey("labour");
    if (/^machin/.test(n)) return byKey("machining");
    if (/^part/.test(n) || /^assembl/.test(n)) return byKey("assembly");
    if (/^install/.test(n)) return byKey("installation");
    return "";
  }

  function priceItemOptions(selectedId) {
    var cat = state.catalog, groups = {}, order = cat.categories.slice();
    cat.items.forEach(function (it) { (groups[it.category] = groups[it.category] || []).push(it); });
    Object.keys(groups).forEach(function (g) { if (order.indexOf(g) === -1) order.push(g); });
    return '<option value="__new"' + (!selectedId ? " selected" : "") + '>➕ Add to Price List as a new item</option>' +
      order.filter(function (g) { return groups[g]; }).map(function (g) {
        return '<optgroup label="' + Q.esc(g) + '">' + groups[g].map(function (x) {
          return '<option value="' + Q.esc(x.id) + '"' + (x.id === selectedId ? " selected" : "") + '>' + Q.esc(x.name) + '</option>';
        }).join("") + '</optgroup>';
      }).join("");
  }

  function renderMozaikPreview() {
    var box = $("mzPreview");
    if (!mz) { box.innerHTML = ""; return; }
    var newCount = mz.items.filter(function (r) { return r.use && !r.matchId; }).length;
    var useCount = mz.items.filter(function (r) { return r.use; }).length;
    var html = '<div class="mz-summary"><strong>' + Q.esc(mz.fileName) + '</strong>: ' + mz.items.length + ' material lines' +
      (mz.labour.length ? ', ' + mz.labour.length + ' labour lines' : '') +
      ' <span class="muted">(' + mz.skipped + ' add-on / zero-qty / total rows skipped)</span></div>' +
      '<div class="table-scroll"><table class="q-table mz-table"><thead><tr>' +
      '<th class="col-del"><input type="checkbox" id="mzAll"' + (useCount === mz.items.length ? " checked" : "") + ' title="Import all"></th>' +
      '<th>Mozaik item</th><th>Description</th><th class="num col-qty">Qty</th><th class="col-unit">Unit</th><th>Price List item</th></tr></thead><tbody>';
    var lastCat = null;
    mz.items.forEach(function (r, i) {
      if (r.category !== lastCat) {
        lastCat = r.category;
        html += '<tr class="cat-row"><td colspan="6">' + Q.esc(r.category) + '</td></tr>';
      }
      html += '<tr class="' + (r.use ? "" : "zero") + '">' +
        '<td class="col-del"><input type="checkbox" data-mz-use="' + i + '"' + (r.use ? " checked" : "") + '></td>' +
        '<td><strong>' + Q.esc(r.name) + '</strong></td>' +
        '<td class="muted">' + Q.esc(r.description) + '</td>' +
        '<td class="num col-qty">' + Q.esc(String(r.qty)) + '</td>' +
        '<td class="col-unit">' + Q.esc(r.unit) + '</td>' +
        '<td><select class="mz-match' + (r.matchId ? "" : " mz-new") + '" data-mz-match="' + i + '">' + priceItemOptions(r.matchId) + '</select>' +
          (r.matchId ? ' <span class="mz-tag ok">on Price List</span>' : ' <span class="mz-tag new">new</span>') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    if (mz.labour.length) {
      var rates = state.catalog.labourRates;
      html += '<h3 class="mz-h">Labour hours</h3><div class="table-scroll"><table class="q-table mz-table"><thead><tr>' +
        '<th>Mozaik labour</th><th class="num col-qty">Hours</th><th>Put the hours into</th></tr></thead><tbody>' +
        mz.labour.map(function (l, i) {
          return '<tr><td><strong>' + Q.esc(l.name) + '</strong></td><td class="num col-qty">' + Q.esc(String(l.qty)) + '</td>' +
            '<td><select data-mz-lab="' + i + '"><option value="">Don\'t import</option>' +
            rates.map(function (r) { return '<option value="' + Q.esc(r.id) + '"' + (r.id === l.rateId ? " selected" : "") + '>' + Q.esc(r.name) + ' (' + Q.money(r.rate) + '/' + Q.esc(r.unit || "Hrs") + ')</option>'; }).join("") +
            '</select></td></tr>';
        }).join("") + '</tbody></table></div>';
    }
    html += '<div class="mz-options">' +
      '<label><input type="checkbox" id="mzUsePrice"' + (mz.usePrice ? " checked" : "") + '> Use Mozaik’s price for items new to the Price List (otherwise they’re added at $0 for you to price)</label>' +
      '<label><input type="checkbox" id="mzReplace"' + (mz.replace ? " checked" : "") + '> Replace the quantity of items already on this job (otherwise add to it)</label>' +
      '</div>' +
      '<div class="mz-actions"><button type="button" class="ghost-btn" id="mzCancel">Cancel</button>' +
      '<button type="button" class="primary-btn" id="mzGo"' + (useCount ? "" : " disabled") + '>Import ' + useCount + ' item' + (useCount === 1 ? "" : "s") +
      (newCount ? ' (' + newCount + ' new to the Price List)' : '') + '</button></div>';
    box.innerHTML = html;
  }

  $("mzPickBtn").addEventListener("click", function () { $("mzFile").value = ""; $("mzFile").click(); });
  $("mzFile").addEventListener("change", function () {
    var file = this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = parseMozaik(reader.result);
        if (!parsed.items.length && !parsed.labour.length) throw new Error("No materials with a quantity were found in that file.");
        parsed.items.forEach(function (r) { var m = findPriceItem(r); r.matchId = m ? m.id : null; r.use = true; });
        parsed.labour.forEach(function (l) { l.rateId = guessLabour(l.name); });
        parsed.fileName = file.name; parsed.usePrice = false; parsed.replace = true;
        mz = parsed;
        $("mzHint").classList.add("hidden");
        renderMozaikPreview();
      } catch (err) {
        mz = null; renderMozaikPreview();
        $("mzHint").classList.remove("hidden");
        $("mzPreview").innerHTML = '<div class="form-errors">' + Q.esc(err.message) + '</div>';
      }
    };
    reader.readAsText(file);
  });

  $("mzPreview").addEventListener("change", function (e) {
    if (!mz) return;
    var t = e.target, i;
    if (t.id === "mzAll") mz.items.forEach(function (r) { r.use = t.checked; });
    else if ((i = t.getAttribute("data-mz-use")) !== null) mz.items[+i].use = t.checked;
    else if ((i = t.getAttribute("data-mz-match")) !== null) mz.items[+i].matchId = t.value === "__new" ? null : t.value;
    else if ((i = t.getAttribute("data-mz-lab")) !== null) { mz.labour[+i].rateId = t.value; return; }
    else if (t.id === "mzUsePrice") { mz.usePrice = t.checked; return; }
    else if (t.id === "mzReplace") { mz.replace = t.checked; return; }
    else return;
    renderMozaikPreview();
  });

  $("mzPreview").addEventListener("click", function (e) {
    if (e.target.id === "mzCancel") { mz = null; renderMozaikPreview(); $("mzHint").classList.remove("hidden"); return; }
    if (e.target.id !== "mzGo" || !mz) return;

    // 1. Add the new items to the Price List (once per name + category).
    var cat = Q.clone(state.catalog), added = 0, made = {};
    mz.items.forEach(function (r) {
      if (!r.use || r.matchId) return;
      var key = r.category + "|" + normName(r.name);
      if (made[key]) { r.matchId = made[key]; return; }
      var price = mz.usePrice ? Q.round2(r.amount) : 0;
      var it = { id: Q.uid(), category: r.category, name: r.name, description: r.description, unit: r.unit, cost: price, price: price };
      if (cat.categories.indexOf(r.category) === -1) cat.categories.push(r.category);
      cat.items.push(it);
      made[key] = it.id; r.matchId = it.id; added++;
    });
    if (added) { cat.rev = Q.uid(); state.catalog = cat; QuoteStore.saveCatalog(cat); }

    // 2. Put the quantities on the job.
    var lines = 0;
    mz.items.forEach(function (r) {
      if (!r.use || !r.matchId) return;
      var it = state.catalog.items.find(function (x) { return x.id === r.matchId; });
      if (!it) return;
      var line = job.materials.find(function (l) { return l.itemId === it.id; });
      if (line) {
        line.qty = Q.round2((mz.replace ? 0 : Q.num(line.qty)) + r.qty);
      } else {
        line = fromItem(it); line.qty = r.qty;
        job.materials.push(line);
      }
      if (r.description && !line.note && normName(r.description) !== normName(it.description)) line.note = r.description;
      lines++;
    });

    // 3. Labour hours.
    var hrs = 0;
    mz.labour.forEach(function (l) {
      if (!l.rateId) return;
      var rate = state.catalog.labourRates.find(function (x) { return x.id === l.rateId; });
      if (!rate) return;
      var line = job.labour.find(function (x) { return x.rateId === rate.id; });
      if (!line) {
        line = { id: Q.uid(), rateId: rate.id, name: rate.name, description: "", unit: rate.unit || "Hrs", qty: 0,
          cost: Q.num(rate.cost), price: Q.num(rate.rate), markup: 0 };
        job.labour.push(line);
      }
      line.qty = Q.round2((mz.replace ? 0 : Q.num(line.qty)) + l.qty);
      hrs++;
    });

    var msg = "Imported " + lines + " material line" + (lines === 1 ? "" : "s") +
      (hrs ? " and " + hrs + " labour line" + (hrs === 1 ? "" : "s") : "") +
      (added ? ". " + added + " new item" + (added === 1 ? " was" : "s were") + " added to the Price List" +
        (mz.usePrice ? "." : " at $0 – set their prices on the Price List.") : ".");
    mz = null;
    renderAll(); changed();
    $("mzHint").classList.remove("hidden");
    $("mzPreview").innerHTML = '<div class="form-errors form-success">' + Q.esc(msg) + '</div>';
  });

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
      // The echo of our own save (or a save while typing): never redraw the
      // tables, or the box being typed in loses focus (then space scrolls
      // the page). Only if the Price List / rates changed elsewhere do we
      // redraw, and then the cursor is put back where it was.
      var catRev = s.catalog.rev || null;
      if (job && (dirty || incoming.rev === lastRev)) {
        if (!dirty && catRev !== lastCatalogRev) {
          lastCatalogRev = catRev;
          keepFocus(function () {
            renderPickers(); renderMaterials(); renderLabour(); renderInstall(); renderFixed(); renderAddOns(); updateNumbers();
          });
        }
        return;
      }
      lastCatalogRev = catRev;
      job = normaliseJob(Q.clone(incoming));
      dropEmptyAutoLabour();
      if (firstRender) renderAll(); else keepFocus(renderAll);
      if (firstRender) {
        firstRender = false;
        saveStateEl.textContent = "Changes save automatically";
        if (Q.param("new")) { $("f_name").focus(); }
      }
    }
  });
})();
