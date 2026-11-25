/*
 * Office approval: an internal, detailed overview of one job for the office
 * to check before the quote goes to the client. Every line shows its cost,
 * sell price and profit; then section totals, overheads & margin, GST,
 * delivery, variations and the profit before and after extra costs. The
 * office can record who approved it and when. Never shown to the client.
 */
(function () {
  "use strict";
  Q.renderChrome("jobs");

  var jobId = Q.param("id");
  var state = null;
  var paper = document.getElementById("approvalPaper");
  document.getElementById("backToJob").href = "job.html?id=" + encodeURIComponent(jobId || "");

  function pct(profit, sell) { return sell ? (profit / sell * 100).toFixed(1) + "%" : "–"; }
  function cls(n) { return n < 0 ? "neg" : "pos"; }
  function qtyText(q) { return String(Math.round(Q.num(q) * 100) / 100); }

  // One row per line: qty, unit cost, cost, unit sell, sell, profit.
  function lineRow(name, desc, qty, unit, unitCost, unitSell) {
    var cost = Q.num(qty) * Q.num(unitCost), sell = Q.num(qty) * Q.num(unitSell);
    return { name: name, desc: desc || "", qty: qty, unit: unit || "", unitCost: unitCost, unitSell: unitSell,
      cost: cost, sell: sell, profit: sell - cost };
  }

  function buildSections(job) {
    var cats = state.catalog.categories;
    var sections = [];
    var sec = function (name, rows, note) {
      rows = rows.filter(function (r) { return Q.num(r.qty) !== 0; });
      if (!rows.length) return;
      var t = { cost: 0, sell: 0, profit: 0 };
      rows.forEach(function (r) { t.cost += r.cost; t.sell += r.sell; t.profit += r.profit; });
      sections.push({ name: name, rows: rows, total: t, note: note || "" });
    };

    // Materials, by Price List category
    var mats = (job.materials || []).filter(function (l) { return !l.pending; });
    var byCat = {}, order = [];
    mats.forEach(function (l) {
      var k = l.category || "Other";
      if (!byCat[k]) { byCat[k] = []; order.push(k); }
      byCat[k].push(l);
    });
    order.sort(function (a, b) {
      var ia = cats.indexOf(a), ib = cats.indexOf(b);
      return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
    });
    order.forEach(function (k) {
      sec(k, byCat[k].map(function (l) {
        var rl = Q.num(state.catalog.settings.rollLengthM) || 100;
        if (l.byRoll && Q.isMetreUnit(l.unit)) {
          return lineRow(l.name, (l.note || l.description || "") + " (" + Q.round2(Q.num(l.meters)) + " m measured)", l.rolls, "Roll",
            Q.num(l.cost) * rl, Q.num(l.price) * rl * (1 + Q.num(l.markup) / 100));
        }
        return lineRow(l.name, l.note || l.description, l.qty, l.unit, l.cost,
          Q.num(l.price) * (1 + Q.num(l.markup) / 100));
      }));
    });

    var labRow = function (l) {
      return lineRow(l.name, l.description, l.qty, l.unit || "Hrs", l.cost, Q.num(l.price) * (1 + Q.num(l.markup) / 100));
    };
    sec("Labour", (job.labour || []).filter(function (l) { return !Q.isInstallLine(l); }).map(labRow));
    sec("Installation", (job.labour || []).filter(function (l) { return Q.isInstallLine(l); }).map(labRow));

    var fc = job.fixedCharges || {};
    if (fc.design && fc.design.included) sec("Design", [lineRow("Design", "", 1, "", fc.design.cost, fc.design.amount)]);
    sec("Supplied items", (job.addOns || []).filter(function (a) { return a.included !== false; }).map(function (a) {
      return lineRow(a.name || "Extra", "", 1, "", a.cost, a.amount);
    }));
    return sections;
  }

  function render() {
    if (!state) return;
    var job = state.jobs[jobId];
    if (!job) {
      document.getElementById("notFound").classList.remove("hidden");
      paper.classList.add("hidden");
      return;
    }
    document.title = "Office approval " + (job.quoteNo || "") + " – " + (job.name || "");
    var s = state.catalog.settings;
    var c = Q.calcJob(job);
    var sections = buildSections(job);
    var fc = job.fixedCharges || {};
    var delivery = fc.delivery && fc.delivery.included ? fc.delivery : null;
    var vars = (job.expenses || []);
    var varCost = c.actual, varCharge = c.variations;

    var html =
      '<div class="qp-head">' +
        '<div><img src="assets/logo.png" alt="" class="qp-logo">' +
          '<div class="qp-company"><strong>' + Q.esc(s.companyName) + '</strong></div></div>' +
        '<div class="qp-title"><h1>OFFICE APPROVAL</h1><div class="internal-tag">Internal – not for the client</div><table class="qp-meta">' +
          meta("Quote #", job.quoteNo) + meta("Date", Q.fmtDate(job.date)) + meta("Status", job.status) +
        '</table></div>' +
      '</div>' +
      '<div class="qp-to"><strong>' + Q.esc(job.name || "(untitled job)") + '</strong>' +
        ([job.customer, job.address].filter(Boolean).length ? "\n" + Q.esc([job.customer, job.address].filter(Boolean).join(" · ")) : "") + '</div>';

    // ---- Internal notes (office only) and the notes the client will see
    if (job.internalNotes) {
      html += '<div class="qp-notes appr-notes appr-internal"><h3>Internal notes</h3>' + Q.esc(job.internalNotes) + '</div>';
    }
    if (job.notes) {
      html += '<div class="qp-notes appr-notes"><h3>Notes shown on the quote</h3>' + Q.esc(job.notes) + '</div>';
    }

    // ---- Key figures
    html += '<div class="appr-tiles">' +
      apTile("Quote total (incl. GST)", Q.money(c.total)) +
      apTile("Total cost", Q.money(c.cost + varCost)) +
      apTile("Profit after extras", Q.money(c.actualProfit), cls(c.actualProfit)) +
      apTile("Profit margin", pct(c.actualProfit, c.subtotal + c.delivery), cls(c.actualProfit)) +
    '</div>';

    // ---- Summary by section
    html += '<h2 class="appr-h">Summary by section</h2>' +
      '<table class="qp-table appr-table"><thead><tr><th>Section</th><th class="num">Cost</th><th class="num">Sell</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead><tbody>';
    var tot = { cost: 0, sell: 0, profit: 0 };
    var buyOuts = sections.filter(function (sec) { return sec.name === "Supplied items"; })[0];
    sections.filter(function (sec) { return sec !== buyOuts; }).forEach(function (sec) {
      tot.cost += sec.total.cost; tot.sell += sec.total.sell; tot.profit += sec.total.profit;
      html += '<tr><td>' + Q.esc(sec.name) + '</td><td class="num">' + Q.money(sec.total.cost) + '</td><td class="num">' + Q.money(sec.total.sell) +
        '</td><td class="num ' + cls(sec.total.profit) + '">' + Q.money(sec.total.profit) + '</td><td class="num">' + pct(sec.total.profit, sec.total.sell) + '</td></tr>';
    });
    html += '<tr class="appr-sum"><td>Items</td><td class="num">' + Q.money(tot.cost) + '</td><td class="num">' + Q.money(tot.sell) +
      '</td><td class="num ' + cls(tot.profit) + '">' + Q.money(tot.profit) + '</td><td class="num">' + pct(tot.profit, tot.sell) + '</td></tr>';
    if (varCharge || varCost) {
      html += '<tr><td>Variations</td><td class="num">' + Q.money(varCost) + '</td><td class="num">' + Q.money(varCharge) +
        '</td><td class="num ' + cls(varCharge - varCost) + '">' + Q.money(varCharge - varCost) + '</td><td class="num">' + pct(varCharge - varCost, varCharge) + '</td></tr>';
    }
    html += '<tr><td>Overheads &amp; margin (' + Q.num(job.marginPct) + '% of ' + Q.money(c.marginBase) +
      ' – items incl. variations)</td><td class="num">–</td><td class="num">' + Q.money(c.margin) +
      '</td><td class="num pos">' + Q.money(c.margin) + '</td><td></td></tr>';
    if (buyOuts) {
      html += '<tr><td>Supplied items (supplier markup, no overheads)</td><td class="num">' + Q.money(buyOuts.total.cost) + '</td><td class="num">' + Q.money(buyOuts.total.sell) +
        '</td><td class="num ' + cls(buyOuts.total.profit) + '">' + Q.money(buyOuts.total.profit) + '</td><td class="num">' + pct(buyOuts.total.profit, buyOuts.total.sell) + '</td></tr>';
    }
    if (delivery) {
      html += '<tr><td>Delivery (after GST)</td><td class="num">' + Q.money(delivery.cost) + '</td><td class="num">' + Q.money(delivery.amount) +
        '</td><td class="num ' + cls(delivery.amount - delivery.cost) + '">' + Q.money(Q.num(delivery.amount) - Q.num(delivery.cost)) + '</td><td class="num">' +
        pct(Q.num(delivery.amount) - Q.num(delivery.cost), Q.num(delivery.amount)) + '</td></tr>';
    }
    var allCost = c.cost + varCost, allSell = c.subtotal + c.delivery;
    html += '<tr class="appr-grand"><td>Total (excl. GST)</td><td class="num">' + Q.money(allCost) + '</td><td class="num">' + Q.money(allSell) +
      '</td><td class="num ' + cls(allSell - allCost) + '">' + Q.money(allSell - allCost) + '</td><td class="num">' + pct(allSell - allCost, allSell) + '</td></tr>' +
      '</tbody></table>';

    // ---- Totals as the client sees them
    var tax = s.taxName || "GST";
    html += '<div class="appr-cols"><div>' +
      '<h2 class="appr-h">Quote totals (client)</h2><table class="qp-totals appr-totals">' +
        tr("Items (incl. variations)", c.itemsTotal) +
        tr("Overheads & margin (" + Q.num(job.marginPct) + "%)", c.margin) +
        (c.addOns ? tr("Supplied items", c.addOns) : "") +
        tr("Subtotal", c.subtotal, "strong") +
        tr(tax + " (" + Q.num(job.taxPct) + "%)", c.tax) +
        (c.delivery ? tr("Delivery (after " + tax + ")", c.delivery) : "") +
        '<tr class="qp-grand"><td>Total</td><td>' + Q.money(c.total) + '</td></tr>' +
        tr("Deposit (" + Q.num(job.depositPct) + "%)", c.deposit) + tr("Balance due", c.balance) +
      '</table></div><div>' +
      '<h2 class="appr-h">Profit</h2><table class="qp-totals appr-totals">' +
        tr("Revenue excl. " + tax, c.subtotal + c.delivery) +
        tr("Estimated cost", c.cost) +
        '<tr class="strong"><td>Estimated profit</td><td class="' + cls(c.profit) + '">' + Q.money(c.profit) + ' (' + pct(c.profit, c.subtotal + c.delivery) + ')</td></tr>' +
        tr("Extra costs & variations (your cost)", varCost) +
        '<tr class="qp-grand"><td>Profit after extras</td><td class="' + cls(c.actualProfit) + '">' + Q.money(c.actualProfit) + '</td></tr>' +
        '<tr><td>Labour hours</td><td>' + (c.hours + c.installHours) + ' hrs</td></tr>' +
      '</table></div></div>';

    // ---- Detailed lines
    html += '<h2 class="appr-h">Detailed lines</h2>' +
      '<table class="qp-table appr-table appr-lines"><thead><tr><th>Item</th><th class="num">Qty</th><th>Unit</th>' +
      '<th class="num">Unit cost</th><th class="num">Cost</th><th class="num">Unit sell</th><th class="num">Sell</th><th class="num">Profit</th></tr></thead><tbody>';
    sections.forEach(function (sec) {
      html += '<tr class="qp-cat"><td colspan="4">' + Q.esc(sec.name) + '</td><td class="num">' + Q.money(sec.total.cost) +
        '</td><td></td><td class="num">' + Q.money(sec.total.sell) + '</td><td class="num">' + Q.money(sec.total.profit) + '</td></tr>';
      sec.rows.forEach(function (r) {
        html += '<tr><td class="qp-indent">' + Q.esc(r.name) + (r.desc ? '<div class="muted appr-desc">' + Q.esc(r.desc) + '</div>' : "") + '</td>' +
          '<td class="num">' + qtyText(r.qty) + '</td><td>' + Q.esc(r.unit) + '</td>' +
          '<td class="num">' + Q.money(r.unitCost) + '</td><td class="num">' + Q.money(r.cost) + '</td>' +
          '<td class="num">' + Q.money(r.unitSell) + '</td><td class="num">' + Q.money(r.sell) + '</td>' +
          '<td class="num ' + cls(r.profit) + '">' + Q.money(r.profit) + '</td></tr>';
      });
    });
    if (vars.length) {
      html += '<tr class="qp-cat"><td colspan="4">Variations</td><td class="num">' + Q.money(varCost) + '</td><td></td><td class="num">' +
        Q.money(varCharge) + '</td><td class="num">' + Q.money(varCharge - varCost) + '</td></tr>';
      vars.forEach(function (x) {
        var p = Q.num(x.charge) - Q.num(x.amount);
        html += '<tr><td class="qp-indent">' + Q.esc(x.description || x.type || "Variation") +
          '<div class="muted appr-desc">' + Q.esc([x.type, Q.fmtDate(x.date)].filter(Boolean).join(" · ")) + '</div></td>' +
          '<td class="num">1</td><td></td><td class="num">' + Q.money(x.amount) + '</td><td class="num">' + Q.money(x.amount) + '</td>' +
          '<td class="num">' + Q.money(x.charge) + '</td><td class="num">' + Q.money(x.charge) + '</td><td class="num ' + cls(p) + '">' + Q.money(p) + '</td></tr>';
      });
    }
    if (delivery) {
      var dp = Q.num(delivery.amount) - Q.num(delivery.cost);
      html += '<tr class="qp-cat"><td colspan="4">Delivery (after GST)</td><td class="num">' + Q.money(delivery.cost) + '</td><td></td><td class="num">' +
        Q.money(delivery.amount) + '</td><td class="num">' + Q.money(dp) + '</td></tr>';
    }
    html += '</tbody></table>' +
      '<p class="muted appr-note">Line sell prices are before the ' + Q.num(job.marginPct) + '% overheads &amp; margin, which is shown as its own line above. Supplied items carry no overheads.</p>';

    // ---- Approval
    var ap = job.approval || {};
    html += '<h2 class="appr-h">Approval</h2>';
    if (ap.by) {
      html += '<div class="appr-approved">✔ Approved by <strong>' + Q.esc(ap.by) + '</strong> on ' + Q.esc(Q.fmtDate(ap.date)) +
        (ap.note ? '<div class="muted">' + Q.esc(ap.note) + '</div>' : "") +
        '<div class="no-print" style="margin-top:8px"><button type="button" class="small-btn danger" id="unapproveBtn">Remove approval</button></div></div>';
    } else {
      html += '<div class="appr-form no-print">' +
        '<input class="q-input" id="apBy" placeholder="Approved by (name)">' +
        '<input class="q-input" id="apNote" placeholder="Note (optional)">' +
        '<button type="button" class="primary-btn" id="approveBtn">Approve</button>' +
        '</div><div class="form-errors" id="apErr"></div>';
    }
    html += '<div class="qp-accept"><div>Approved by (name &amp; signature)</div><div>Date</div></div>';

    paper.innerHTML = html;

    function meta(k, v) { return '<tr><td>' + Q.esc(k) + '</td><td><strong>' + Q.esc(v) + '</strong></td></tr>'; }
    function tr(k, v, c2) { return '<tr' + (c2 ? ' class="' + c2 + '"' : "") + '><td>' + Q.esc(k) + '</td><td>' + Q.money(v) + '</td></tr>'; }
    function apTile(label, value, c2) {
      return '<div class="tile"><div class="tile-label">' + Q.esc(label) + '</div><div class="tile-value ' + (c2 || "") + '">' + Q.esc(value) + '</div></div>';
    }
  }

  function saveApproval(approval) {
    var job = Q.clone(state.jobs[jobId]);
    job.approval = approval;
    job.updatedAt = Date.now();
    job.rev = Q.uid();
    QuoteStore.saveJob(job);
  }

  paper.addEventListener("click", function (e) {
    if (e.target.id === "approveBtn") {
      var by = document.getElementById("apBy").value.trim();
      if (!by) { document.getElementById("apErr").textContent = "Enter the name of the person approving."; return; }
      saveApproval({ by: by, note: document.getElementById("apNote").value.trim(), date: Q.todayISO() });
    }
    if (e.target.id === "unapproveBtn") {
      if (confirm("Remove the office approval for this job?")) saveApproval(null);
    }
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
    pdfBtn.disabled = true; pdfBtn.textContent = "Preparing PDF…";
    document.body.classList.add("exporting-pdf");
    var name = ("office-approval-" + (job ? (job.quoteNo + "-" + (job.name || "")) : "")).replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").replace(/-$/, "");
    function finish() { document.body.classList.remove("exporting-pdf"); pdfBtn.disabled = false; pdfBtn.textContent = label; }
    window.html2pdf().set({
      margin: 8, filename: name + ".pdf", image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"], avoid: ["tr", ".appr-tiles", ".qp-accept"] }
    }).from(paper).save().then(finish).catch(function (err) {
      finish(); window.alert("Export failed: " + (err && err.message ? err.message : String(err)));
    });
  });

  QuoteStore.init({
    onChange: function (s) { state = s; render(); },
    onStatus: Q.setSyncStatus
  });
})();
