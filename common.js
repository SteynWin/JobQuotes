/*
 * Shared code for the Job Quotes pages.
 *
 *  - QuoteStore: persistence with two backends, chosen automatically:
 *      * Local (default): this browser's localStorage only.
 *      * Firestore: if firebase-config.js has real values. The price
 *        list, labour rates and settings live in one document
 *        (quoteBuilder/catalog); each job is its own document in the
 *        "quoteJobs" collection, so the data never hits Firestore's
 *        1 MB-per-document limit, however many jobs you add.
 *
 *  - Q: helpers shared by every page (money formatting, HTML escaping,
 *    quote maths, the page header/nav, sync badge).
 *
 * Pages call QuoteStore.init({ onChange, onStatus }) and re-render from
 * onChange(state), where state = { catalog, jobs: { id: job } }.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- defaults
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function item(category, name, unit, price, cost, description) {
    return {
      id: uid(), category: category, name: name, description: description || "",
      unit: unit, price: price, cost: cost == null ? price : cost
    };
  }

  // Seeded from the Mozaik "FlatPack & hardware" pricing template, so the
  // price list starts out matching what Mozaik prints. Edit freely on the
  // Price List page. "cost" (what you pay) starts equal to "price" (what
  // goes on the quote) - set your real buy prices to see true margins.
  function defaultCatalog() {
    var categories = ["Materials", "Banding", "Drawer Boxes", "Hinges", "Guides", "Pulls",
      "Shelf Pins", "Legs", "Spacers", "Fasteners", "Linear Lights", "Spot Lights",
      "Buyout Doors", "Appliances", "Other"];
    return {
      categories: categories,
      items: [
        item("Materials", "Colour 1 16mm Blossom white", "Sheet", 150),
        item("Materials", "QStone Glacier", "#", 800),
        item("Materials", "White HMR 16mm", "Sheet", 70),
        item("Banding", "PVC Colour 1 1mm", "M", 1.00),
        item("Banding", "PVC White 1mm", "M", 0.85),
        item("Hinges", "Blum 110 Standard", "#", 8),
        item("Guides", "H135 500mm 55202705 - Slow Close", "#", 45),
        item("Guides", "H167 500mm - Slow Close", "#", 45),
        item("Guides", "H199 500mm 55202715 - Slow Close", "#", 45),
        item("Guides", "H84 500mm 55208895 - Slow Close", "#", 45),
        item("Pulls", "Bar Pull", "#", 6.78),
        item("Shelf Pins", "Flat Metal Pin 5mm", "#", 0.35),
        item("Legs", "Leg", "#", 0),
        item("Fasteners", "Adrina Bottom cabinets", "#", 0.10),
        item("Fasteners", "Adrina top cabinets", "#", 0.10),
        item("Appliances", "Cooktop - Electric", "#", 0),
        item("Appliances", "Hood", "#", 0),
        item("Appliances", "Single oven", "#", 0)
      ],
      labourRates: [
        { id: "fixed-labour", name: "Labour", unit: "Hrs", rate: 160, cost: 60 },
        { id: "fixed-machining", name: "Machining", unit: "Hrs", rate: 80, cost: 40 },
        { id: "fixed-assembly", name: "Assembly Labour", unit: "Hrs", rate: 160, cost: 60 },
        { id: "fixed-installation", name: "Installation Labour", unit: "Hrs", rate: 95, cost: 50 }
      ],
      addOnPresets: [
        { id: uid(), name: "Design", amount: 200 },
        { id: uid(), name: "Cutters", amount: 80 },
        { id: uid(), name: "Delivery", amount: 100 },
        { id: uid(), name: "Install", amount: 0 }
      ],
      settings: {
        companyName: "Adrina Project Management Pty Ltd",
        abn: "", phone: "", email: "", address: "",
        taxName: "GST", taxPct: 10,
        marginPct: 40,
        depositPct: 50,
        validDays: 30,
        quotePrefix: "Q-",
        nextQuoteNumber: 1,
        terms: "This quote is valid for 30 days from the date above.\n" +
          "A deposit is required to confirm the order; the balance is due on completion.\n" +
          "Appliances, plumbing and electrical connections are excluded unless listed above."
      }
    };
  }

  // The four labour types every job always shows. Matched by name so
  // existing price lists (with their own ids) are recognised; any that
  // are missing are added with a fixed id so all devices agree.
  var FIXED_LABOUR = [
    { key: "labour", re: /^(labour|labor)$/i, def: { id: "fixed-labour", name: "Labour", unit: "Hrs", rate: 160, cost: 60 } },
    { key: "machining", re: /^machin/i, def: { id: "fixed-machining", name: "Machining", unit: "Hrs", rate: 80, cost: 40 } },
    { key: "assembly", re: /^assembl/i, def: { id: "fixed-assembly", name: "Assembly Labour", unit: "Hrs", rate: 160, cost: 60 } },
    { key: "installation", re: /^install/i, def: { id: "fixed-installation", name: "Installation Labour", unit: "Hrs", rate: 95, cost: 50 } }
  ];
  function fixedLabourKey(rate) {
    var name = String(rate.name || "").trim();
    for (var i = 0; i < FIXED_LABOUR.length; i++) {
      if (rate.id === FIXED_LABOUR[i].def.id || FIXED_LABOUR[i].re.test(name)) return FIXED_LABOUR[i].key;
    }
    return null;
  }
  // Fixed types first (in the standard order), then any extra types.
  function orderedLabourRates(rates) {
    var fixed = [], extra = [];
    FIXED_LABOUR.forEach(function (f) {
      var r = rates.find(function (x) { return fixedLabourKey(x) === f.key; });
      if (r) fixed.push(r);
    });
    rates.forEach(function (r) { if (fixed.indexOf(r) === -1) extra.push(r); });
    return fixed.concat(extra);
  }
  function ensureFixedLabour(rates) {
    rates = rates.slice();
    FIXED_LABOUR.forEach(function (f) {
      if (!rates.some(function (r) { return fixedLabourKey(r) === f.key; })) rates.push(Object.assign({}, f.def));
    });
    return orderedLabourRates(rates);
  }

  function normaliseCatalog(c) {
    var d = defaultCatalog();
    c = c || {};
    return {
      categories: Array.isArray(c.categories) ? c.categories : d.categories,
      items: Array.isArray(c.items) ? c.items : d.items,
      labourRates: ensureFixedLabour(Array.isArray(c.labourRates) ? c.labourRates : d.labourRates),
      addOnPresets: Array.isArray(c.addOnPresets) ? c.addOnPresets : d.addOnPresets,
      settings: Object.assign({}, d.settings, c.settings || {}),
      rev: c.rev || null
    };
  }

  function isFirebaseConfigured() {
    var c = window.FIREBASE_CONFIG;
    return !!(c && typeof c === "object" && c.apiKey && c.projectId &&
      c.apiKey.indexOf("YOUR_") !== 0 && c.projectId.indexOf("YOUR_") !== 0);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ------------------------------------------------------- local backend
  function LocalBackend() {
    var KEYS = { catalog: "qb_catalog", jobs: "qb_jobs" };
    var onChange = null;
    function load(key, fallback) {
      try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
      catch (e) { return fallback; }
    }
    function save(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* quota/private */ }
    }
    var state = { catalog: normaliseCatalog(load(KEYS.catalog, null)), jobs: load(KEYS.jobs, {}) || {} };
    function persist() { save(KEYS.catalog, state.catalog); save(KEYS.jobs, state.jobs); }
    function emit() { if (onChange) onChange(clone(state)); }

    // Another tab of this app saved something: pick it up.
    window.addEventListener("storage", function (e) {
      if (e.key !== KEYS.catalog && e.key !== KEYS.jobs) return;
      state = { catalog: normaliseCatalog(load(KEYS.catalog, null)), jobs: load(KEYS.jobs, {}) || {} };
      emit();
    });

    return {
      init: function (cb) {
        onChange = cb.onChange;
        if (cb.onStatus) cb.onStatus("local");
        persist(); emit();
        return Promise.resolve();
      },
      saveCatalog: function (catalog) { state.catalog = clone(catalog); persist(); emit(); return Promise.resolve(); },
      saveJob: function (job) { state.jobs[job.id] = clone(job); persist(); emit(); return Promise.resolve(); },
      deleteJob: function (id) { delete state.jobs[id]; persist(); emit(); return Promise.resolve(); },
      overwriteAll: function (data) {
        state = { catalog: normaliseCatalog(data.catalog), jobs: data.jobs || {} };
        persist(); emit(); return Promise.resolve();
      }
    };
  }

  // --------------------------------------------------- firestore backend
  function FirestoreBackend() {
    var onChange = null, onStatus = null, catalogRef = null, jobsRef = null;
    var state = { catalog: null, jobs: {} };
    var gotCatalog = false, gotJobs = false;

    function reportError(err) {
      if (onStatus) onStatus("error");
      // eslint-disable-next-line no-console
      console.error("QuoteStore (Firestore) error:", err);
    }
    function emit(fromCache) {
      if (!gotCatalog || !gotJobs) return;
      if (onStatus) onStatus(fromCache ? "offline" : "live");
      if (onChange) onChange(clone(state));
    }

    return {
      init: function (cb) {
        onChange = cb.onChange; onStatus = cb.onStatus;
        if (onStatus) onStatus("connecting");
        try {
          if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
          var db = firebase.firestore();
          if (db.settings) {
            try { db.settings({ experimentalAutoDetectLongPolling: true }); } catch (e) { /* already set */ }
          }
          catalogRef = db.collection("quoteBuilder").doc("catalog");
          jobsRef = db.collection("quoteJobs");
          catalogRef.onSnapshot({ includeMetadataChanges: true }, function (snap) {
            if (!snap.exists) {
              catalogRef.set(defaultCatalog()).catch(reportError);
              return;
            }
            state.catalog = normaliseCatalog(snap.data());
            gotCatalog = true;
            emit(snap.metadata.fromCache);
          }, reportError);
          jobsRef.onSnapshot({ includeMetadataChanges: true }, function (qs) {
            var jobs = {};
            qs.forEach(function (doc) { jobs[doc.id] = doc.data(); });
            state.jobs = jobs;
            gotJobs = true;
            emit(qs.metadata.fromCache);
          }, reportError);
        } catch (e) { reportError(e); }
        return Promise.resolve();
      },
      saveCatalog: function (catalog) { return catalogRef.set(clone(catalog)).catch(reportError); },
      saveJob: function (job) { return jobsRef.doc(job.id).set(clone(job)).catch(reportError); },
      deleteJob: function (id) { return jobsRef.doc(id).delete().catch(reportError); },
      overwriteAll: function (data) {
        var db = firebase.firestore();
        var batch = db.batch();
        batch.set(catalogRef, normaliseCatalog(data.catalog));
        Object.keys(state.jobs).forEach(function (id) {
          if (!data.jobs || !data.jobs[id]) batch.delete(jobsRef.doc(id));
        });
        Object.keys(data.jobs || {}).forEach(function (id) { batch.set(jobsRef.doc(id), data.jobs[id]); });
        return batch.commit().catch(reportError);
      }
    };
  }

  var store = isFirebaseConfigured() ? FirestoreBackend() : LocalBackend();
  store.isTeamSyncEnabled = isFirebaseConfigured();
  window.QuoteStore = store;

  // ---------------------------------------------------------------- helpers
  var moneyFmt = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function money(n) { return moneyFmt.format(round2(num(n))); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var p = iso.split("-").map(Number);
    return pad2(p[2]) + "/" + pad2(p[1]) + "/" + p[0];
  }
  function addDaysISO(iso, n) {
    var p = iso.split("-").map(Number);
    var d = new Date(p[0], p[1] - 1, p[2] + n);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function param(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  var STATUSES = ["Draft", "Quoted", "Accepted", "In Progress", "Completed", "Lost"];

  /*
   * Quote maths, matching the Mozaik layout:
   *   line total   = qty x unit price x (1 + line markup %)
   *   items total  = materials + labour + add-ons
   *   margin       = items total x job margin %   (Mozaik's "Add-On %Subtotal")
   *   subtotal     = items total + margin
   *   tax          = subtotal x tax %
   *   total        = subtotal + tax
   *   deposit      = total x deposit %, balance = total - deposit
   * Internal cost uses each line's cost price / labour cost rate, so the
   * job page can show the expected profit (subtotal - cost).
   */
  function lineSell(l) { return num(l.qty) * num(l.price) * (1 + num(l.markup) / 100); }
  function lineCost(l) { return num(l.qty) * num(l.cost); }

  function calcJob(job) {
    var materials = 0, materialsCost = 0, labour = 0, labourCost = 0, addOns = 0, addOnsCost = 0, hours = 0;
    (job.materials || []).forEach(function (l) { materials += lineSell(l); materialsCost += lineCost(l); });
    (job.labour || []).forEach(function (l) {
      labour += lineSell(l); labourCost += lineCost(l); hours += num(l.qty);
    });
    (job.addOns || []).forEach(function (a) { addOns += num(a.amount); addOnsCost += num(a.cost); });
    var itemsTotal = materials + labour + addOns;
    var margin = itemsTotal * num(job.marginPct) / 100;
    var subtotal = itemsTotal + margin;
    var tax = subtotal * num(job.taxPct) / 100;
    var total = subtotal + tax;
    var deposit = total * num(job.depositPct) / 100;
    var cost = materialsCost + labourCost + addOnsCost;
    var actual = 0;
    (job.expenses || []).forEach(function (e) { actual += num(e.amount); });
    return {
      materials: round2(materials), materialsCost: round2(materialsCost),
      labour: round2(labour), labourCost: round2(labourCost), hours: round2(hours),
      addOns: round2(addOns), addOnsCost: round2(addOnsCost),
      itemsTotal: round2(itemsTotal), margin: round2(margin), subtotal: round2(subtotal),
      tax: round2(tax), total: round2(total), deposit: round2(deposit),
      balance: round2(total - deposit),
      cost: round2(cost), profit: round2(subtotal - cost),
      profitPct: subtotal ? (subtotal - cost) / subtotal * 100 : 0,
      actual: round2(actual), actualProfit: round2(subtotal - actual)
    };
  }

  function newJob(catalog) {
    var s = catalog.settings;
    var n = num(s.nextQuoteNumber) || 1;
    return {
      id: uid(),
      quoteNo: (s.quotePrefix || "") + String(n).padStart(4, "0"),
      name: "", customer: "", address: "", phone: "", email: "",
      status: "Draft", date: todayISO(), notes: "",
      marginPct: num(s.marginPct), taxPct: num(s.taxPct), depositPct: num(s.depositPct),
      materials: [], labour: [], addOns: [], expenses: [],
      createdAt: Date.now(), updatedAt: Date.now()
    };
  }

  // ------------------------------------------------------------ page chrome
  var PAGES = [
    { href: "index.html", label: "Jobs", key: "jobs" },
    { href: "prices.html", label: "Price List", key: "prices" },
    { href: "labour.html", label: "Labour Rates", key: "labour" },
    { href: "settings.html", label: "Settings", key: "settings" }
  ];

  function renderChrome(activeKey, subtitle) {
    var header = document.getElementById("appHeader");
    if (header) {
      header.innerHTML =
        '<div class="header-inner">' +
          '<img src="assets/logo.png" alt="" class="app-logo">' +
          '<div class="header-text">' +
            '<h1>Job Quotes</h1>' +
            '<p class="subtitle">' + esc(subtitle || "Track jobs, material costs and labour, and build client quotes") + '</p>' +
          '</div>' +
          '<span id="syncStatus" class="sync-status sync-status-local">Local only</span>' +
        '</div>' +
        '<nav class="q-nav">' +
          PAGES.map(function (p) {
            return '<a href="' + p.href + '"' + (p.key === activeKey ? ' class="active" aria-current="page"' : "") + '>' + p.label + '</a>';
          }).join("") +
        '</nav>';
    }
  }

  var STATUS_LABEL = {
    local: "Local only", connecting: "Connecting…", live: "Team sync on",
    offline: "Offline – will sync", error: "Sync error"
  };
  function setSyncStatus(s) {
    var el = document.getElementById("syncStatus");
    if (!el) return;
    el.className = "sync-status sync-status-" + s;
    el.textContent = STATUS_LABEL[s] || s;
    var foot = document.getElementById("footerNote");
    if (foot) {
      foot.textContent = store.isTeamSyncEnabled
        ? "Team sync is on: everyone with this link shares the same jobs and prices."
        : "Data is stored locally in your browser. Nothing is uploaded anywhere.";
    }
  }

  // Debounce helper for autosave while typing.
  function debounce(fn, ms) {
    var t = null;
    var wrapped = function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    };
    wrapped.flush = function () { if (t) { clearTimeout(t); t = null; fn(); } };
    wrapped.cancel = function () { clearTimeout(t); t = null; };
    return wrapped;
  }

  function downloadFile(filename, text, type) {
    var blob = new Blob([text], { type: type || "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // Minimal CSV (RFC 4180-ish) for price list import/export.
  function toCSV(rows) {
    return rows.map(function (r) {
      return r.map(function (v) {
        var s = String(v == null ? "" : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\n");
  }
  function parseCSV(text) {
    var rows = [], row = [], cur = "", inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); rows.push(row); row = []; cur = "";
      } else cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return v.trim() !== ""; }); });
  }

  window.Q = {
    uid: uid, num: num, round2: round2, money: money, esc: esc,
    todayISO: todayISO, fmtDate: fmtDate, addDaysISO: addDaysISO, param: param,
    STATUSES: STATUSES, calcJob: calcJob, lineSell: lineSell, lineCost: lineCost,
    newJob: newJob, defaultCatalog: defaultCatalog, normaliseCatalog: normaliseCatalog,
    fixedLabourKey: fixedLabourKey,
    renderChrome: renderChrome, setSyncStatus: setSyncStatus, debounce: debounce,
    downloadFile: downloadFile, toCSV: toCSV, parseCSV: parseCSV, clone: clone
  };
})();
