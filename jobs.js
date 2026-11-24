/* Jobs list page. */
(function () {
  "use strict";
  Q.renderChrome("jobs");

  var state = null;
  var body = document.getElementById("jobsBody");
  var tiles = document.getElementById("tiles");
  var search = document.getElementById("jobSearch");
  var statusFilter = document.getElementById("statusFilter");

  statusFilter.innerHTML = '<option value="">All statuses</option><option value="open">Open (not Completed/Lost)</option>' +
    Q.STATUSES.map(function (s) { return '<option>' + Q.esc(s) + '</option>'; }).join("");
  try { statusFilter.value = localStorage.getItem("qb_status_filter") || ""; } catch (e) { /* ignore */ }

  function render() {
    if (!state) return;
    var term = search.value.trim().toLowerCase();
    var sf = statusFilter.value;
    var jobs = Object.keys(state.jobs).map(function (k) { return state.jobs[k]; });
    jobs.sort(function (a, b) { return (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0); });

    // Tiles: whole pipeline, regardless of filter.
    var open = 0, openValue = 0, won = 0, wonProfit = 0, spent = 0, quotedCount = 0;
    jobs.forEach(function (j) {
      var c = Q.calcJob(j);
      if (j.status === "Draft" || j.status === "Quoted") { open++; openValue += c.total; }
      if (j.status === "Accepted" || j.status === "In Progress" || j.status === "Completed") {
        won += c.total; wonProfit += c.profit;
      }
      if (j.status !== "Draft") quotedCount++;
      spent += c.actual;
    });
    tiles.innerHTML =
      tile("Jobs", jobs.length, quotedCount + " quoted") +
      tile("Open quotes", Q.money(openValue), open + " draft/quoted") +
      tile("Won work", Q.money(won), "Est. profit " + Q.money(wonProfit)) +
      tile("Extra costs & variations", Q.money(spent), "across all jobs");

    var shown = jobs.filter(function (j) {
      if (sf === "open" && (j.status === "Completed" || j.status === "Lost")) return false;
      if (sf && sf !== "open" && j.status !== sf) return false;
      if (!term) return true;
      return [j.quoteNo, j.name, j.customer, j.address].join(" ").toLowerCase().indexOf(term) !== -1;
    });

    if (!shown.length) {
      body.innerHTML = '<tr><td colspan="9" class="empty-note">' +
        (jobs.length ? "No jobs match." : "No jobs yet. Tap <strong>+ New Job</strong> to start a quote.") + '</td></tr>';
      return;
    }
    body.innerHTML = shown.map(function (j) {
      var c = Q.calcJob(j);
      return '<tr class="clickable" data-id="' + Q.esc(j.id) + '">' +
        '<td>' + Q.esc(j.quoteNo) + '</td>' +
        '<td><strong>' + Q.esc(j.name || "(untitled)") + '</strong>' + (j.address ? '<br><span class="muted">' + Q.esc(j.address) + '</span>' : "") + '</td>' +
        '<td>' + Q.esc(j.customer) + '</td>' +
        '<td>' + Q.esc(Q.fmtDate(j.date)) + '</td>' +
        '<td><span class="status-pill status-' + Q.esc((j.status || "").replace(/\s+/g, "-")) + '">' + Q.esc(j.status) + '</span></td>' +
        '<td class="num">' + Q.money(c.total) + '</td>' +
        '<td class="num">' + Q.money(c.cost) + '</td>' +
        '<td class="num ' + (c.profit >= 0 ? "pos" : "neg") + '">' + Q.money(c.profit) + ' <span class="muted">(' + c.profitPct.toFixed(0) + '%)</span></td>' +
        '<td class="num">' + (c.actual ? Q.money(c.actual) : '<span class="muted">–</span>') + '</td>' +
        '</tr>';
    }).join("");
  }

  function tile(label, value, sub) {
    return '<div class="tile"><div class="tile-label">' + Q.esc(label) + '</div><div class="tile-value">' +
      Q.esc(value) + '</div><div class="tile-sub">' + Q.esc(sub) + '</div></div>';
  }

  body.addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-id]");
    if (tr) window.location.href = "job.html?id=" + encodeURIComponent(tr.getAttribute("data-id"));
  });
  search.addEventListener("input", render);
  statusFilter.addEventListener("change", function () {
    try { localStorage.setItem("qb_status_filter", statusFilter.value); } catch (e) { /* ignore */ }
    render();
  });

  document.getElementById("newJobBtn").addEventListener("click", function () {
    if (!state) return;
    var job = Q.newJob(state.catalog);
    var cat = Q.clone(state.catalog);
    cat.settings.nextQuoteNumber = (Q.num(cat.settings.nextQuoteNumber) || 1) + 1;
    Promise.all([QuoteStore.saveJob(job), QuoteStore.saveCatalog(cat)]).then(function () {
      window.location.href = "job.html?id=" + encodeURIComponent(job.id) + "&new=1";
    });
  });

  QuoteStore.init({
    onChange: function (s) { state = s; render(); },
    onStatus: Q.setSyncStatus
  });
})();
