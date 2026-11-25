/* Printable client quote. */
(function () {
  "use strict";
  Q.renderChrome("jobs");

  var jobId = Q.param("id");
  var state = null;
  var paper = document.getElementById("quotePaper");
  var detail = document.getElementById("detailLevel");
  var fold = document.getElementById("foldMargin");
  document.getElementById("backToJob").href = "job.html?id=" + encodeURIComponent(jobId || "");

  try {
    detail.value = localStorage.getItem("qb_quote_detail") || "items";
    var f = localStorage.getItem("qb_quote_fold");
    if (f !== null) fold.checked = f === "1";
  } catch (e) { /* ignore */ }

  function render() {
    if (!state) return;
    var job = state.jobs[jobId];
    if (!job) {
      document.getElementById("notFound").classList.remove("hidden");
      paper.classList.add("hidden");
      return;
    }
    document.title = "Quote " + (job.quoteNo || "") + " – " + (job.name || "");
    var s = state.catalog.settings;
    var c = Q.calcJob(job);
    var level = detail.value;
    // Spreading the margin into prices: every line is scaled by (1 + margin%)
    // so the client sees final prices and no separate margin line.
    var k = fold.checked ? 1 + Q.num(job.marginPct) / 100 : 1;

    // Build sections: material categories, then Machining and workshop (labour + design), Installation, Supplied items, Variations.
    var cats = state.catalog.categories;
    var mats = (job.materials || []).filter(function (l) { return Q.num(l.qty) !== 0 && !l.pending; });
    mats.sort(function (a, b) {
      var ia = cats.indexOf(a.category), ib = cats.indexOf(b.category);
      return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
    });
    var sections = [];
    var byCat = {};
    mats.forEach(function (l) {
      var key = l.category || "Other";
      if (!byCat[key]) { byCat[key] = { name: key, rows: [] }; sections.push(byCat[key]); }
      var rl = Q.num(state.catalog.settings.rollLengthM) || 100;
      var byRoll = l.byRoll && Q.isMetreUnit(l.unit);
      byCat[key].rows.push({ name: l.name, desc: l.note || l.description,
        qty: byRoll ? l.rolls : l.qty, unit: byRoll ? "Roll (" + rl + " m)" : l.unit,
        unitPrice: Q.num(l.price) * (byRoll ? rl : 1) * (1 + Q.num(l.markup) / 100) * k });
    });
    var labRow = function (l) {
      return { name: l.name, desc: l.description, qty: l.qty, unit: l.unit || "Hrs",
        unitPrice: Q.num(l.price) * (1 + Q.num(l.markup) / 100) * k };
    };
    // Labour (all types, incl. Cutters) and Design are shown to the client
    // as one line: "Machining and workshop". Installation stays separate.
    var fc = job.fixedCharges || {};
    var workshop = 0;
    (job.labour || []).forEach(function (l) {
      if (!Q.isInstallLine(l)) workshop += Q.num(l.qty) * Q.num(l.price) * (1 + Q.num(l.markup) / 100);
    });
    if (fc.design && fc.design.included) workshop += Q.num(fc.design.amount);
    if (Q.round2(workshop)) {
      sections.push({ name: "Machining and workshop", rows: [{ name: "Design, machining, assembly and workshop labour", desc: "", qty: 1, unit: "", unitPrice: workshop * k }] });
    }
    var inst = (job.labour || []).filter(function (l) { return Q.num(l.qty) !== 0 && Q.isInstallLine(l); });
    if (inst.length) sections.push({ name: "Installation", rows: inst.map(labRow) });
    var adds = (job.addOns || []).filter(function (a) { return Q.num(a.amount) !== 0 && a.included !== false; });
    if (adds.length) {
      sections.push({ name: "Supplied items", rows: adds.map(function (a) {
        return { name: a.name, desc: "", qty: 1, unit: "", unitPrice: Q.num(a.amount) };   // no overheads on buy outs
      }) });
    }
    // Variations carry the overheads & margin %, like the items.
    var vars = (job.expenses || []).filter(function (x) { return Q.num(x.charge) !== 0; });
    if (vars.length) {
      sections.push({ name: "Variations", rows: vars.map(function (x) {
        return { name: x.description || x.type || "Variation", desc: x.date ? Q.fmtDate(x.date) : "", qty: 1, unit: "",
          unitPrice: Q.num(x.charge) * k };
      }) });
    }
    sections.forEach(function (sec) {
      sec.total = 0;
      sec.rows.forEach(function (r) { r.total = Q.num(r.qty) * r.unitPrice; sec.total += r.total; });
    });

    var company = [s.address, s.phone, s.email, s.abn ? "ABN " + s.abn : ""].filter(Boolean).join("\n");
    var to = [job.customer, job.address, job.phone, job.email].filter(Boolean).join("\n");
    var validUntil = job.date && Q.num(s.validDays) ? Q.fmtDate(Q.addDaysISO(job.date, Q.num(s.validDays))) : "";

    var html =
      '<div class="qp-head">' +
        '<div><img src="assets/logo.png" alt="" class="qp-logo">' +
          '<div class="qp-company"><strong>' + Q.esc(s.companyName) + '</strong>' + (company ? "\n" + Q.esc(company) : "") + '</div></div>' +
        '<div class="qp-title"><h1>QUOTE</h1><table class="qp-meta">' +
          meta("Quote #", job.quoteNo) + meta("Date", Q.fmtDate(job.date)) + (validUntil ? meta("Valid until", validUntil) : "") +
        '</table></div>' +
      '</div>' +
      '<div class="qp-to"><strong>' + Q.esc(job.name || "Quotation") + '</strong>' + (to ? "\nPrepared for: " + Q.esc(to) : "") + '</div>';

    if (!sections.length) {
      html += '<p class="empty-note">Nothing has been priced on this job yet.</p>';
    } else if (level === "items" || level === "itemsNoPrice") {
      var prices = level === "items";
      html += '<table class="qp-table"><thead><tr><th>Item</th><th>Description</th><th class="num">Qty</th><th>Unit</th>' +
        (prices ? '<th class="num">Unit price</th><th class="num">Total</th>' : '') + '</tr></thead><tbody>';
      sections.forEach(function (sec) {
        html += '<tr class="qp-cat"><td colspan="' + (prices ? 5 : 3) + '">' + Q.esc(sec.name) + '</td><td class="num">' + Q.money(sec.total) + '</td></tr>';
        sec.rows.forEach(function (r) {
          html += '<tr><td class="qp-indent">' + Q.esc(r.name) + '</td><td>' + Q.esc(r.desc) + '</td>' +
            '<td class="num">' + Q.esc(fmtQty(r.qty)) + '</td><td>' + Q.esc(r.unit) + '</td>' +
            (prices ? '<td class="num">' + Q.money(r.unitPrice) + '</td><td class="num">' + Q.money(r.total) + '</td>' : '') + '</tr>';
        });
      });
      html += '</tbody></table>';
    } else if (level === "categories") {
      html += '<table class="qp-table"><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody>';
      sections.forEach(function (sec) {
        html += '<tr><td>' + Q.esc(sec.name) + '</td><td class="num">' + Q.money(sec.total) + '</td></tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<table class="qp-table"><thead><tr><th>Scope of work includes</th></tr></thead><tbody>' +
        sections.map(function (sec) { return '<tr><td>' + Q.esc(sec.name) + '</td></tr>'; }).join("") + '</tbody></table>';
    }

    var tax = s.taxName || "Tax";
    html += '<table class="qp-totals">' +
      (!fold.checked && c.margin ? tot("Items total", c.itemsTotal) +
        tot("Overheads & margin (" + Q.num(job.marginPct) + "%)", c.margin) + (c.addOns ? tot("Supplied items", c.addOns) : "") : "") +
      tot("Subtotal", c.subtotal) +
      tot(tax + " (" + Q.num(job.taxPct) + "%)", c.tax) +
      (c.delivery ? tot("Delivery", c.delivery) : "") +
      '<tr class="qp-grand"><td>Total</td><td>' + Q.money(c.total) + '</td></tr>' +
      (Q.num(job.depositPct) ? '<tr class="qp-dep"><td>Deposit (' + Q.num(job.depositPct) + '%)</td><td>' + Q.money(c.deposit) + '</td></tr>' +
        '<tr class="qp-dep"><td>Balance due</td><td>' + Q.money(c.balance) + '</td></tr>' : "") +
      '</table>';

    if (job.notes) html += '<div class="qp-notes"><h3>Notes</h3>' + Q.esc(job.notes) + '</div>';
    if (s.terms) html += '<div class="qp-notes"><h3>Terms</h3>' + Q.esc(s.terms) + '</div>';
    html += '<div class="qp-accept"><div>Accepted by (name &amp; signature)</div><div>Date</div></div>';

    paper.innerHTML = html;

    function meta(k2, v) { return '<tr><td>' + Q.esc(k2) + '</td><td><strong>' + Q.esc(v) + '</strong></td></tr>'; }
    function tot(k2, v) { return '<tr><td>' + Q.esc(k2) + '</td><td>' + Q.money(v) + '</td></tr>'; }
  }

  function fmtQty(q) {
    var n = Q.num(q);
    return Math.round(n * 100) / 100 + "";
  }

  detail.addEventListener("change", function () {
    try { localStorage.setItem("qb_quote_detail", detail.value); } catch (e) { /* ignore */ }
    render();
  });
  fold.addEventListener("change", function () {
    try { localStorage.setItem("qb_quote_fold", fold.checked ? "1" : "0"); } catch (e) { /* ignore */ }
    render();
  });
  document.getElementById("printBtn").addEventListener("click", function () { window.print(); });

  var pdfBtn = document.getElementById("pdfBtn");
  pdfBtn.addEventListener("click", function () {
    if (typeof window.html2pdf !== "function") {
      window.alert("The PDF export tool didn't load. Check your internet connection and try again.");
      return;
    }
    var job = state && state.jobs[jobId];
    var label = pdfBtn.textContent;
    pdfBtn.disabled = true;
    pdfBtn.textContent = "Preparing PDF…";
    document.body.classList.add("exporting-pdf");
    var name = ("quote-" + (job ? (job.quoteNo + "-" + (job.name || "")) : "")).replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").replace(/-$/, "");
    function finish() {
      document.body.classList.remove("exporting-pdf");
      pdfBtn.disabled = false;
      pdfBtn.textContent = label;
    }
    window.html2pdf().set({
      margin: 10,
      filename: name + ".pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"], avoid: ["tr", ".qp-totals", ".qp-accept"] }
    }).from(paper).save().then(finish).catch(function (err) {
      finish();
      window.alert("Export failed: " + (err && err.message ? err.message : String(err)));
    });
  });

  QuoteStore.init({
    onChange: function (s) { state = s; render(); },
    onStatus: Q.setSyncStatus
  });
})();
