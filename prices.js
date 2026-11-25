/* Price List page: materials & hardware catalogue, and categories. */
(function () {
  "use strict";
  Q.renderChrome("prices");

  var catalog = null, dirty = false, lastRev = null;
  var $ = function (id) { return document.getElementById(id); };
  var body = $("priceBody"), msg = $("priceMsg");

  function doSave() {
    catalog.rev = Q.uid(); lastRev = catalog.rev; dirty = false;
    return QuoteStore.saveCatalog(catalog);
  }
  var saveSoon = Q.debounce(doSave, 600);
  function changed() { dirty = true; saveSoon(); }
  window.addEventListener("pagehide", function () { if (dirty) saveSoon.flush(); });

  function say(text, ok) { msg.textContent = text; msg.classList.toggle("form-success", !!ok); }

  function orderedCats() {
    var order = catalog.categories.slice();
    catalog.items.forEach(function (it) { if (order.indexOf(it.category) === -1) order.push(it.category); });
    return order;
  }

  function markupText(it) {
    var c = Q.num(it.cost), p = Q.num(it.price);
    if (!c) return "–";
    return ((p / c - 1) * 100).toFixed(0) + "%";
  }

  // Items are read-only until you tap Edit on a row. Edits go into a draft
  // and are only applied when you tap Save (Cancel throws them away), so a
  // stray tap can't change a price. "+" on a category opens a new draft row.
  var drafts = {};   // id -> { item: {...}, isNew: bool }

  function markupOf(cost, price) {
    cost = Q.num(cost); price = Q.num(price);
    return cost ? Q.round2((price / cost - 1) * 100) : "";
  }

  function viewRow(it, cat) {
    return '<tr data-item="' + Q.esc(it.id) + '" data-search="' + Q.esc((it.name + " " + (it.description || "") + " " + cat).toLowerCase()) + '">' +
      '<td><strong>' + Q.esc(it.name || "(no name)") + '</strong></td>' +
      '<td class="muted">' + Q.esc(it.description) + '</td>' +
      '<td class="col-unit">' + Q.esc(it.unit) + '</td>' +
      '<td class="num col-money">' + Q.money(it.cost) + '</td>' +
      '<td class="num col-money"><strong>' + Q.money(it.price) + '</strong></td>' +
      '<td class="num col-pct muted">' + markupText(it) + '</td>' +
      '<td class="col-actions"><button type="button" class="small-btn" data-edit="' + Q.esc(it.id) + '">Edit</button></td>' +
      '</tr>';
  }
  function editRow(d, cat) {
    var it = d.item;
    var catOpts = orderedCats().map(function (c) {
      return '<option' + (c === it.category ? " selected" : "") + '>' + Q.esc(c) + '</option>';
    }).join("");
    return '<tr class="editing-row" data-item="' + Q.esc(it.id) + '" data-search="' + Q.esc((it.name + " " + cat).toLowerCase()) + '">' +
      '<td>' + inp(it, "name", "text", "Item name") +
        '<select class="cat-select" data-id="' + Q.esc(it.id) + '" data-f="category" title="Category">' + catOpts + '</select></td>' +
      '<td>' + inp(it, "description", "text", "Description (optional)") + '</td>' +
      '<td class="col-unit">' + inp(it, "unit", "text") + '</td>' +
      '<td class="num col-money">' + inp(it, "cost", "number") + '</td>' +
      '<td class="num col-money">' + inp(it, "price", "number") + '</td>' +
      '<td class="num col-pct"><input type="number" step="0.1" inputmode="decimal" data-id="' + Q.esc(it.id) +
        '" data-f="markup" value="' + Q.esc(markupOf(it.cost, it.price)) + '" title="Markup % – sets the price from the cost"></td>' +
      '<td class="col-actions">' +
        '<button type="button" class="small-btn save-btn" data-save="' + Q.esc(it.id) + '">Save</button>' +
        '<button type="button" class="small-btn" data-cancel="' + Q.esc(it.id) + '">Cancel</button>' +
        (d.isNew ? "" : '<button type="button" class="small-btn delete-btn" data-delitem="' + Q.esc(it.id) + '" title="Delete this item from the Price List">Delete</button>') +
      '</td></tr>';
  }

  function renderItems() {
    var cats = orderedCats();
    var html = "";
    cats.forEach(function (cat) {
      var items = catalog.items.filter(function (it) { return it.category === cat; });
      html += '<tr class="cat-row" data-cat="' + Q.esc(cat) + '"><td colspan="6">' + Q.esc(cat) +
        ' <span class="muted" style="font-weight:400;text-transform:none">(' + items.length + ')</span></td>' +
        '<td class="col-actions"><button type="button" class="small-btn" data-additem="' + Q.esc(cat) + '" title="Add an item to ' + Q.esc(cat) + '">+ Add</button></td></tr>';
      items.forEach(function (it) {
        html += drafts[it.id] ? editRow(drafts[it.id], cat) : viewRow(it, cat);
      });
      Object.keys(drafts).forEach(function (id) {
        var d = drafts[id];
        if (d.isNew && d.item.category === cat) html += editRow(d, cat);
      });
    });
    body.innerHTML = html || '<tr><td colspan="7" class="empty-note">No categories. Add one below.</td></tr>';
    applySearch();
  }
  function inp(it, f, type, ph) {
    return '<input type="' + type + '"' + (type === "number" ? ' step="0.01" inputmode="decimal"' : "") +
      ' data-id="' + Q.esc(it.id) + '" data-f="' + f + '" value="' + Q.esc(it[f]) + '"' +
      (ph ? ' placeholder="' + Q.esc(ph) + '"' : "") + '>';
  }
  function focusField(id, f) {
    var el = body.querySelector('[data-id="' + cssEsc(id) + '"][data-f="' + f + '"]');
    if (el) { el.focus(); if (el.select) el.select(); }
  }

  function saveDraft(id) {
    var d = drafts[id];
    if (!d) return;
    var it = d.item;
    it.name = String(it.name || "").trim();
    if (!it.name) { say("Give the item a name before saving."); focusField(id, "name"); return; }
    it.cost = Q.num(it.cost); it.price = Q.num(it.price);
    var idx = catalog.items.findIndex(function (x) { return x.id === id; });
    if (idx === -1) {
      var lastIdx = -1;
      catalog.items.forEach(function (x, i) { if (x.category === it.category) lastIdx = i; });
      catalog.items.splice(lastIdx + 1, 0, it);
    } else {
      catalog.items[idx] = it;
    }
    if (catalog.categories.indexOf(it.category) === -1) catalog.categories.push(it.category);
    delete drafts[id];
    say('"' + it.name + '" saved.', true);
    renderAll(); changed();
  }

  function applySearch() {
    var term = $("priceSearch").value.trim().toLowerCase();
    var visibleByCat = {};
    body.querySelectorAll("tr[data-item]").forEach(function (tr) {
      var show = !term || tr.getAttribute("data-search").indexOf(term) !== -1;
      tr.style.display = show ? "" : "none";
    });
    body.querySelectorAll("tr.cat-row").forEach(function (tr) {
      var cat = tr.getAttribute("data-cat");
      var any = catalog.items.some(function (it) {
        if (it.category !== cat) return false;
        var row = body.querySelector('tr[data-item="' + cssEsc(it.id) + '"]');
        return row && row.style.display !== "none";
      });
      visibleByCat[cat] = any;
      tr.style.display = !term || any ? "" : "none";
    });
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s; }

  function renderCats() {
    var list = $("catList");
    var counts = {};
    catalog.items.forEach(function (it) { counts[it.category] = (counts[it.category] || 0) + 1; });
    list.innerHTML = '<table class="q-table"><tbody>' + catalog.categories.map(function (c, i) {
      return '<tr><td><input type="text" data-catname="' + i + '" value="' + Q.esc(c) + '"></td>' +
        '<td class="muted" style="width:80px">' + (counts[c] || 0) + ' items</td>' +
        '<td style="width:1%;white-space:nowrap">' +
          '<button type="button" class="small-btn" data-catup="' + i + '"' + (i === 0 ? " disabled" : "") + ' title="Move up">&uarr;</button> ' +
          '<button type="button" class="small-btn" data-catdown="' + i + '"' + (i === catalog.categories.length - 1 ? " disabled" : "") + ' title="Move down">&darr;</button> ' +
          '<button type="button" class="small-btn delete-btn" data-catdel="' + i + '" title="Delete this category and its items">Delete</button>' +
        '</td></tr>';
    }).join("") + '</tbody></table>';
  }

  function renderAll() { renderItems(); renderCats(); }

  // Edits while a row is open (drafts only, nothing saved yet)
  function onDraftInput(e) {
    var el = e.target, id = el.getAttribute("data-id");
    if (!id || !drafts[id]) return;
    var it = drafts[id].item, f = el.getAttribute("data-f");
    var row = el.closest("tr");
    var setVal = function (field, v) { var x = row.querySelector('[data-f="' + field + '"]'); if (x && x !== el) x.value = v; };
    if (f === "markup") {
      it.price = Q.round2(Q.num(it.cost) * (1 + Q.num(el.value) / 100));
      setVal("price", it.price);
    } else if (f === "cost" || f === "price") {
      it[f] = el.value === "" ? "" : Q.num(el.value);
      setVal("markup", markupOf(it.cost, it.price));
    } else {
      it[f] = el.value;
    }
  }
  body.addEventListener("input", onDraftInput);
  body.addEventListener("change", function (e) { if (e.target.tagName === "SELECT") onDraftInput(e); });
  body.addEventListener("keydown", function (e) {
    var id = e.target.getAttribute && e.target.getAttribute("data-id");
    if (!id || !drafts[id]) return;
    if (e.key === "Enter") { e.preventDefault(); saveDraft(id); }
    if (e.key === "Escape") { delete drafts[id]; renderItems(); }
  });

  body.addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest("[data-edit]"))) {
      var id = b.getAttribute("data-edit");
      var it = catalog.items.find(function (x) { return x.id === id; });
      if (it) { drafts[id] = { item: Q.clone(it), isNew: false }; renderItems(); focusField(id, "price"); }
      return;
    }
    if ((b = e.target.closest("[data-save]"))) { saveDraft(b.getAttribute("data-save")); return; }
    if ((b = e.target.closest("[data-cancel]"))) { delete drafts[b.getAttribute("data-cancel")]; say(""); renderItems(); return; }
    if ((b = e.target.closest("[data-additem]"))) {
      var cat = b.getAttribute("data-additem");
      var nu = { id: Q.uid(), category: cat, name: "", description: "", unit: "#", cost: 0, price: 0 };
      drafts[nu.id] = { item: nu, isNew: true };
      $("priceSearch").value = "";
      renderItems();
      focusField(nu.id, "name");
      return;
    }
    if ((b = e.target.closest("[data-delitem]"))) {
      var did = b.getAttribute("data-delitem");
      var item = catalog.items.find(function (x) { return x.id === did; });
      if (item && !confirm('Delete "' + (item.name || "this item") + '" from the Price List? Jobs that already use it keep it at its current price as an extra item.')) return;
      catalog.items = catalog.items.filter(function (x) { return x.id !== did; });
      delete drafts[did];
      renderAll(); changed();
    }
  });
  $("priceSearch").addEventListener("input", applySearch);

  // Category edits
  $("catList").addEventListener("change", function (e) {
    var idx = e.target.getAttribute("data-catname");
    if (idx === null) return;
    var oldName = catalog.categories[+idx];
    var newName = e.target.value.trim();
    if (!newName || newName === oldName) { e.target.value = oldName; return; }
    if (catalog.categories.indexOf(newName) !== -1) { say('There is already a category called "' + newName + '".'); e.target.value = oldName; return; }
    catalog.categories[+idx] = newName;
    catalog.items.forEach(function (it) { if (it.category === oldName) it.category = newName; });
    renderAll(); changed();
  });
  $("catList").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var cats = catalog.categories, i;
    if (b.hasAttribute("data-catup")) { i = +b.getAttribute("data-catup"); cats.splice(i - 1, 0, cats.splice(i, 1)[0]); }
    else if (b.hasAttribute("data-catdown")) { i = +b.getAttribute("data-catdown"); cats.splice(i + 1, 0, cats.splice(i, 1)[0]); }
    else if (b.hasAttribute("data-catdel")) {
      i = +b.getAttribute("data-catdel");
      var name = cats[i];
      var n = catalog.items.filter(function (it) { return it.category === name; }).length;
      if (n && !confirm('Delete "' + name + '" and its ' + n + ' item(s) from the price list?')) return;
      cats.splice(i, 1);
      catalog.items = catalog.items.filter(function (it) { return it.category !== name; });
    } else return;
    renderAll(); changed();
  });
  $("newCatBtn").addEventListener("click", function () {
    var name = $("newCatInput").value.trim();
    if (!name) { $("newCatInput").focus(); return; }
    if (catalog.categories.indexOf(name) !== -1) { say('"' + name + '" already exists.'); return; }
    catalog.categories.push(name);
    $("newCatInput").value = "";
    say("");
    renderAll(); changed();
  });
  $("newCatInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("newCatBtn").click(); } });

  // CSV
  $("csvExportBtn").addEventListener("click", function () {
    var rows = [["Category", "Item", "Description", "Unit", "Cost", "Price"]];
    orderedCats().forEach(function (cat) {
      catalog.items.filter(function (it) { return it.category === cat; }).forEach(function (it) {
        rows.push([it.category, it.name, it.description, it.unit, Q.num(it.cost), Q.num(it.price)]);
      });
    });
    Q.downloadFile("price-list-" + Q.todayISO() + ".csv", Q.toCSV(rows), "text/csv");
  });
  $("csvImportBtn").addEventListener("click", function () { $("csvFile").value = ""; $("csvFile").click(); });
  $("csvFile").addEventListener("change", function () {
    var file = this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var rows = Q.parseCSV(String(reader.result).replace(/^﻿/, ""));
      if (!rows.length) { say("That file is empty."); return; }
      var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
      var col = function (names) { for (var i = 0; i < names.length; i++) { var j = head.indexOf(names[i]); if (j !== -1) return j; } return -1; };
      var ci = col(["category"]), ni = col(["item", "name"]), di = col(["description"]), ui = col(["unit", "units"]),
        coi = col(["cost", "cost price", "buy"]), pi = col(["price", "amount", "sell", "unit price"]);
      if (ni === -1) { say('Couldn\'t find an "Item" column. Expected columns: Category, Item, Description, Unit, Cost, Price.'); return; }
      var added = 0, updated = 0;
      rows.slice(1).forEach(function (r) {
        var name = (r[ni] || "").trim();
        if (!name) return;
        var cat = ci !== -1 && r[ci] ? r[ci].trim() : "Other";
        var price = pi !== -1 ? Q.num(String(r[pi]).replace(/[$,]/g, "")) : 0;
        var cost = coi !== -1 && r[coi] !== "" ? Q.num(String(r[coi]).replace(/[$,]/g, "")) : price;
        if (catalog.categories.indexOf(cat) === -1) catalog.categories.push(cat);
        var existing = catalog.items.find(function (it) { return it.category === cat && it.name.toLowerCase() === name.toLowerCase(); });
        var fields = { description: di !== -1 ? (r[di] || "") : undefined, unit: ui !== -1 ? (r[ui] || "#") : undefined, cost: cost, price: price };
        if (existing) {
          Object.keys(fields).forEach(function (k) { if (fields[k] !== undefined) existing[k] = fields[k]; });
          updated++;
        } else {
          catalog.items.push({ id: Q.uid(), category: cat, name: name, description: fields.description || "",
            unit: fields.unit || "#", cost: cost, price: price });
          added++;
        }
      });
      renderAll(); changed();
      say("Imported: " + added + " new item(s), " + updated + " updated.", true);
    };
    reader.readAsText(file);
  });

  QuoteStore.init({
    onStatus: Q.setSyncStatus,
    onChange: function (s) {
      if (catalog && (dirty || s.catalog.rev === lastRev)) return;
      catalog = s.catalog;
      renderAll();
    }
  });
})();
