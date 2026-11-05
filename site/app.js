/* NBA Projections - reads slate.json (made by build_slate.py) and draws the page. */
(function () {
  "use strict";

  // The order the stat chips appear in.
  var STAT_ORDER = ["pts", "pra", "fantasy", "reb", "fgm", "fg3m", "ast", "ra", "fg3a", "fg2m", "fga",
    "pr", "fg2a", "pa", "fta", "dreb", "tov", "oreb", "pf", "td", "stl_blk", "blk", "dd", "stl", "ftm"];

  var TEAM_COLORS = {
    ATL: ["#5a1e24", "#ffc2c7"], BOS: ["#12432b", "#b7f0cf"], BKN: ["#2b2b2b", "#e6e6e6"],
    CHA: ["#1c3e5a", "#bde6f7"], CHI: ["#5e1b1f", "#ffc4c7"], CLE: ["#4f1d2e", "#ffc3d6"],
    DAL: ["#1b3a66", "#c2d8ff"], DEN: ["#1d3557", "#ffe08a"], DET: ["#1f3a66", "#ffc2c7"],
    GSW: ["#1d3a6b", "#ffe08a"], HOU: ["#5a1e1e", "#ffd0c2"], IND: ["#1b3350", "#ffe08a"],
    LAC: ["#1b3a66", "#ffc2c7"], LAL: ["#4a2f7a", "#e3d4ff"], MEM: ["#1f3550", "#bfd3f2"],
    MIA: ["#5a1e2a", "#ffc2a8"], MIL: ["#1b4a32", "#e8e2c0"], MIN: ["#1c3a52", "#b7e8c8"],
    NOP: ["#1f2f4f", "#f2d7a0"], NYK: ["#1d3a6b", "#ffb36b"], OKC: ["#173f63", "#ffc09a"],
    ORL: ["#16365a", "#c4d3e8"], PHI: ["#1d3a6b", "#bbd2ff"], PHX: ["#3f2160", "#ffc27a"],
    POR: ["#3a2024", "#ffc2c7"], SAC: ["#3f2766", "#d9ccf2"], SAS: ["#2b2b2b", "#e6e6e6"],
    TOR: ["#5a1e2a", "#e4e4e4"], UTA: ["#2a2f5a", "#ffe08a"], WAS: ["#1d3a6b", "#ffc2c7"]
  };

  var state = { data: null, inj: null, score: null, stat: "pts", game: "all", q: "", cur: false, showOut: false, lines: {} };
  var byId = {};
  var injMap = {};
  var lastY = 0;

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(n, d) { return Number(n).toFixed(d === undefined ? 1 : d); }
  function pct(x) { return Math.round(x * 100) + "%"; }
  function plain(s) { return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function store(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* ignore */ } }
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function isSpecial(stat) { return stat === "dd" || stat === "td"; }
  function label(stat) { return state.data.meta.stat_labels[stat] || stat; }
  function initials(name) {
    var parts = name.replace(/[.,]/g, "").split(/\s+/).filter(Boolean);
    var skip = { jr: 1, sr: 1, ii: 1, iii: 1, iv: 1 };
    while (parts.length > 1 && skip[parts[parts.length - 1].toLowerCase()]) parts.pop();
    var a = parts[0] ? parts[0][0] : "";
    var b = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (a + b).toUpperCase();
  }
  function avatar(p, large) {
    var c = TEAM_COLORS[p.team] || ["#2a3441", "#e6e6e6"];
    return '<span class="avatar' + (large ? " lg" : "") + '" style="background:' + c[0] + ";color:" + c[1] + '">' +
      esc(initials(p.name)) + "</span>";
  }
  function gameOf(p) {
    for (var i = 0; i < state.data.games.length; i++) {
      if (state.data.games[i].game_id === p.game_id) return state.data.games[i];
    }
    return null;
  }
  function matchup(p) { return (p.where === "away" ? "@ " : "vs ") + p.opp; }

  // ---------- injuries and news ----------
  function normName(s) {
    return plain(s).replace(/[.'’]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
  }
  // null = injury data not loaded. Otherwise { kind, label, entry }.
  function injInfo(p) {
    if (!state.inj) return null;
    var e = injMap[normName(p.name)];
    if (!e) return { kind: "ok", label: "No injury listed", entry: null };
    var s = (e.status || "").toLowerCase();
    var kind = s.indexOf("out") !== -1 ? "out" :
      s.indexOf("doubtful") !== -1 ? "doubtful" :
      s.indexOf("question") !== -1 ? "questionable" :
      s.indexOf("day") !== -1 ? "dtd" :
      (s.indexOf("probable") !== -1 || s.indexOf("available") !== -1) ? "probable" : "other";
    var labels = { out: "OUT", doubtful: "Doubtful", questionable: "Questionable", dtd: "Day-to-day",
      probable: "Probable", other: e.status || "Listed" };
    return { kind: kind, label: labels[kind], entry: e };
  }
  function isOut(p) { var i = injInfo(p); return !!i && i.kind === "out"; }
  function statusBadge(p) {
    var i = injInfo(p);
    if (!i) return '<span class="badge">Status unverified</span>';
    var cls = i.kind === "ok" || i.kind === "probable" ? " ok" : (i.kind === "out" ? " out" : "");
    return '<span class="badge' + cls + '">' + esc(i.label) + "</span>";
  }
  function teammatesOut(p) {
    if (!state.inj) return [];
    return state.data.players.filter(function (q) {
      return q.team === p.team && q.id !== p.id && q.avg_min >= 20 && isOut(q);
    });
  }
  function newsFor(p) {
    if (!state.inj) return [];
    var n = normName(p.name);
    return state.inj.news.filter(function (a) {
      return normName(a.headline + " " + (a.description || "")).indexOf(n) !== -1;
    }).slice(0, 4);
  }
  function clock(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function timeOf(p) { var g = gameOf(p); return g && g.time ? g.time : ""; }

  // The block of numbers for one player and stat, honoring the "ignore last season" switch.
  function getBlock(p, stat) {
    var b = p.stats[stat];
    if (!b) return null;
    return state.cur ? (b.cur || null) : b;
  }
  function minutesOf(p) { return state.cur ? (p.min_cur != null ? p.min_cur : p.min) : p.min; }

  // ---------- probability math (mirrors project.py) ----------
  function lgamma(z) {
    var c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
      1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - lgamma(1 - z);
    z -= 1;
    var x = c[0];
    for (var i = 1; i < 9; i++) x += c[i] / (z + i);
    var t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function erf(x) {
    var s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function normCdf(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }

  function makeDist(mu, sd) {
    mu = Math.max(mu, 0.01);
    var v = Math.max(sd * sd, 0.05);
    if (mu < 25 && v > mu * 1.02) {
      var r = mu * mu / (v - mu), p = r / (r + mu);
      var kmax = Math.floor(mu + 12 * Math.sqrt(v) + 25);
      var pmf = [], total = 0, k;
      for (k = 0; k <= kmax; k++) {
        var lp = lgamma(k + r) - lgamma(r) - lgamma(k + 1) + r * Math.log(p) + k * Math.log(1 - p);
        pmf.push(Math.exp(lp));
        total += pmf[k];
      }
      var cdf = [], run = 0;
      for (k = 0; k <= kmax; k++) { pmf[k] /= total; run += pmf[k]; cdf.push(run); }
      return {
        F: function (n) { return n < 0 ? 0 : (n >= kmax ? 1 : cdf[n]); },
        pmf: function (n) { return n >= 0 && n <= kmax ? pmf[n] : 0; }
      };
    }
    var s = Math.sqrt(v), lo = normCdf((-0.5 - mu) / s);
    function F(n) { return n < 0 ? 0 : (normCdf((n + 0.5 - mu) / s) - lo) / (1 - lo); }
    return { F: F, pmf: function (n) { return F(n) - F(n - 1); } };
  }
  function lineProbs(block, line) {
    var d = makeDist(block.proj, block.sd);
    var over = Math.max(1 - d.F(Math.floor(line)), 0);
    var under = Math.max(d.F(Math.ceil(line) - 1), 0);
    var push = Number.isInteger(line) ? Math.max(d.pmf(line), 0) : 0;
    return { over: over, under: under, push: push };
  }

  // ---------- list view ----------
  function renderChips() {
    var keys = STAT_ORDER.filter(function (k) { return state.data.meta.stat_labels[k]; });
    $("statChips").innerHTML = keys.map(function (k) {
      return '<button type="button" class="chip" data-stat="' + k + '" aria-pressed="' + (k === state.stat) + '">' +
        esc(label(k)) + "</button>";
    }).join("");
  }
  function renderTabs() {
    var tabs = ['<button type="button" class="tab" data-game="all" aria-pressed="' + (state.game === "all") + '">All games</button>'];
    state.data.games.forEach(function (g) {
      tabs.push('<button type="button" class="tab" data-game="' + esc(g.game_id) + '" aria-pressed="' +
        (state.game === g.game_id) + '">' + esc(g.away + " @ " + g.home) + "</button>");
    });
    $("gameTabs").innerHTML = tabs.join("");
  }
  function renderList() {
    var q = plain(state.q.trim());
    var items = [], hidden = 0, outHidden = 0;
    state.data.players.forEach(function (p) {
      if (state.game !== "all" && p.game_id !== state.game) return;
      if (q && plain(p.name).indexOf(q) === -1) return;
      if (isOut(p) && !state.showOut) { outHidden++; return; }
      var b = getBlock(p, state.stat);
      if (!b) { hidden++; return; }
      items.push({ p: p, b: b });
    });
    var special = isSpecial(state.stat);
    items.sort(function (a, b) { return special ? b.b.p - a.b.p : b.b.proj - a.b.proj; });

    $("cards").innerHTML = items.map(function (it) {
      var p = it.p, b = it.b, big, sub, range;
      if (special) {
        big = pct(b.p);
        sub = "chance of " + label(state.stat).toLowerCase();
        range = recentHits(p, state.stat);
      } else {
        big = fmt(b.proj);
        sub = "projected " + label(state.stat).toLowerCase();
        range = "Typical " + fmt(b.lo) + " – " + fmt(b.hi);
      }
      var badges = statusBadge(p);
      if (p.b2b) badges += '<span class="badge">Back-to-back</span>';
      if (teammatesOut(p).length) badges += '<span class="badge">Teammate out</span>';
      return '<a class="card' + (isOut(p) ? " dim" : "") + '" href="#/p/' + p.id + "/" + state.stat + '">' +
        '<div class="who">' + avatar(p) + "<div><div class=\"name\">" + esc(p.name) + '</div><div class="meta">' +
        esc(p.team) + "</div></div></div>" +
        "<div><div class=\"big\">" + esc(big) + '</div><div class="big-label">' + esc(sub) + "</div></div>" +
        '<div class="foot"><span class="r1">' + esc(range) + '</span><span class="r2">' +
        esc(matchup(p) + (timeOf(p) ? " · " + timeOf(p) : "")) + "</span></div>" +
        '<div class="badges">' + badges + "</div></a>";
    }).join("");

    var msg = "";
    if (!items.length) msg = '<p class="empty">No players match.</p>';
    $("listMsg").innerHTML = msg;
    var note = $("listNote"), notes = [];
    if (outHidden) notes.push(outHidden + " player" + (outHidden === 1 ? " is" : "s are") + " hidden because they are listed out.");
    if (state.cur && hidden) {
      notes.push(hidden + " player" + (hidden === 1 ? " is" : "s are") +
        " hidden because they have fewer than 3 games this season.");
    }
    note.hidden = !notes.length;
    note.textContent = notes.join(" ");
  }
  function recentHits(p, stat) {
    var need = stat === "dd" ? 2 : 3, hits = 0;
    p.recent.forEach(function (g) { if (catsOver10(g) >= need) hits++; });
    return "Hit in " + hits + " of last " + p.recent.length;
  }
  function catsOver10(g) {
    var n = 0;
    ["pts", "reb", "ast", "stl", "blk"].forEach(function (k) { if (g.s[k] >= 10) n++; });
    return n;
  }
  function renderSub() {
    var m = state.data.meta, parts = m.slate_date.split("-");
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var dd = m.data_through.split("-");
    var through = new Date(+dd[0], +dd[1] - 1, +dd[2]);
    var o = { month: "short", day: "numeric" };
    $("subline").textContent = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
      " · " + state.data.games.length + " games · " + state.data.players.length +
      " players · data through " + through.toLocaleDateString("en-US", o) +
      (state.inj ? " · injuries updated " + clock(state.inj.meta.generated_at) : "");
  }

  // ---------- detail view ----------
  function showDetail(id, stat) {
    var p = byId[id];
    var d = $("detailView");
    if (!p) { location.hash = ""; return; }
    if (!p.stats[stat]) stat = p.stats.pts ? "pts" : Object.keys(p.stats)[0];
    var special = isSpecial(stat);
    var block = getBlock(p, stat), fallback = false;
    if (!block) { block = p.stats[stat]; fallback = true; }

    var g = gameOf(p);
    var tabs = STAT_ORDER.filter(function (k) { return p.stats[k]; }).map(function (k) {
      return '<a class="chip' + (k === stat ? " on" : "") + '" href="#/p/' + p.id + "/" + k + '">' + esc(label(k)) + "</a>";
    }).join("");

    var html = "";
    html += '<a class="back" href="#"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>Slate</a>';
    html += '<div class="hero">' + avatar(p, true) + "<div><h1>" + esc(p.name) + '</h1><div class="meta">' +
      esc(p.team + " · " + matchup(p) + (g && g.time ? " · " + g.time : "")) + '</div><div class="badges">' +
      statusBadge(p) + (p.b2b ? '<span class="badge">Back-to-back</span>' : "") +
      "</div></div></div>";
    html += injuryPanel(p);

    html += '<div class="toggle-card" style="margin-top:16px"><div><div class="t1">Ignore last season</div>' +
      '<div class="t2">Project from this season\'s games only</div></div>' +
      '<button type="button" class="switch" id="curToggle2" aria-pressed="' + state.cur + '" aria-label="Ignore last season">' +
      '<span class="track"><span class="knob"></span></span></button></div>';

    html += '<div class="scroller" style="margin-top:0">' + tabs + "</div>";

    if (fallback) {
      html += '<p class="warn">Not enough games this season to ignore last season for this stat, so this uses both seasons.</p>';
    }
    p.warnings.forEach(function (w) {
      w = w.replace("--no-last-season ignores it entirely", 'the "Ignore last season" switch ignores it entirely');
      html += '<p class="warn">' + esc(w) + "</p>";
    });

    if (special) {
      html += specialPanel(p, stat, block);
    } else {
      html += projPanel(p, stat, block);
      html += linePanel(p, stat, block);
      html += whyPanel(p, stat, block);
    }
    html += lastFivePanel(p, stat, block, special);
    html += vsPanel(p, stat, special);
    html += newsPanel(p);
    html += '<p class="note" style="margin:16px 0 40px">Projections are estimates from box-score history, not betting advice. ' +
      (state.inj ? "Injury status comes from ESPN and can change before tip-off." : "Injury status is not checked yet.") + "</p>";

    d.innerHTML = html;
    $("curToggle2").addEventListener("click", toggleCur);
    var input = $("lineInput");
    if (input) {
      input.addEventListener("input", function () {
        var v = parseFloat(input.value);
        if (isFinite(v)) state.lines[p.id + ":" + stat] = v; else delete state.lines[p.id + ":" + stat];
        store("line:" + p.id + ":" + stat, isFinite(v) ? String(v) : "");
        applyLine(p, stat, block);
      });
      applyLine(p, stat, block);
    }
  }

  function injuryPanel(p) {
    var i = injInfo(p), html = "";
    if (i && i.entry) {
      var e = i.entry;
      var sev = i.kind === "out" ? "out" : "";
      html += '<section class="panel injury ' + sev + '"><h2>' + esc(i.label) + (e.detail ? " · " + esc(e.detail) : "") + "</h2>" +
        (e.comment ? '<p class="soon">' + esc(e.comment) + "</p>" : "") +
        '<p class="note">Source: ESPN' + (e.date ? ", " + esc(shortDate(e.date.slice(0, 10))) : "") +
        (state.inj ? ". Checked " + esc(clock(state.inj.meta.generated_at)) : "") + ".</p>" +
        (i.kind === "out" ? '<p class="note">This projection assumes he plays. Ignore it unless his status changes.</p>' : "") +
        "</section>";
    }
    var tm = teammatesOut(p);
    if (tm.length) {
      html += '<p class="warn">Teammates listed out: ' + tm.map(function (q) { return esc(q.name); }).join(", ") +
        ". That can mean more minutes and shots for " + esc(p.name.split(" ")[0]) + ", which the projection does not include yet.</p>";
    }
    return html;
  }

  function newsPanel(p) {
    var items = newsFor(p);
    var html = '<section class="panel"><h2>News</h2>';
    if (!state.inj) {
      return html + '<p class="soon">Headlines show up here once the injury and news file is loaded.</p></section>';
    }
    if (!items.length) {
      return html + '<p class="soon">No recent headlines mention this player.</p></section>';
    }
    html += '<div class="news">';
    items.forEach(function (a) {
      var when = a.published ? shortDate(a.published.slice(0, 10)) : "";
      var inner = '<span class="h">' + esc(a.headline) + '</span><span class="note">ESPN' + (when ? " · " + esc(when) : "") + "</span>";
      html += a.url ? '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + inner + "</a>" : "<div>" + inner + "</div>";
    });
    return html + "</div></section>";
  }

  function rangeScale(block, line) {
    var lo = Math.max(0, block.proj - 3.2 * block.sd), hi = block.proj + 3.2 * block.sd;
    if (line != null) { lo = Math.min(lo, line - 0.5); hi = Math.max(hi, line + 0.5); }
    lo = Math.floor(Math.max(lo, 0)); hi = Math.ceil(hi);
    if (hi - lo < 2) hi = lo + 2;
    return { lo: lo, hi: hi };
  }
  function pos(x, sc) { return Math.min(100, Math.max(0, (x - sc.lo) / (sc.hi - sc.lo) * 100)); }

  function projPanel(p, stat, b) {
    var sc = rangeScale(b, state.lines[p.id + ":" + stat]);
    var mid = (sc.lo + sc.hi) / 2;
    return '<section class="panel"><div class="proj-row"><div><div class="big-label">Projected ' +
      esc(label(stat).toLowerCase()) + '</div><div class="proj-num">' + fmt(b.proj) + "</div></div>" +
      '<div class="proj-side"><div class="a">Typical ' + fmt(b.lo) + " – " + fmt(b.hi) +
      '</div><div class="b">middle half of outcomes</div></div></div>' +
      '<div><div class="rangebar" id="rangeBar" data-lo="' + sc.lo + '" data-hi="' + sc.hi + '">' +
      '<div class="rail"></div><div class="span" style="left:' + pos(b.lo, sc) + "%;width:" + (pos(b.hi, sc) - pos(b.lo, sc)) +
      '%"></div><div class="mark" style="left:' + pos(b.proj, sc) + '%"></div><div class="linemark" id="lineMark" hidden></div></div>' +
      '<div class="scale"><span>' + sc.lo + "</span><span>" + Math.round(mid) + "</span><span>" + sc.hi + "</span></div></div>" +
      '<div class="legend"><span><i style="background:var(--accent)"></i>Model ' + fmt(b.proj) +
      '</span><span id="lineLegend" hidden><i style="background:var(--amber)"></i><span id="lineLegendText"></span></span></div></section>';
  }

  function linePanel(p, stat, b) {
    var saved = state.lines[p.id + ":" + stat];
    if (saved === undefined) {
      var s = load("line:" + p.id + ":" + stat);
      if (s) { saved = parseFloat(s); if (isFinite(saved)) state.lines[p.id + ":" + stat] = saved; else saved = undefined; }
    }
    return '<section class="panel"><h2>Compare to a line</h2><div class="line-form">' +
      '<label for="lineInput">Type a line from PrizePicks or a sportsbook</label>' +
      '<input id="lineInput" type="number" inputmode="decimal" step="0.5" min="0" value="' +
      (saved !== undefined ? saved : "") + '" placeholder="' + fmt(Math.round(b.proj * 2) / 2) + '"></div>' +
      '<div class="probs" id="lineResult"><p class="note">Enter a line to see the model\'s chance of going over or under it.</p></div></section>';
  }
  function applyLine(p, stat, block) {
    var line = state.lines[p.id + ":" + stat];
    var res = $("lineResult"), mark = $("lineMark"), legend = $("lineLegend");
    if (line === undefined || !isFinite(line)) {
      res.innerHTML = '<p class="note">Enter a line to see the model\'s chance of going over or under it.</p>';
      mark.hidden = true; legend.hidden = true;
      return;
    }
    var pr = lineProbs(block, line);
    var diff = block.proj - line;
    var hasPush = pr.push > 0.005;
    var html = '<div class="probbar"><div class="over" style="width:' + (pr.over * 100) + '%"></div>' +
      (hasPush ? '<div class="push" style="width:' + (pr.push * 100) + '%"></div>' : "") +
      '<div class="under"></div></div>' +
      '<div class="problabels"><span><i class="o"></i>Over <b>' + pct(pr.over) + "</b></span>" +
      (hasPush ? '<span><i class="p"></i>Push <b>' + pct(pr.push) + "</b></span>" : "") +
      '<span><i class="u"></i>Under <b>' + pct(pr.under) + "</b></span></div>" +
      '<p class="note">The model projects ' + fmt(block.proj) + ", which is " + (diff >= 0 ? "+" : "") + fmt(diff) +
      " vs the line." + (hasPush ? " A push means landing exactly on the line." : "") + "</p>";
    res.innerHTML = html;
    var bar = $("rangeBar"), sc = { lo: +bar.dataset.lo, hi: +bar.dataset.hi };
    if (line < sc.lo || line > sc.hi) {
      showDetail(p.id, stat);
      var again = $("lineInput");
      if (again) { again.focus(); var n = again.value.length; try { again.setSelectionRange(n, n); } catch (e) { /* number input */ } }
      return;
    }
    mark.hidden = false;
    mark.style.left = pos(line, sc) + "%";
    legend.hidden = false;
    $("lineLegendText").textContent = "Line " + line;
  }

  function whyPanel(p, stat, b) {
    var opp = b.opp, oppNote = opp < 0.98 ? "Tougher than the league average" : (opp > 1.02 ? "Weaker than the league average" : "About the league average");
    var rows = [
      ["Expected minutes", "Recent games count the most", fmt(minutesOf(p))],
      ["Rate per minute", "From this season" + (state.cur ? "" : " and last"), fmt(b.rate, 3)],
      ["Opponent: " + p.opp, oppNote, "× " + fmt(opp, 3)],
      ["Game pace", "How fast this game should play", "× " + fmt(p.pace, 3)],
      [p.where === "home" ? "Home game" : "Away game", "Small adjustment", "× " + fmt(p.home_factor, 3)]
    ];
    var html = '<section class="panel"><h2>Why this number</h2><div class="why">';
    rows.forEach(function (r) {
      html += '<div><div><div class="l">' + esc(r[0]) + '</div><div class="n">' + esc(r[1]) + '</div></div><span class="v">' + esc(r[2]) + "</span></div>";
    });
    html += '<div class="total"><div><div class="l">Projection</div><div class="n">Expected ' + esc(label(stat).toLowerCase()) +
      '</div></div><span class="v">' + fmt(b.proj) + "</span></div></div>";
    if (p.b2b) html += '<p class="note">Back-to-back: expected minutes are already trimmed.</p>';
    return html + "</section>";
  }

  function specialPanel(p, stat, b) {
    return '<section class="panel"><div class="proj-row"><div><div class="big-label">Chance of ' + esc(label(stat).toLowerCase()) +
      '</div><div class="proj-num">' + pct(b.p) + '</div></div><div class="proj-side"><div class="a">' + esc(recentHits(p, stat)) +
      '</div><div class="b">estimated by simulation</div></div></div>' +
      '<p class="note">Rare events are hard to estimate, so treat this loosely.</p></section>';
  }

  function valueFor(g, stat) {
    if (isSpecial(stat)) return catsOver10(g) >= (stat === "dd" ? 2 : 3) ? 1 : 0;
    return g.s[stat];
  }

  function lastFivePanel(p, stat, b, special) {
    var rows = p.recent;
    if (!rows.length) return "";
    var max = 1, i;
    for (i = 0; i < rows.length; i++) max = Math.max(max, valueFor(rows[i], stat));
    if (!special) max = Math.max(max, b.proj);
    max *= 1.15;
    var sum = 0;
    var html = '<section class="panel"><div style="display:flex;justify-content:space-between;align-items:baseline"><h2>Last ' +
      rows.length + " games</h2><span class=\"note\" id=\"l5avg\"></span></div><div>";
    rows.forEach(function (g) {
      var v = valueFor(g, stat);
      sum += special ? 0 : v;
      var hi = special ? v === 1 : v >= b.proj;
      var shown = special ? (v ? "Yes" : "No") : (stat === "fantasy" ? fmt(v) : v);
      html += '<div class="gamerow"><div class="who2"><b>' + esc((g.home ? "vs " : "@ ") + g.opp) + "</b><span>" +
        esc(shortDate(g.date)) + '</span></div><div class="track"><div class="fill' + (hi ? " hi" : "") +
        '" style="width:' + (special ? (v ? 100 : 0) : v / max * 100) + '%"></div>' +
        (special ? "" : '<div class="tick" style="left:' + (b.proj / max * 100) + '%"></div>') +
        '</div><span class="val" style="width:' + (special ? 40 : 34) + 'px">' + esc(shown) + "</span></div>";
    });
    html += "</div>";
    if (!special) {
      html = html.replace('id="l5avg"></span>', 'id="l5avg">avg ' + fmt(sum / rows.length) + "</span>");
      html += '<p class="note">White tick = today\'s projection. Brighter bars beat it.</p>';
    }
    return html + "</section>";
  }
  function shortDate(s) {
    var a = s.split("-");
    return new Date(+a[0], +a[1] - 1, +a[2]).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function vsPanel(p, stat, special) {
    var rows = p.vs_opp;
    var html = '<section class="panel"><h2>Against ' + esc(p.opp) + "</h2>";
    if (!rows.length) {
      return html + '<p class="note">No games against ' + esc(p.opp) + " in the database.</p></section>";
    }
    var vals = rows.map(function (g) { return valueFor(g, stat); });
    var sum = vals.reduce(function (a, c) { return a + c; }, 0);
    var big = special ? sum + " of " + rows.length : fmt(sum / rows.length);
    var l2 = special ? "games hit" : "avg " + label(stat).toLowerCase();
    html += '<div class="minis"' + (special ? ' style="grid-template-columns:repeat(2,minmax(0,1fr))"' : "") +
      '><div class="mini"><b>' + rows.length + "</b><span>games vs " + esc(p.opp) + '</span></div>' +
      '<div class="mini"><b>' + esc(big) + "</b><span>" + esc(l2) + "</span></div>" +
      (special ? "" : '<div class="mini"><b>' + fmt(Math.max.apply(null, vals), stat === "fantasy" ? 1 : 0) +
        "</b><span>best game</span></div>") + "</div>";
    html += '<div class="vslist">' + rows.map(function (g, i) {
      var v = vals[i];
      return "<span>" + esc(shortDate(g.date)) + ": <b>" + (special ? (v ? "Yes" : "No") : (stat === "fantasy" ? fmt(v) : v)) + "</b></span>";
    }).join("") + "</div>";
    html += '<p class="note">Only a few games, so this is context rather than a prediction.</p>';
    return html + "</section>";
  }

  // ---------- last night ----------
  function longDate(iso) {
    var p = iso.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }
  function shortDate(iso) {
    var p = iso.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  function signed(n, d) { var v = Number(n); return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d === undefined ? 1 : d); }
  function highLow(bias) {
    var b = Number(bias);
    if (Math.abs(b) < 0.05) return "right on average";
    return "ran " + Math.abs(b).toFixed(1) + (b > 0 ? " high" : " low");
  }
  function hitBar(v, target) {
    return '<div class="hitbar"><span class="hitfill" style="width:' + Math.round(v * 100) + '%"></span>' +
      '<span class="hittick" style="left:' + Math.round(target * 100) + '%"></span></div>';
  }
  function who(x) { return '<b>' + esc(x.name) + '</b> <span class="tm">' + esc(x.team) + "</span>"; }

  function lastSummary(s) {
    var acc = s.accuracy[0];
    var inj = s.injury || {};
    var html = '<div class="minis">';
    if (acc) html += '<div class="mini"><b>' + fmt(acc.mae) + '</b><span>average miss, ' + esc(acc.label.toLowerCase()) + "</span></div>";
    html += '<div class="mini"><b>' + fmt(s.minutes.projected, 0) + "→" + fmt(s.minutes.actual, 0) +
      "</b><span>minutes, projected → played</span></div>";
    if (inj.available) {
      var sat = inj.listed_out - inj.played_anyway.length;
      html += '<div class="mini"><b>' + sat + "/" + inj.listed_out + "</b><span>listed out, really sat</span></div>";
    } else {
      html += '<div class="mini"><b>' + s.meta.players_graded + "</b><span>players graded</span></div>";
    }
    return html + "</div>";
  }

  function lastAccuracy(s) {
    var html = '<section class="panel"><h2>Did players land in our range?</h2>' +
      '<p class="note">Every card shows a "Typical" range, built so about half of players should finish inside it. ' +
      'Each bar is how many actually did. If the green stops near the white line, the ranges are the right width. ' +
      'Past the line means they were a bit wide, short of it means a bit narrow.</p>';
    s.accuracy.forEach(function (a) {
      html += '<div class="accrow"><div class="acctop"><b>' + esc(a.label) + '</b>' +
        '<span>missed by ' + fmt(a.mae) + " on average · " + highLow(a.bias) + "</span></div>" +
        hitBar(a.inside50, 0.5) +
        '<div class="accbot"><span>' + pct(a.inside50) + " inside the range</span><span>" + a.n + " players</span></div></div>";
    });
    return html + "</section>";
  }

  function surpriseList(items, tone) {
    var html = '<div class="surp ' + tone + '">';
    items.forEach(function (x) {
      html += "<div><div>" + who(x) + '<div class="note">' + fmt(x.proj_min, 0) + " min projected, " + fmt(x.act_min, 0) +
        " played</div></div>" + '<div class="surpnum"><span>' + fmt(x.proj) + "</span> → <b>" + fmt(x.actual) + "</b></div></div>";
    });
    return html + "</div>";
  }
  function lastSurprises(s) {
    var sp = s.surprises;
    if (!sp || !sp.beat) return "";
    return '<section class="panel"><h2>Biggest surprises</h2><p class="note">' + esc(sp.label) +
      ", projected → actual.</p>" +
      '<div class="sub2">Beat the number</div>' + surpriseList(sp.beat, "up") +
      '<div class="sub2">Fell short</div>' + surpriseList(sp.short, "down") + "</section>";
  }

  function lastInjury(s) {
    var inj = s.injury;
    if (!inj || !inj.available) return "";
    var html = '<section class="panel"><h2>Was the injury list right?</h2>';
    html += "<p>" + inj.listed_out + (inj.listed_out === 1 ? " player was" : " players were") + " listed out. " +
      (inj.played_anyway.length === 0 ? "None" : inj.played_anyway.length) + " played anyway.</p>";
    if (inj.played_anyway.length) {
      html += '<div class="vslist">';
      inj.played_anyway.forEach(function (x) { html += "<span><b>" + esc(x.name) + "</b> " + esc(x.team) + " · " + fmt(x.minutes, 0) + " min</span>"; });
      html += "</div>";
    }
    html += '<p class="note">Listed questionable or day-to-day: ' + inj.flagged_played + " played, " + inj.flagged_dnp + " did not.</p>";
    var n = inj.unlisted_dnp.length;
    if (n) {
      html += "<details><summary>" + n + " rotation players sat without being listed out</summary>" +
        '<div class="vslist" style="margin-top:10px">';
      inj.unlisted_dnp.forEach(function (x) { html += "<span><b>" + esc(x.name) + "</b> " + esc(x.team) + "</span>"; });
      html += "</div></details>";
    } else {
      html += '<p class="note">Nobody surprising sat out.</p>';
    }
    return html + "</section>";
  }

  function teamRow(title, g, note) {
    return '<div class="trow"><div><b>' + title + '</b><div class="note">' + g.n + " players" + (note || "") + "</div></div>" +
      '<div class="tnum">' + signed(g.miss) + "</div></div>";
  }
  function lastTeammate(s) {
    var t = s.teammate;
    var pooled = s.pooled_teammate && s.pooled_teammate.nights >= 2 ? s.pooled_teammate : null;
    if (!t && !pooled) return "";
    var html = '<section class="panel"><h2>When a teammate sits</h2>' +
      '<p class="note">Actual minus projected. If the first number keeps coming out clearly higher, our projections should add something when a rotation player is out.</p>';
    if (t) {
      html += '<div class="sub2">Last night, ' + esc(t.label.toLowerCase()) + "</div>" +
        teamRow("A rotation teammate was out", t.with_out, " · " + signed(t.with_out.minutes) + " min vs projection") +
        teamRow("Everyone else", t.without, " · " + signed(t.without.minutes) + " min vs projection");
    }
    if (pooled) {
      html += '<div class="sub2">All ' + pooled.nights + " nights combined, points</div>" +
        teamRow("A rotation teammate was out", { n: pooled.with_n, miss: pooled.with_miss }, " · " + signed(pooled.with_min) + " min") +
        teamRow("Everyone else", { n: pooled.without_n, miss: pooled.without_miss }, " · " + signed(pooled.without_min) + " min");
    }
    return html + "</section>";
  }

  function lastHistory(s) {
    var h = s.history || [];
    var html = '<section class="panel"><h2>Track record</h2>';
    if (h.length < 2) {
      html += '<p class="note">One night is too small to judge anything. Come back after a few more nights and this fills in.</p>';
      return html + "</section>";
    }
    html += '<p class="note">Points: average miss and how often the real number landed in the middle range.</p><div class="hist">';
    h.slice().reverse().slice(0, 14).forEach(function (n) {
      html += '<div class="histrow"><span class="hd">' + shortDate(n.date) + '</span>' +
        '<span class="hm">' + fmt(n.pts_mae) + " miss</span>" + hitBar(n.inside50, 0.5) +
        '<span class="hp">' + pct(n.inside50) + "</span></div>";
    });
    return html + "</div></section>";
  }

  function renderLast() {
    var s = state.score;
    var html = '<div class="top" style="padding-top:8px"><div><h1 class="title">Last night</h1>' +
      '<p class="sub">' + esc(longDate(s.meta.slate_date)) + " · " + s.meta.games_done + " of " + s.meta.games_total +
      " games · " + s.meta.players_graded + " players graded</p></div></div>";
    html += '<section class="panel">' + lastSummary(s) + "</section>";
    html += lastAccuracy(s) + lastSurprises(s) + lastInjury(s) + lastTeammate(s) + lastHistory(s);
    html += '<p class="note footer">Projections were saved before tip-off, then compared with the final box scores. ' +
      "One night is a small sample, so the numbers will bounce around. Not betting advice.</p>";
    $("lastView").innerHTML = html;
  }

  // ---------- wiring ----------
  function toggleCur() {
    state.cur = !state.cur;
    store("ignoreLast", state.cur ? "1" : "0");
    $("curToggle").setAttribute("aria-pressed", state.cur);
    route();
  }
  function route() {
    var m = location.hash.match(/^#\/p\/(\d+)\/(\w+)/);
    var onLast = location.hash === "#/last" && !!state.score;
    if (!$("listView").hidden) lastY = window.scrollY;
    $("nav").hidden = !!m || !state.score;
    $("navTonight").setAttribute("aria-current", !onLast && !m ? "page" : "false");
    $("navLast").setAttribute("aria-current", onLast ? "page" : "false");
    if (m) {
      $("listView").hidden = true;
      $("lastView").hidden = true;
      $("detailView").hidden = false;
      showDetail(+m[1], m[2]);
      window.scrollTo(0, 0);
    } else if (onLast) {
      $("listView").hidden = true;
      $("detailView").hidden = true;
      $("lastView").hidden = false;
      renderLast();
      window.scrollTo(0, 0);
    } else {
      $("detailView").hidden = true;
      $("lastView").hidden = true;
      $("listView").hidden = false;
      renderList();
      window.scrollTo(0, lastY);
    }
  }

  function start(data) {
    state.data = data;
    data.players.forEach(function (p) { byId[p.id] = p; });
    if (!data.meta.stat_labels[state.stat]) state.stat = Object.keys(data.meta.stat_labels)[0];
    state.cur = !!data.meta.has_current_only && load("ignoreLast") === "1";
    $("curToggle").setAttribute("aria-pressed", state.cur);
    if (!data.meta.has_current_only) $("curToggle").closest(".toggle-card").hidden = true;
    renderSub(); renderChips(); renderTabs();

    $("curToggle").addEventListener("click", toggleCur);
    $("statChips").addEventListener("click", function (e) {
      var b = e.target.closest("[data-stat]");
      if (!b) return;
      state.stat = b.dataset.stat; renderChips(); renderList();
    });
    $("gameTabs").addEventListener("click", function (e) {
      var b = e.target.closest("[data-game]");
      if (!b) return;
      state.game = b.dataset.game; renderTabs(); renderList();
    });
    $("search").addEventListener("input", function (e) { state.q = e.target.value; renderList(); });
    if (state.inj) {
      $("outRow").hidden = false;
      $("showOut").addEventListener("change", function (e) { state.showOut = e.target.checked; renderList(); });
    }
    window.addEventListener("hashchange", route);
    route();
  }

  function fail(msg) {
    $("subline").textContent = "";
    $("cards").innerHTML = "";
    $("listMsg").innerHTML = '<div class="error">' + msg + "</div>";
  }

  // Injuries are optional: if injuries.json is missing the page still works.
  function loadInjuries() {
    return fetch("injuries.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) {
        j.news = j.news || [];
        (j.players || []).forEach(function (e) { injMap[normName(e.name)] = e; });
        state.inj = j;
      })
      .catch(function () { state.inj = null; });
  }

  // The Last night report is optional too: no scorecard.json, no tab.
  function loadScore() {
    return fetch("scorecard.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { state.score = j && j.meta && j.accuracy && j.accuracy.length ? j : null; })
      .catch(function () { state.score = null; });
  }

  fetch("slate.json", { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) { return Promise.all([loadInjuries(), loadScore()]).then(function () { start(data); }); })
    .catch(function () {
      fail("Couldn't load <code>slate.json</code>. Run <code>python build_slate.py</code> first. " +
        "If you opened <code>index.html</code> by double-clicking it, open it through a local server instead: " +
        "in the <code>site</code> folder run <code>python -m http.server 8000</code> and visit <code>http://localhost:8000</code>.");
    });
})();
