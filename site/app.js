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

  var state = { data: null, slate: null, preview: null, slateDate: "", day: null, days: [], dayCache: {}, liveInj: null, liveRes: null, res: null, finalGames: {}, inj: null, score: null, stat: "pts", game: "all", q: "", cur: false, showOut: false, lines: {}, view: "cards", back: "", more: false, mine: [], hq: "", pick: null, hnum: "", cstat: "pts", chk: null, shown: "", pp: null };
  var byId = {};
  var injMap = {};

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
    if (i.kind === "ok") return "";
    var cls = i.kind === "probable" ? " ok" : (i.kind === "out" ? " out" : "");
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
    $("listKey").hidden = true;
    if (!state.data.games.length) {
      $("cards").innerHTML = "";
      $("listNote").hidden = true;
      $("listMsg").innerHTML = '<p class="empty">No games scheduled for ' + esc(dayLabel(state.data.meta.slate_date)) + ".</p>";
      return;
    }
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

    var asList = state.view === "list";
    $("cards").className = asList ? "rows" : "grid";
    $("listKey").hidden = !asList || special || !items.length;
    var scale = asList && !special ? statScale(state.stat) : 0;

    $("cards").innerHTML = asList ? items.map(function (it) {
      return listRow(it.p, it.b, state.stat, special, scale);
    }).join("") : items.map(function (it) {
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
      return '<a class="card' + (isOut(p) ? " dim" : "") + '" href="' + pHref(p.id, state.stat) + '">' +
        '<div class="who">' + avatar(p) + "<div><div class=\"name\">" + esc(p.name) + '</div><div class="meta">' +
        esc(p.team) + "</div></div></div>" +
        "<div><div class=\"big\">" + esc(big) + '</div><div class="big-label">' + esc(sub) + (special ? "" : changeHtml(b)) + "</div></div>" +
        resultHtml(p, state.stat, b) +
        '<div class="foot">' + ppCard(p, state.stat) + '<span class="r1">' + esc(range) + '</span><span class="r2">' +
        esc(matchup(p) + (gameTime(p) ? " · " + gameTime(p) : "")) + "</span></div>" +
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
  // ---------- list view (one row per player, with a range bar) ----------
  // One scale for the whole day and stat, so bars can be compared from row to row.
  function statScale(stat) {
    var max = 0;
    state.data.players.forEach(function (p) {
      var b = getBlock(p, stat);
      if (!b || b.hi == null) return;
      if (b.hi > max) max = b.hi;
      var r = state.res && state.res.players[p.id];
      if (r && r[stat] != null && r[stat] > max) max = r[stat];
    });
    return Math.max(1, Math.ceil(max * 1.04));
  }
  function barPct(v, scale) { return Math.max(0, Math.min(100, v / scale * 100)).toFixed(1); }
  function listBadges(p) {
    var i = injInfo(p), out = "";
    if (!i) out += '<span class="badge">Status unverified</span>';
    else if (i.kind !== "ok") out += statusBadge(p);
    if (p.b2b) out += '<span class="badge">B2B</span>';
    if (teammatesOut(p).length) out += '<span class="badge">Teammate out</span>';
    return out;
  }
  // The right-hand label and the dot on the bar once the game is final.
  function listFinal(p, stat, b, special) {
    var none = { label: "", dot: "", tone: "" };
    if (!state.res) return none;
    var r = state.res.players[p.id];
    if (!r) return state.finalGames[p.game_id] ? { label: '<small>Final</small><b class="in">DNP</b>', dot: "", tone: "" } : none;
    var v = r[stat];
    if (v == null) return none;
    if (special) return { label: '<small>Final</small><b class="' + (v ? "above" : "in") + '">' + (v ? "Yes" : "No") + "</b>", dot: "", tone: "" };
    var tone = toneOf(v, b);
    var arrow = tone === "above" ? "▲ " : tone === "below" ? "▼ " : "";
    return { label: '<small>Final</small><b class="' + tone + '">' + arrow + shown(v) + "</b>", value: v, tone: tone };
  }
  function listRow(p, b, stat, special, scale) {
    var big = special ? pct(b.p) : fmt(b.proj);
    var fin = listFinal(p, stat, b, special);
    var tip = timeOf(p).replace(/\s*(ET|EST|EDT)$/i, "");
    var meta = p.team + " " + matchup(p) + (state.finalGames[p.game_id] ? "" : (tip ? " · " + tip : ""));
    var mid, label;
    if (special) {
      mid = '<span class="lnote">' + esc(recentHits(p, stat)) + "</span>";
      label = fin.label;
    } else {
      var aria = "Typical range " + fmt(b.lo) + " to " + fmt(b.hi) + ", projected " + fmt(b.proj) +
        (fin.value != null ? ", finished " + shown(fin.value) : "");
      mid = '<span class="lbar" role="img" aria-label="' + esc(aria) + '">' +
        '<span class="lband" style="left:' + barPct(b.lo, scale) + "%;width:" + (barPct(b.hi, scale) - barPct(b.lo, scale)).toFixed(1) + '%"></span>' +
        '<span class="ltick" style="left:' + barPct(b.proj, scale) + '%"></span>' +
        ppTick(p, stat, scale) +
        (fin.value != null ? '<span class="ldot ' + fin.tone + '" style="left:' + barPct(fin.value, scale) + '%"></span>' : "") +
        "</span>";
      label = fin.label || '<span class="lrange">' + fmt(b.lo) + " – " + fmt(b.hi) + "</span>";
    }
    return '<a class="lrow' + (isOut(p) ? " dim" : "") + '" href="' + pHref(p.id, stat) + '">' +
      '<div class="ltop"><div class="lwho"><span class="lname">' + esc(p.name) + "</span>" + listBadges(p) + "</div>" +
      '<div class="lproj">' + ppList(p, stat) + (special ? "" : changeHtml(b)) + "<b>" + esc(big) + "</b></div></div>" +
      '<div class="lmid"><span class="lmeta">' + esc(meta) + "</span>" + mid + '<span class="llab">' + label + "</span></div></a>";
  }
  function renderView() {
    var btns = document.querySelectorAll("#viewSeg [data-view]");
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute("aria-pressed", btns[i].dataset.view === state.view);
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
    var m = state.data.meta;
    var nGames = state.data.games.length;
    var fin = state.res ? state.res.meta.games_final.length : 0;
    var live = state.data === state.slate;
    var isPrev = !!state.preview && state.data === state.preview;
    var parts = [dayLabel(m.slate_date), fin ? fin + " of " + nGames + " games final" : (nGames ? nGames + " games" : "no games"),
      state.data.players.length + " players"];
    if (live || isPrev) {
      var dd = m.data_through.split("-");
      parts.push("data through " + new Date(+dd[0], +dd[1] - 1, +dd[2]).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
      if (state.inj && clock(state.inj.meta.generated_at)) parts.push("injuries updated " + clock(state.inj.meta.generated_at));
    } else {
      parts.push("projected before tip-off");
      if (state.inj && clock(state.inj.meta.generated_at)) parts.push("injuries as of " + clock(state.inj.meta.generated_at));
    }
    $("subline").textContent = parts.join(" · ");
    $("dayTitle").textContent = dayWord(m.slate_date);
    $("previewNote").hidden = !isPrev || !nGames;
    if (isPrev) {
      $("previewNote").textContent = "Preview. These projections use games through " + shortDate(m.data_through) +
        ". Lineups and injuries can change before tip-off, and the numbers update as new results come in.";
    }

    var dates = availableDates(), i = dates.indexOf(state.day);
    $("dayNav").hidden = false;
    $("daySelect").innerHTML = dates.slice().reverse().map(function (d) {
      return '<option value="' + d + '"' + (d === state.day ? " selected" : "") + ">" + esc(dayLabel(d)) + "</option>";
    }).join("");
    $("dayPrev").disabled = i <= 0;
    $("dayNext").disabled = i < 0 || i >= dates.length - 1;
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
      return '<a class="chip' + (k === stat ? " on" : "") + '" href="' + pHref(p.id, k) + '">' + esc(label(k)) + "</a>";
    }).join("");

    var html = "";
    var bk = backInfo(dayHash(state.day), "Games");
    html += '<a class="back" href="' + esc(bk.href) + '">' + BACK_SVG + esc(bk.label) + "</a>";
    html += '<div class="hero">' + avatar(p, true) + "<div><h1>" + esc(p.name) + '</h1><div class="meta">' +
      esc(p.team + " · " + matchup(p) + (gameTime(p) ? " · " + gameTime(p) : "")) + '</div><div class="badges">' +
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

    html += changeNote(block);
    html += resultPanel(p, stat, block, special);
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
        var slot1 = $("ppSlot");
        if (slot1) slot1.innerHTML = ppRow(p, stat, isFinite(v) ? v : null, state.day);
      });
      applyLine(p, stat, block);
      var slot = $("ppSlot");
      if (slot) {
        slot.addEventListener("click", function (e) {
          var pc = e.target.closest("[data-pp]");
          if (!pc) return;
          input.value = pc.dataset.pp;
          input.dispatchEvent(new Event("input"));
        });
      }
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
      '<div class="legend"><span><i style="background:var(--text)"></i>Model ' + fmt(b.proj) +
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
      '<div id="ppSlot">' + ppRow(p, stat, saved !== undefined ? saved : null, state.day) + "</div>" +
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
    var html = '<div class="probbar"><div class="over" style="width:' + (barShare(pr.over) * 100).toFixed(1) + '%"></div>' +
      (hasPush ? '<div class="push" style="width:' + (pr.push * 100) + '%"></div>' : "") +
      '<div class="under"></div></div>' +
      '<div class="problabels"><span><i class="o"></i>Over <b>' + chanceTxt(pr.over) + "</b></span>" +
      (hasPush ? '<span><i class="p"></i>Push <b>' + pct(pr.push) + "</b></span>" : "") +
      '<span><i class="u"></i>Under <b>' + chanceTxt(pr.under) + "</b></span></div>" +
      '<p class="note">The model projects ' + fmt(block.proj) + ", which is " + (diff >= 0 ? "+" : "") + fmt(diff) +
      " vs the line." + (hasPush ? " A push means landing exactly on the line." : "") + "</p>" +
      (/^\d+(\.\d+)?$/.test(String(line)) ? '<a class="xlink" href="' + cHref(p.id, stat, line, state.day) + '">See the full check and save this number</a>' : "");
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
      'Each bar is how many actually did. If the blue stops near the white line, the ranges are the right width. ' +
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
  // ---------- days, results and refreshing ----------
  var detailRe = /^#\/p\/(\d+)\/(\w+)(?:\/(\d{4}-\d{2}-\d{2}))?/;
  var dayRe = /^#\/d\/(\d{4}-\d{2}-\d{2})/;
  var checkRe = /^#\/c\/(\d+)\/(\w+)(?:\/(\d+(?:\.\d+)?))?(?:\/(\d{4}-\d{2}-\d{2}))?/;

  function loadJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function isoOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function parseISO(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseISO(s); d.setDate(d.getDate() + n); return isoOf(d); }
  function dayLabel(s) { return parseISO(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
  function dayWord(s) {
    var t = isoOf(new Date());
    if (s === t) return state.res && state.res.meta.all_final ? "Today" : "Tonight";
    if (s === addDays(t, -1)) return "Yesterday";
    if (s === addDays(t, 1)) return "Tomorrow";
    return dayLabel(s);
  }
  function availableDates() {
    var set = {};
    state.days.forEach(function (d) { set[d] = 1; });
    if (state.slateDate) set[state.slateDate] = 1;
    if (previewOK()) set[state.preview.meta.slate_date] = 1;
    return Object.keys(set).sort();
  }
  // The next-day preview only counts while it is later than the slate that is live.
  function previewOK() { return !!state.preview && state.preview.meta.slate_date > state.slateDate; }
  function hasDayFile(d) { return state.days.indexOf(d) !== -1; }
  function dayHash(d) { return !d || d === state.slateDate ? "#/games" : "#/d/" + d; }
  function pHref(id, stat) {
    return "#/p/" + id + "/" + stat + (state.day && state.day !== state.slateDate ? "/" + state.day : "");
  }
  function liveRes() {
    var r = state.liveRes;
    return r && r.meta && r.meta.slate_date === state.slateDate ? r : null;
  }
  function gameTime(p) { return state.finalGames[p.game_id] ? "Final" : timeOf(p); }

  function useInj(j) {
    injMap = {};
    state.inj = j || null;
    if (j) {
      j.news = j.news || [];
      (j.players || []).forEach(function (e) { injMap[normName(e.name)] = e; });
    }
  }
  function setRes(res) {
    state.res = res && res.players ? res : null;
    state.finalGames = {};
    if (state.res) state.res.meta.games_final.forEach(function (id) { state.finalGames[id] = 1; });
  }
  function useData(data, res, inj) {
    state.data = data;
    byId = {};
    data.players.forEach(function (p) { byId[p.id] = p; });
    setRes(res);
    useInj(inj);
    if (!data.meta.stat_labels[state.stat]) state.stat = Object.keys(data.meta.stat_labels)[0];
    if (state.game !== "all" && !data.games.some(function (g) { return g.game_id === state.game; })) state.game = "all";
    state.cur = !!data.meta.has_current_only && load("ignoreLast") === "1";
    $("curToggle").setAttribute("aria-pressed", state.cur);
    var none = !data.games.length;
    ["statChips", "gameTabs", "search"].forEach(function (id) { $(id).hidden = none; });
    $("curToggle").closest(".toggle-card").hidden = none || !data.meta.has_current_only;
    $("outRow").hidden = none || !state.inj;
    renderSub(); renderChips(); renderTabs();
  }
  function selectDay(date) {
    if (availableDates().indexOf(date) === -1) date = state.slateDate;
    state.day = date;
    if (hasDayFile(date)) {
      var c = state.dayCache[date];
      if (c) { useData(c, c.results, c.inj); return Promise.resolve(); }
      $("subline").textContent = "Loading…";
      $("cards").innerHTML = "";
      return loadJSON("days/" + date + ".json").then(function (d) {
        var keys = Object.keys(state.dayCache);
        if (keys.length >= 3) delete state.dayCache[keys[0]];
        state.dayCache[date] = d;
        if (state.day === date) useData(d, d.results, d.inj);
      }).catch(function () {
        state.days = state.days.filter(function (x) { return x !== date; });
        return selectDay(state.slateDate);
      });
    }
    if (previewOK() && date === state.preview.meta.slate_date) {
      useData(state.preview, null, state.liveInj);
      return Promise.resolve();
    }
    useData(state.slate, liveRes(), state.liveInj);
    return Promise.resolve();
  }

  // ---------- changes since the last build ----------
  function movedBy(b) {
    if (!b || b.prev == null || b.proj == null) return 0;
    var d = b.proj - b.prev;
    return Math.abs(d) < 0.5 ? 0 : d;
  }
  function changeHtml(b) {
    var d = movedBy(b);
    if (!d) return "";
    return '<span class="delta ' + (d > 0 ? "up" : "down") + '" title="Change since the last update">' +
      (d > 0 ? "\u25b2 " : "\u25bc ") + Math.abs(d).toFixed(1) + "</span>";
  }
  function changeNote(b) {
    if (!movedBy(b)) return "";
    return '<p class="note" style="margin-top:12px">The projection moved from ' + fmt(b.prev) + " to " + fmt(b.proj) +
      " since the last update.</p>";
  }

  // ---------- final results ----------
  function shown(v) { return Number.isInteger(v) ? String(v) : fmt(v); }
  function toneOf(v, b) { return v > b.hi ? "above" : v < b.lo ? "below" : "in"; }
  function resultHtml(p, stat, b) {
    if (!state.res) return "";
    var r = state.res.players[p.id];
    if (!r) return state.finalGames[p.game_id] ? '<div class="res dnp"><span class="rl">Did not play</span></div>' : "";
    var v = r[stat];
    if (v == null) return "";
    if (isSpecial(stat)) {
      return '<div class="res ' + (v ? "above" : "in") + '"><span class="rl">Final</span><b>' + (v ? "Yes" : "No") + "</b></div>";
    }
    var tone = toneOf(v, b), d = v - b.proj;
    var arrow = tone === "above" ? "▲ " : tone === "below" ? "▼ " : "";
    return '<div class="res ' + tone + '"><span class="rl">Final</span><b>' + arrow + shown(v) + "</b>" +
      '<span class="rd">' + (Math.abs(d) < 0.05 ? "on the number" : signed(d) + " vs projection") + "</span></div>";
  }
  function resultPanel(p, stat, b, special) {
    if (!state.res) return "";
    var r = state.res.players[p.id];
    if (!r) {
      return state.finalGames[p.game_id] ? '<section class="panel result"><h2>Final</h2><p class="soon">Did not play.</p></section>' : "";
    }
    var v = r[stat];
    if (v == null) return "";
    var big, side, tone;
    if (special) {
      tone = v ? "above" : "in";
      big = v ? "Yes" : "No";
      side = '<div class="a">Model chance ' + pct(b.p) + "</div>";
    } else {
      tone = toneOf(v, b);
      big = shown(v);
      side = '<div class="a">Projected ' + fmt(b.proj) + '</div><div class="b">Typical ' + fmt(b.lo) + " – " + fmt(b.hi) + "</div>";
    }
    var where = special || tone === "in" ? "" : (tone === "above" ? "Above" : "Below") + " the typical range. ";
    return '<section class="panel result"><div class="proj-row"><div><div class="big-label">Final ' +
      esc(label(stat).toLowerCase()) + '</div><div class="proj-num res-' + tone + '">' + esc(big) + "</div></div>" +
      '<div class="proj-side">' + side + "</div></div>" +
      '<p class="note">' + where + "Played " + fmt(r.m, 0) + " min (projected " + fmt(minutesOf(p), 0) + ").</p></section>";
  }

  // ---------- home, check a number, my numbers ----------
  var CHECK_MAIN = ["pts", "reb", "ast", "pra"];
  var CHECK_MORE = ["fg3m", "pr", "pa", "ra", "stl", "blk", "tov", "fantasy"];
  var SHORT = { pts: "PTS", reb: "REB", ast: "AST", pra: "PRA", fg3m: "3PM", pr: "P+R", pa: "P+A", ra: "R+A",
    stl: "STL", blk: "BLK", tov: "TO", fantasy: "FANTASY" };
  var BACK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  var MAX_MINE = 40;

  // The day that Home, Check and My numbers talk about: the live slate, or the next day's preview once the live slate is over.
  function homeDate() {
    var r = liveRes();
    return previewOK() && r && r.meta.all_final ? state.preview.meta.slate_date : state.slateDate;
  }
  // Where the players for a saved number live. Only the live slate and the preview count.
  function sourceFor(date) {
    if (date === state.slateDate) return { data: state.slate, res: liveRes() };
    if (previewOK() && date === state.preview.meta.slate_date) return { data: state.preview, res: null };
    return null;
  }
  function playerIn(data, id) {
    if (!data._ids) { data._ids = {}; data.players.forEach(function (p) { data._ids[p.id] = p; }); }
    return data._ids[id] || null;
  }
  function tipIn(src, p) {
    if (src.res && src.res.meta.games_final.indexOf(p.game_id) !== -1) return "Final";
    var t = "";
    src.data.games.forEach(function (g) { if (g.game_id === p.game_id) t = g.time || ""; });
    return t.replace(/\s*(ET|EST|EDT)$/i, "");
  }
  function curSrc() { return { data: state.data, res: state.res }; }
  function checkStats(p) {
    return CHECK_MAIN.concat(CHECK_MORE).filter(function (k) {
      return p ? !!p.stats[k] : !!state.data.meta.stat_labels[k];
    });
  }
  function blockOf(p, stat) { return getBlock(p, stat) || p.stats[stat]; }
  function parseLine(s) {
    var v = parseFloat(String(s).replace(",", "."));
    return isFinite(v) && v >= 0 && v <= 300 ? Math.round(v * 100) / 100 : null;
  }
  function vtxt(v, stat) { return stat === "fantasy" ? fmt(v) : (Number.isInteger(v) ? String(v) : fmt(v)); }
  // The model is rarely sure, so anything past 75% is shown as 75%+ (and the other side as <25%).
  function chanceTxt(x) { return x > 0.75 ? "75%+" : x < 0.25 ? "&lt;25%" : pct(x); }
  function chanceAria(x) { return x > 0.75 ? "over 75%" : x < 0.25 ? "under 25%" : pct(x); }
  function countAttr(x) { return x > 0.75 || x < 0.25 ? "" : ' data-n="' + Math.round(x * 100) + '" data-d="0" data-s="%"'; }
  function barShare(x) { return Math.min(0.75, Math.max(0.25, x)); }
  function cHref(id, stat, line, date) {
    return "#/c/" + id + "/" + stat + (line != null ? "/" + line : "") + (date && date !== homeDate() ? "/" + date : "");
  }
  // ----- PrizePicks lines (props.json, saved by fetch_lines.py) -----
  // Only used when the saved lines are for the same day as this page. Without them nothing changes.
  function ppLine(p, stat, date) {
    var pp = state.pp;
    if (!pp || !p || pp.meta.slate_date !== date) return null;
    var l = pp.lines[String(p.id)];
    return l && typeof l[stat] === "number" ? l[stat] : null;
  }
  function ppTime() {
    var d = new Date(state.pp.meta.fetched_at);
    return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  // PrizePicks line on the Games cards and list rows (same stat as the chip that is selected).
  function ppCard(p, stat) {
    var v = ppLine(p, stat, state.data.meta.slate_date);
    return v === null ? "" : '<span class="rpp"><i>PrizePicks</i><b>' + esc(vtxt(v, stat)) + "</b></span>";
  }
  function ppList(p, stat) {
    var v = ppLine(p, stat, state.data.meta.slate_date);
    return v === null ? "" : '<span class="lpp"><small>PrizePicks</small><b>' + esc(vtxt(v, stat)) + "</b></span>";
  }
  function ppTick(p, stat, scale) {
    var v = ppLine(p, stat, state.data.meta.slate_date);
    return v === null ? "" : '<span class="lppt" style="left:' + barPct(v, scale) + '%"></span>';
  }
  function ppRow(p, stat, line, date) {
    var v = ppLine(p, stat, date);
    if (v === null) return "";
    var same = line !== null && isFinite(line) && Math.abs(line - v) < 0.001;
    var t = ppTime();
    return '<div class="ppl"><span class="ppk">PrizePicks</span>' +
      (same ? '<span class="ppv">' + esc(vtxt(v, stat)) + " <i>matches your number</i></span>"
        : '<button type="button" class="ppchip" data-pp="' + v + '">Use ' + esc(vtxt(v, stat)) + "</button>") +
      (t ? '<span class="ppt">as of ' + esc(t) + "</span>" : "") + "</div>";
  }
  function goCheck(id, stat, line, date) {
    var h = cHref(id, stat, line, date);
    if (location.hash === h) route(); else location.hash = h;
  }
  function backInfo(fbHref, fbLabel) {
    var b = state.back;
    if (!b) return { href: fbHref, label: fbLabel };
    return { href: b, label: b === "#/" ? "Home" : b === "#/mine" ? "My numbers" : b === "#/last" ? "Last night" : "Games" };
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  // ----- saved numbers (kept on this phone only) -----
  function loadMine() {
    var a;
    try { a = JSON.parse(load("myNumbers") || "[]"); } catch (e) { a = []; }
    if (!Array.isArray(a)) a = [];
    state.mine = a.filter(function (e) {
      return e && typeof e.id === "number" && typeof e.stat === "string" && typeof e.line === "number" &&
        isFinite(e.line) && typeof e.date === "string";
    }).slice(0, MAX_MINE);
    pruneMine();
  }
  function saveMine() { store("myNumbers", JSON.stringify(state.mine)); updateNav(); }
  // Numbers are for one day's games, so they go away once that day is no longer the live slate or the preview.
  function pruneMine() {
    var n = state.mine.length;
    state.mine = state.mine.filter(function (e) { return !!sourceFor(e.date); });
    if (state.mine.length !== n) saveMine();
  }
  function mineIndex(e) {
    for (var i = 0; i < state.mine.length; i++) {
      var x = state.mine[i];
      if (x.id === e.id && x.stat === e.stat && x.line === e.line && x.date === e.date) return i;
    }
    return -1;
  }
  function updateNav() { /* My numbers is always in the tab bar now */ }

  // ----- Home -----
  function firstTip(games) {
    var best = null;
    games.forEach(function (g) { if (g.start && (!best || g.start < best.start)) best = g; });
    return best ? best.time : "";
  }
  function suggestHtml(q) {
    var s = plain(q.trim());
    if (!s) return "";
    var hits = [];
    state.data.players.forEach(function (p) {
      var n = plain(p.name), i = n.indexOf(s);
      if (i === -1 || !checkStats(p).length) return;
      var starts = i === 0 || /[\s\-'.]/.test(n.charAt(i - 1));
      hits.push({ p: p, rank: starts ? 0 : 1, v: p.stats.pts ? p.stats.pts.proj : 0 });
    });
    if (!hits.length) return '<p class="cap" style="padding:10px 14px">No player on this slate matches.</p>';
    hits.sort(function (a, b) { return a.rank - b.rank || b.v - a.v; });
    return hits.slice(0, 6).map(function (h) {
      var p = h.p, tip = tipIn(curSrc(), p);
      return '<button type="button" data-pid="' + p.id + '"><span class="st"><span class="sn">' + esc(p.name) +
        '</span><span class="ss">' + esc(p.team + " " + matchup(p) + (tip ? " · " + tip : "")) + "</span></span>" +
        (isOut(p) ? '<span class="badge out">OUT</span>' : "") + "</button>";
    }).join("");
  }
  function chipsInner(keys, sel) {
    var more = keys.filter(function (k) { return CHECK_MAIN.indexOf(k) === -1; });
    var open = state.more || more.indexOf(sel) !== -1;
    var list = open ? keys : keys.filter(function (k) { return CHECK_MAIN.indexOf(k) !== -1; });
    var h = list.map(function (k) {
      return '<button type="button" class="cchip" data-cstat="' + k + '" aria-pressed="' + (k === sel) + '" title="' +
        esc(label(k)) + '">' + esc(SHORT[k] || label(k)) + "</button>";
    }).join("");
    if (!open && more.length) h += '<button type="button" class="cchip cmore" data-more="1">More</button>';
    return h;
  }
  function homeForm() {
    var keys = checkStats(null);
    if (keys.indexOf(state.cstat) === -1) state.cstat = keys[0] || "pts";
    return '<form class="ckform" id="hkForm" novalidate aria-label="Check a number"><h2 class="fh">CHECK A NUMBER</h2>' +
      '<div class="fld"><label class="flbl" for="hkPlayer">Player</label>' +
      '<input class="cin" id="hkPlayer" type="search" placeholder="Search a player" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(state.hq) + '">' +
      '<div class="sugg" id="hkSugg" hidden></div></div>' +
      '<div class="fld"><span class="flbl">Stat</span><div class="cchips" id="hkChips" role="group" aria-label="Stat">' + chipsInner(keys, state.cstat) + "</div></div>" +
      '<div class="fld"><label class="flbl" for="hkNum">Number</label><div class="ckrow">' +
      '<input class="cin num" id="hkNum" type="text" inputmode="decimal" placeholder="e.g. 24.5" autocomplete="off" value="' + esc(state.hnum) + '">' +
      '<button class="ckgo" type="submit">Check</button></div><p class="ppfill" id="hkPP" role="status"></p></div>' +
      '<p class="cerr" id="hkErr" role="alert" hidden></p>' +
      '<p class="cap">Find the number in your app, then type it here. We show how often a player finishes above or below it.</p></form>';
  }
  function teamDot(t) { var c = TEAM_COLORS[t] || ["", "#98989f"]; return '<i class="dot" style="background:' + c[1] + '"></i>'; }
  function homeGames() {
    var g = state.data.games;
    if (!g.length) return "";
    function one(x, copy) {
      var fin = !!state.finalGames[x.game_id];
      return '<button type="button" class="tg" data-game="' + esc(x.game_id) + '"' + (copy ? ' tabindex="-1" aria-hidden="true"' : "") + ">" +
        teamDot(x.away) + "<b>" + esc(x.away) + "</b><span>@</span>" + teamDot(x.home) + "<b>" + esc(x.home) + '</b><em' + (fin ? ' class="fin"' : "") + ">" +
        esc(fin ? "Final" : (x.time || "").replace(/\s*(ET|EST|EDT)$/i, "")) + "</em></button>";
    }
    var a = g.map(function (x) { return one(x, false); }).join(""), b = g.map(function (x) { return one(x, true); }).join("");
    return '<div class="ticker" role="group" aria-label="Games"><div class="tk">' + a + b + "</div></div>";
  }
  function homeTop() {
    var rows = state.data.players.filter(function (p) { return !isOut(p) && getBlock(p, "pts"); })
      .sort(function (a, b) { return getBlock(b, "pts").proj - getBlock(a, "pts").proj; }).slice(0, 5);
    if (!rows.length) return "";
    return '<section class="hsec"><div class="hsh"><h2>Top projections</h2><span>POINTS</span></div><div class="hbox">' +
      '<div class="hhead" aria-hidden="true"><span>#</span><span>PLAYER</span><span>MODEL</span><span>PP</span></div>' +
      rows.map(function (p, i) {
        var b = getBlock(p, "pts"), tip = tipIn(curSrc(), p), pp = ppLine(p, "pts", state.data.meta.slate_date);
        return '<a class="hp t4" href="' + pHref(p.id, "pts") + '" aria-label="' + esc(p.name + ", model " + fmt(b.proj) +
          (pp !== null ? ", PrizePicks " + vtxt(pp, "pts") : "")) + '"><span class="rk">' + (i + 1) + '</span><div><div class="pn">' + esc(p.name) +
          '</div><div class="ps">' + esc(p.team + " " + matchup(p) + (tip ? " · " + tip : "")) + '</div></div><span class="num">' +
          fmt(b.proj) + '</span><span class="num ' + (pp !== null ? 'pp">' + esc(vtxt(pp, "pts")) : 'na">–') + "</span></a>";
      }).join("") + '<a class="hmore" href="' + dayHash(state.day) + '">All ' + state.data.players.length + " players</a></div></section>";
  }
  function homeChanges() {
    var rows = [];
    state.data.players.forEach(function (p) {
      var b = getBlock(p, "pts");
      if (isOut(p) || p.avg_min < 20 || !b) return;
      var d = movedBy(b);
      if (d) rows.push({ p: p, b: b, d: d });
    });
    rows.sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
    rows = rows.slice(0, 4);
    if (!rows.length) return "";
    return '<section class="hsec"><div class="hsh"><h2>Biggest changes</h2><span>Points, since the last update</span></div><div class="hbox">' +
      rows.map(function (x) {
        return '<a class="hp nr" href="' + pHref(x.p.id, "pts") + '"><div><div class="pn">' + esc(x.p.name) + '</div><div class="ps">' +
          esc(x.p.team) + '</div></div><div class="mvr"><b>' + fmt(x.b.proj) + "</b>" + changeHtml(x.b) + "</div></a>";
      }).join("") + "</div></section>";
  }
  function homeOut(word) {
    if (!state.inj) return "";
    var outs = state.data.players.filter(function (p) { return isOut(p) && p.avg_min >= 20; })
      .sort(function (a, b) { return b.avg_min - a.avg_min; });
    if (!outs.length) return "";
    var rel = /^(Tonight|Tomorrow|Today)$/.test(word);
    return '<section class="hsec"><div class="hsh"><h2>' + (rel ? "Out " + esc(word.toLowerCase()) : "Listed out") +
      "</h2><span>From ESPN's injury report</span></div><div class=\"outs\">" + outs.slice(0, 10).map(function (p) {
        return '<a class="ot" href="' + pHref(p.id, "pts") + '">' + esc(p.name) + " <i>" + esc(p.team) + "</i><em>OUT</em></a>";
      }).join("") + "</div>" + (outs.length > 10 ? '<p class="note" style="margin-top:10px">+ ' + (outs.length - 10) +
        " more rotation players are listed out.</p>" : "") + "</section>";
  }
  function homeLast() {
    var s = state.score;
    if (!s) return "";
    var yd = s.meta.slate_date === addDays(isoOf(new Date()), -1), acc = s.accuracy[0], inj = s.injury || {};
    var h = '<section class="hsec"><div class="hsh"><h2>' + (yd ? "Last night" : "How we did") + '</h2><a href="#/last">Full report</a></div><div class="hstats">';
    if (acc) {
      h += "<div><b>" + fmt(acc.mae) + "</b><span>Avg miss, " + esc(acc.label.toLowerCase()) + "</span></div>";
      h += "<div><b>" + pct(acc.inside50) + "</b><span>In range</span><em>goal 50%</em></div>";
    }
    if (inj.available) h += "<div><b>" + (inj.listed_out - inj.played_anyway.length) + "/" + inj.listed_out + "</b><span>Listed out, sat</span></div>";
    else h += "<div><b>" + s.meta.players_graded + "</b><span>Players graded</span></div>";
    return h + "</div></section>";
  }
  function renderHome() {
    var d = state.data, word = dayWord(d.meta.slate_date);
    var dt = parseISO(d.meta.slate_date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).replace(",", " ·");
    var fresh = [];
    if (state.pp && state.pp.meta.slate_date === d.meta.slate_date && ppTime()) fresh.push("Lines " + ppTime());
    if (state.inj && clock(state.inj.meta.generated_at)) fresh.push("Injuries " + clock(state.inj.meta.generated_at));
    var h = '<section class="hhero"><div><div class="hd">' + esc(dt) + "</div><h1>" + esc(word) + '</h1></div><div class="hr">' +
      (d.games.length ? '<span class="hn">' + d.games.length + "<small>" + (d.games.length === 1 ? "GAME" : "GAMES") + "</small></span>" : "") +
      (fresh.length ? '<span class="fresh"><i></i><span>' + fresh.map(esc).join("<br>") + "</span></span>" : "") + "</div></section>";
    if (!d.games.length) {
      h += '<p class="empty">No games scheduled for ' + esc(dayLabel(d.meta.slate_date)) + ".</p>";
    } else {
      h += homeGames() + homeForm() + homeTop() + homeChanges() + homeOut(word);
    }
    h += homeLast();
    h += '<p class="note footer">Projections are estimates from box-score history, not betting advice. Injury status comes from ESPN and ' +
      "can change before tip-off, so confirm who is playing.</p>";
    $("homeView").innerHTML = h;
    if (state.hq && !state.pick) showSugg();
  }
  function showSugg() {
    var box = $("hkSugg");
    if (!box) return;
    var html = state.pick ? "" : suggestHtml(state.hq);
    box.innerHTML = html;
    box.hidden = !html;
  }
  function homeFail(msg, focusId) {
    var e = $("hkErr");
    e.textContent = msg; e.hidden = false;
    $(focusId).focus();
  }
  function pickPlayer(id) {
    var p = byId[id];
    if (!p) return;
    state.pick = id; state.hq = p.name;
    $("hkPlayer").value = p.name;
    showSugg();
    $("hkErr").hidden = true;
    autoFill();
    $("hkNum").focus();
  }
  // Picking a player (or a stat) fills in that player's PrizePicks line, if we have one.
  // A number you typed yourself is never replaced.
  function autoFill() {
    var box = $("hkNum"), note = $("hkPP");
    if (!box || !note) return;
    var p = state.pick ? byId[state.pick] : null;
    if (box.value && !state.hauto) { note.textContent = ""; return; }
    var v = p ? ppLine(p, state.cstat, state.data.meta.slate_date) : null;
    if (v === null) {
      if (state.hauto) { box.value = ""; state.hnum = ""; state.hauto = false; }
      note.textContent = p && state.pp ? "No PrizePicks line for this stat. Type the number from your app." : "";
      return;
    }
    box.value = vtxt(v, state.cstat); state.hnum = box.value; state.hauto = true;
    note.textContent = "PrizePicks line as of " + ppTime() + ". Change it if your app shows a different number.";
  }
  function submitHome() {
    state.hnum = $("hkNum").value;
    var p = state.pick ? byId[state.pick] : null;
    if (!p) {
      var q = plain(state.hq.trim()), same = [], part = [];
      if (q) state.data.players.forEach(function (x) {
        var n = plain(x.name);
        if (n === q) same.push(x); else if (n.indexOf(q) !== -1) part.push(x);
      });
      p = same.length === 1 ? same[0] : (!same.length && part.length === 1 ? part[0] : null);
    }
    if (!p) return homeFail("Pick a player from the list.", "hkPlayer");
    var line = parseLine(state.hnum);
    if (line === null) return homeFail("Type the number from your app, like 24.5.", "hkNum");
    var stat = p.stats[state.cstat] ? state.cstat : (p.stats.pts ? "pts" : checkStats(p)[0]);
    if (!stat) return homeFail("There is no projection for " + p.name + " yet.", "hkPlayer");
    state.hq = ""; state.pick = null; state.hnum = "";
    goCheck(p.id, stat, line, state.day);
  }
  function wireHome() {
    var v = $("homeView");
    v.addEventListener("input", function (e) {
      if (e.target.id === "hkPlayer") {
        state.hq = e.target.value; state.pick = null;
        if (state.hauto) { $("hkNum").value = ""; state.hnum = ""; state.hauto = false; $("hkPP").textContent = ""; }
        $("hkErr").hidden = true;
        showSugg();
      } else if (e.target.id === "hkNum") {
        state.hnum = e.target.value; state.hauto = false; $("hkPP").textContent = "";
        $("hkErr").hidden = true;
      }
    });
    v.addEventListener("click", function (e) {
      var s = e.target.closest("[data-pid]");
      if (s) { pickPlayer(+s.dataset.pid); return; }
      var c = e.target.closest("[data-cstat]");
      if (c) { state.cstat = c.dataset.cstat; $("hkChips").innerHTML = chipsInner(checkStats(null), state.cstat); autoFill(); return; }
      if (e.target.closest("[data-more]")) {
        state.more = true;
        $("hkChips").innerHTML = chipsInner(checkStats(null), state.cstat);
        return;
      }
      var g = e.target.closest("[data-game]");
      if (g) { state.game = g.dataset.game; location.hash = dayHash(state.day); }
    });
    v.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.target.id !== "hkPlayer") return;
      e.preventDefault();
      if (state.pick) { $("hkNum").focus(); return; }
      var first = $("hkSugg").querySelector("[data-pid]");
      if (first) pickPlayer(+first.dataset.pid);
    });
    v.addEventListener("submit", function (e) { e.preventDefault(); submitHome(); });
  }

  // ----- Check a number -----
  function lastGamesPanel(p, stat, line) {
    var rows = p.recent.slice(0, 5).filter(function (g) { return g.s && g.s[stat] != null; });
    if (!rows.length) return "";
    var max = line, above = 0, tie = 0;
    rows.forEach(function (g) { max = Math.max(max, g.s[stat]); });
    max = Math.max(max * 1.15, 1);
    var html = '<section class="panel lk"><h2>Last ' + rows.length + " games against " + esc(vtxt(line, stat)) + "</h2><div>";
    rows.forEach(function (g) {
      var v = g.s[stat];
      if (v > line) above++; else if (v === line) tie++;
      html += '<div class="gamerow"><div class="who2"><b>' + esc((g.home ? "vs " : "@ ") + g.opp) + "</b><span>" + esc(shortDate(g.date)) +
        '</span></div><div class="track"><div class="fill' + (v > line ? " hi" : "") + '" style="width:' + (v / max * 100).toFixed(1) +
        '%"></div><div class="tick" style="left:' + (line / max * 100).toFixed(1) + '%"></div></div><span class="val">' +
        esc(vtxt(v, stat)) + "</span></div>";
    });
    return html + '</div><p class="note">Above ' + esc(vtxt(line, stat)) + " in " + above + " of the last " + rows.length + "." +
      (tie ? " Landed exactly on it in " + tie + "." : "") + " The orange line is your number.</p></section>";
  }
  // Past games against tonight's opponent, against the same number. Few games, so it's context only.
  function vsLinePanel(p, stat, line) {
    var rows = (p.vs_opp || []).filter(function (g) { return g.s && g.s[stat] != null; }).slice(0, 5);
    if (!rows.length) return "";
    var max = line, above = 0;
    rows.forEach(function (g) { max = Math.max(max, g.s[stat]); });
    max = Math.max(max * 1.15, 1);
    var html = '<section class="panel lk"><h2>Last ' + (rows.length === 1 ? "game" : rows.length + " games") + " vs " + esc(p.opp) + "</h2><div>";
    rows.forEach(function (g) {
      var v = g.s[stat], d = parseISO(g.date);
      if (v > line) above++;
      var when = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " '" + String(d.getFullYear()).slice(2);
      html += '<div class="gamerow"><div class="who2"><b>' + esc((g.home ? "vs " : "@ ") + g.opp) + "</b><span>" + esc(when) +
        '</span></div><div class="track"><div class="fill' + (v > line ? " hi" : "") + '" style="width:' + (v / max * 100).toFixed(1) +
        '%"></div><div class="tick" style="left:' + (line / max * 100).toFixed(1) + '%"></div></div><span class="val">' +
        esc(vtxt(v, stat)) + "</span></div>";
    });
    return html + '</div><p class="note">Above ' + esc(vtxt(line, stat)) + " in " + above + " of " + rows.length +
      ". Only a few games and some are from last season, so this is context, not a prediction.</p></section>";
  }
  function paintSave() {
    var c = state.chk, btn = $("ckSave");
    if (!c || !btn) return;
    var saved = mineIndex(c.entry) !== -1;
    btn.textContent = saved ? "Remove from My numbers" : "Add to My numbers";
    $("ckSaveNote").innerHTML = saved ? 'Saved on this phone. <a href="#/mine">See My numbers</a>' : "";
  }
  function renderCheck(mc) {
    var v = $("checkView"), id = +mc[1], stat = mc[2], line = mc[3] != null ? parseFloat(mc[3]) : null;
    var p = byId[id], bk = backInfo("#/", "Home");
    var back = '<a class="back" href="' + esc(bk.href) + '">' + BACK_SVG + esc(bk.label) + "</a>";
    var keys = p ? checkStats(p) : [];
    if (p && (isSpecial(stat) || !p.stats[stat])) stat = p.stats.pts ? "pts" : keys[0];
    if (!p || !stat || !p.stats[stat]) {
      state.chk = null;
      v.innerHTML = back + '<p class="empty">That player isn\'t on the slate for ' + esc(dayLabel(state.day)) + ".</p>";
      return;
    }
    if (keys.indexOf(stat) === -1) keys.push(stat);
    var b = blockOf(p, stat), tip = gameTime(p);
    var h = back + '<div class="hero">' + avatar(p, true) + "<div><h1>" + esc(p.name) + '</h1><div class="meta">' +
      esc(p.team + " · " + matchup(p) + (tip ? " · " + tip : "")) + '</div><div class="badges">' + statusBadge(p) +
      (p.b2b ? '<span class="badge">Back-to-back</span>' : "") + "</div></div></div>";
    h += injuryPanel(p);
    h += '<form class="ckform" id="ckForm" novalidate aria-label="Your number"><div class="cchips" id="ckChips" role="group" aria-label="Stat">' +
      chipsInner(keys, stat) + '</div><div class="ckrow"><input class="cin num" id="ckNum" type="text" inputmode="decimal" autocomplete="off" ' +
      'placeholder="Your number" aria-label="Your number" value="' + (line != null && isFinite(line) ? esc(line) : "") + '">' +
      '<button class="ckgo" type="submit">Check</button></div><p class="cerr" id="ckErr" role="alert" hidden></p></form>';
    h += ppRow(p, stat, line, state.day);

    state.chk = { id: id, stat: stat, line: line, keys: keys, date: state.day, entry: null };
    if (line == null || !isFinite(line)) {
      h += '<p class="note" style="margin-top:14px">Type the number from your app, then tap Check to see how likely it is.</p>';
      v.innerHTML = h;
      return;
    }
    var pr = lineProbs(b, line), diff = b.proj - line, hasPush = pr.push > 0.005, lt = esc(vtxt(line, stat));
    h += '<section class="panel"><div class="proj-row"><div><div class="big-label">The model projects ' + esc(label(stat).toLowerCase()) +
      '</div><div class="proj-num" data-n="' + b.proj + '">' + fmt(b.proj) + '</div></div><div class="proj-side"><div class="a">Your number ' + lt +
      '</div><div class="b">' + (Math.abs(diff) < 0.05 ? "Right on it" : fmt(Math.abs(diff)) + (diff > 0 ? " above" : " below") + " your number") +
      "</div></div></div></section>";
    h += '<section class="panel"><h2>Chance of finishing</h2><div class="two"><div class="pc o"><b' + countAttr(pr.over) + ">" + chanceTxt(pr.over) +
      "</b><span>above " + lt + '</span></div><div class="pc"><b' + countAttr(pr.under) + ">" + chanceTxt(pr.under) + "</b><span>below " + lt + "</span></div></div>" +
      '<div class="probbar" role="img" aria-label="' + chanceAria(pr.over) + " above, " + chanceAria(pr.under) + ' below">' +
      '<div class="over" style="width:' + (barShare(pr.over) * 100).toFixed(1) + '%"></div>' +
      (hasPush ? '<div class="push" style="width:' + (pr.push * 100).toFixed(1) + '%"></div>' : "") + '<div class="under"></div></div>' +
      (hasPush ? '<p class="note">Landing exactly on ' + lt + " is about " + pct(pr.push) + ", so the two sides do not add up to 100%.</p>" : "") +
      "</section>";

    var sc = rangeScale(b, line);
    h += '<section class="panel"><h2>Where your number sits</h2><div class="rangebar" role="img" aria-label="Typical range ' + fmt(b.lo) +
      " to " + fmt(b.hi) + ", projection " + fmt(b.proj) + ", your number " + lt + '">' +
      '<div class="rail"></div><div class="span" style="left:' + pos(b.lo, sc) + "%;width:" + (pos(b.hi, sc) - pos(b.lo, sc)) +
      '%"></div><div class="mark" style="left:' + pos(b.proj, sc) + '%"></div><div class="linemark" style="left:' + pos(line, sc) + '%"></div></div>' +
      '<div class="scale"><span>' + sc.lo + "</span><span>" + sc.hi + "</span></div>" +
      '<div class="legend"><span><i style="background:var(--accent-soft)"></i>Typical range ' + fmt(b.lo) + " – " + fmt(b.hi) +
      '</span><span><i style="background:var(--text)"></i>Projection ' + fmt(b.proj) +
      '</span><span><i style="background:var(--amber)"></i>Your number</span></div></section>';

    h += whyPanel(p, stat, b);
    h += lastGamesPanel(p, stat, line);
    h += vsLinePanel(p, stat, line);

    var entry = { id: id, stat: stat, line: line, date: state.day, name: p.name, team: p.team };
    state.chk.entry = entry;
    if (sourceFor(state.day)) {
      h += '<div class="acts"><button type="button" class="btn p" id="ckSave">Add to My numbers</button>' +
        '<a class="btn" href="#/">Check another</a></div><p class="note" id="ckSaveNote" role="status" style="margin-top:10px"></p>';
    } else {
      h += '<div class="acts"><a class="btn" href="#/">Check another</a></div>';
    }
    h += '<p class="note" style="margin-top:14px">Chances are estimates from box-score history and the matchup, not betting advice.</p>';
    v.innerHTML = h;
    paintSave();
  }
  function wireCheck() {
    var v = $("checkView");
    v.addEventListener("click", function (e) {
      var c = state.chk;
      if (!c) return;
      var pc = e.target.closest("[data-pp]");
      if (pc) { goCheck(c.id, c.stat, parseFloat(pc.dataset.pp), c.date); return; }
      var s = e.target.closest("[data-cstat]");
      if (s) {
        var typed = parseLine($("ckNum").value);
        goCheck(c.id, s.dataset.cstat, typed !== null ? typed : null, c.date);
        return;
      }
      if (e.target.closest("[data-more]")) {
        state.more = true;
        $("ckChips").innerHTML = chipsInner(c.keys, c.stat);
        return;
      }
      if (e.target.closest("#ckSave")) {
        var i = mineIndex(c.entry);
        if (i === -1) {
          if (state.mine.length >= MAX_MINE) {
            $("ckSaveNote").textContent = "You have " + MAX_MINE + " numbers saved. Remove one in My numbers first.";
            return;
          }
          state.mine.unshift(c.entry);
        } else {
          state.mine.splice(i, 1);
        }
        saveMine();
        paintSave();
      }
    });
    v.addEventListener("input", function (e) { if (e.target.id === "ckNum") $("ckErr").hidden = true; });
    v.addEventListener("submit", function (e) {
      e.preventDefault();
      var c = state.chk;
      if (!c) return;
      var line = parseLine($("ckNum").value);
      if (line === null) {
        $("ckErr").textContent = "Type the number from your app, like 24.5.";
        $("ckErr").hidden = false;
        $("ckNum").focus();
        return;
      }
      goCheck(c.id, c.stat, line, c.date);
    });
  }

  // ----- My numbers -----
  function evalEntry(e, i) {
    var src = sourceFor(e.date), p = src ? playerIn(src.data, e.id) : null;
    var b = p ? blockOf(p, e.stat) : null;
    return { i: i, e: e, src: src, p: p, b: b, pr: b ? lineProbs(b, e.line) : null };
  }
  function mineFinal(x) {
    if (!x.p || !x.src || !x.src.res) return "";
    var r = x.src.res.players[x.p.id];
    if (!r) return x.src.res.meta.games_final.indexOf(x.p.game_id) !== -1 ? '<p class="mfin">Did not play</p>' : "";
    var v = r[x.e.stat];
    if (v == null) return "";
    return '<p class="mfin">Final <b>' + esc(shown(v)) + "</b> · " + (v > x.e.line ? "above " : v < x.e.line ? "below " : "exactly on ") +
      esc(vtxt(x.e.line, x.e.stat)) + "</p>";
  }
  function renderMine() {
    var items = state.mine.map(evalEntry).filter(function (x) { return !!x.src; });
    items.sort(function (a, b) {
      if (!a.pr !== !b.pr) return a.pr ? -1 : 1;
      if (!a.pr) return 0;
      return Math.max(b.pr.over, b.pr.under) - Math.max(a.pr.over, a.pr.under);
    });
    var up = 0, down = 0;
    items.forEach(function (x) { if (x.pr) { if (x.pr.over >= x.pr.under) up++; else down++; } });
    var h = '<div class="top" style="padding-top:8px"><div><h1 class="title">My numbers</h1><p class="sub">' +
      (items.length ? plural(items.length, "number", "numbers") + " checked · " : "") + "saved on this phone only</p></div></div>";
    if (!items.length) {
      h += '<div class="mempty"><p>No numbers yet.</p><p class="cap">Check a number, then tap Add to My numbers to keep it here. ' +
        'They clear when the day\'s games are over.</p><a class="btn p full" href="#/">Check a number</a></div>';
      $("mineView").innerHTML = h;
      return;
    }
    h += '<div class="msum"><div class="mmini"><b>' + up + "</b><span>lean above the number</span></div>" +
      '<div class="mmini"><b>' + down + "</b><span>lean below the number</span></div></div>" +
      '<div class="msort">Sorted by how sure the model is</div>';
    items.forEach(function (x) {
      var e = x.e, nm = esc(e.name), ln = esc(label(e.stat) + " " + vtxt(e.line, e.stat));
      var sub = x.p ? esc(x.p.team + " " + matchup(x.p)) + " · " + esc(tipIn(x.src, x.p)) : esc(e.team) + " · not on the slate";
      var rm = '<button type="button" class="mrm" data-rm="' + x.i + '" aria-label="Remove ' + nm + " " + esc(label(e.stat).toLowerCase()) + " " +
        esc(vtxt(e.line, e.stat)) + '"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
      h += '<article class="mitem' + (x.pr ? "" : " dim") + '"><div class="mtop"><a class="mhead" href="' + cHref(e.id, e.stat, e.line, e.date) +
        '"><div class="mnm">' + nm + '</div><div class="mln"><b>' + ln + "</b> · " + sub + "</div></a>" + rm + "</div>";
      if (x.pr) {
        var lead = x.pr.over >= x.pr.under;
        h += '<div class="mbar" role="img" aria-label="' + chanceAria(x.pr.over) + " above, " + chanceAria(x.pr.under) + ' below">' +
          '<i style="width:' + (barShare(x.pr.over) * 100).toFixed(1) + '%"></i></div>' +
          '<div class="mpl"><span>Above ' + (lead ? "<b>" : "") + chanceTxt(x.pr.over) + (lead ? "</b>" : "") + '</span><span class="mmod">Model <b>' + fmt(x.b.proj) + '</b></span><span>Below ' +
          (lead ? "" : "<b>") + chanceTxt(x.pr.under) + (lead ? "" : "</b>") + "</span></div>" + mineFinal(x);
      }
      h += "</article>";
    });
    h += '<div class="macts"><a class="btn p" href="#/">Check another</a><button type="button" class="btn" id="mineClear">Clear all</button></div>' +
      '<p class="note" style="margin-top:14px">Chances over 75% show as 75%+, because the model is rarely that sure. ' +
      "Estimates from box-score history, not betting advice.</p>";
    $("mineView").innerHTML = h;
  }
  var clearTimer = null;
  function wireMine() {
    $("mineView").addEventListener("click", function (e) {
      var r = e.target.closest("[data-rm]");
      if (r) {
        state.mine.splice(+r.dataset.rm, 1);
        saveMine();
        renderMine();
        return;
      }
      var c = e.target.closest("#mineClear");
      if (!c) return;
      if (c.dataset.sure === "1") {
        clearTimeout(clearTimer);
        state.mine = [];
        saveMine();
        renderMine();
        return;
      }
      c.dataset.sure = "1";
      c.textContent = "Tap again to clear";
      clearTimeout(clearTimer);
      clearTimer = setTimeout(function () {
        var b = $("mineClear");
        if (b) { b.dataset.sure = ""; b.textContent = "Clear all"; }
      }, 4000);
    });
  }

  // ---------- wiring ----------
  function toggleCur() {
    state.cur = !state.cur;
    store("ignoreLast", state.cur ? "1" : "0");
    $("curToggle").setAttribute("aria-pressed", state.cur);
    route();
  }
  function parseHash() {
    var h = location.hash, m = h.match(detailRe), mc = h.match(checkRe), md = h.match(dayRe);
    var view = m ? "detail" : mc ? "check" : (h === "#/last" && state.score) ? "last" : h === "#/mine" ? "mine" :
      (md || h === "#/games") ? "games" : "home";
    return { h: h, view: view, m: m, mc: mc, md: md };
  }
  // Scroll position is remembered for the screens people come back to.
  var ys = {}, shownKey = "";
  var VIEW_EL = { games: "listView", home: "homeView", check: "checkView", mine: "mineView", detail: "detailView", last: "lastView" };
  function keepKey(view, day) { return view === "games" ? "games:" + day : (view === "home" || view === "mine") ? view : ""; }
  function route() {
    if (state.data) pruneMine();
    var r = parseHash(), view = r.view, m = r.m, mc = r.mc;
    var target = view === "detail" ? (m[3] || state.slateDate) :
      view === "check" ? (mc[4] || homeDate()) :
      view === "games" ? (r.md ? r.md[1] : state.slateDate) :
      view === "home" ? homeDate() : (state.data ? state.day : homeDate());
    var reset = (view === "games" || view === "home") && !!state.data && target !== state.day;

    function render() {
      var key = keepKey(view, state.day);
      if (shownKey) ys[shownKey] = window.scrollY;
      if (reset && key) ys[key] = 0;
      if (view === "home") state.back = "#/";
      else if (view === "games" || view === "mine" || view === "last") state.back = r.h;
      state.shown = view;
      $("nav").hidden = view === "detail" || view === "check";
      document.body.classList.toggle("has-nav", !$("nav").hidden);
      $("navLast").hidden = !state.score;
      $("navHome").setAttribute("aria-current", view === "home" ? "page" : "false");
      $("navTonight").setAttribute("aria-current", view === "games" ? "page" : "false");
      $("navLast").setAttribute("aria-current", view === "last" ? "page" : "false");
      $("navMine").setAttribute("aria-current", view === "mine" ? "page" : "false");
      Object.keys(VIEW_EL).forEach(function (k) { $(VIEW_EL[k]).hidden = k !== view; });
      if (view === "detail") showDetail(+m[1], m[2]);
      else if (view === "check") renderCheck(mc);
      else if (view === "last") renderLast();
      else if (view === "mine") renderMine();
      else if (view === "home") renderHome();
      else {
        renderTabs();
        renderList();
        var on = $("gameTabs").querySelector('[aria-pressed="true"]');
        if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "center" });
      }
      window.scrollTo(0, key ? (ys[key] || 0) : 0);
      shownKey = key;
      if (!(key && ys[key])) entrance($(VIEW_EL[view]));
    }
    if (state.data && target === state.day) render();
    else selectDay(target).then(render);
  }
  // Screens slide in and numbers count up right after you open them. The 5-minute refresh redraws without motion.
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var animTimer = null;
  function entrance(el) {
    if (reduceMotion || !el) return;
    el.classList.remove("anim");
    void el.offsetWidth;
    el.classList.add("anim");
    clearTimeout(animTimer);
    animTimer = setTimeout(function () { el.classList.remove("anim"); }, 1400);
    countUp(el);
  }
  function countUp(el) {
    var nodes = [].slice.call(el.querySelectorAll("[data-n]"));
    if (!nodes.length) return;
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / 900), e = 1 - Math.pow(1 - k, 3);
      nodes.forEach(function (n) {
        if (!n.isConnected) return;
        var d = n.dataset.d != null ? +n.dataset.d : 1;
        n.textContent = (+n.dataset.n * e).toFixed(d) + (n.dataset.s || "");
      });
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function rerender() {
    var r = parseHash();
    if (r.view === "home" && homeDate() !== state.day) { route(); return; }
    if (r.view === "detail" && !$("detailView").hidden) showDetail(+r.m[1], r.m[2]);
    else if (r.view === "games" && !$("listView").hidden) renderList();
    else if (r.view === "home") renderHome();
    else if (r.view === "check" && r.mc) renderCheck(r.mc);
    else if (r.view === "mine") renderMine();
  }
  // Quietly pull fresh injuries and results while the page is open.
  function refresh() {
    if (document.hidden || !state.data) return;
    Promise.all([loadInjuries(), loadResults(), loadPreview(), loadLines()]).then(function () {
      var onPreview = previewOK() && state.day === state.preview.meta.slate_date;
      if (!onPreview && state.data !== state.slate) { renderSub(); return; }
      var a = document.activeElement;
      if (a && a.tagName === "INPUT") return;
      if (onPreview) {
        useData(state.preview, null, state.liveInj);
      } else {
        useInj(state.liveInj);
        setRes(liveRes());
        renderSub();
      }
      rerender();
    });
  }

  function hideLoader() {
    var l = $("loader");
    if (!l || l.classList.contains("done")) return;
    clearInterval(loaderTick);
    var wait = Math.max(0, loaderMin - (Date.now() - loaderT0));
    setTimeout(function () { l.classList.add("done"); setTimeout(function () { l.hidden = true; }, 400); }, wait);
  }
  function start(data) {
    state.slate = data;
    state.slateDate = data.meta.slate_date;

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
    state.view = load("view") === "list" ? "list" : "cards";
    renderView();
    $("viewSeg").addEventListener("click", function (e) {
      var b = e.target.closest("[data-view]");
      if (!b || b.dataset.view === state.view) return;
      state.view = b.dataset.view;
      store("view", state.view);
      renderView();
      renderList();
    });
    $("showOut").addEventListener("change", function (e) { state.showOut = e.target.checked; renderList(); });
    $("daySelect").addEventListener("change", function (e) { location.hash = dayHash(e.target.value); });
    function step(n) {
      var dates = availableDates(), d = dates[dates.indexOf(state.day) + n];
      if (d) location.hash = dayHash(d);
    }
    $("dayPrev").addEventListener("click", function () { step(-1); });
    $("dayNext").addEventListener("click", function () { step(1); });
    loadMine();
    updateNav();
    wireHome();
    wireCheck();
    wireMine();
    window.addEventListener("hashchange", route);
    setInterval(refresh, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
    route();
    hideLoader();
  }

  function fail(msg) {
    hideLoader();
    $("subline").textContent = "";
    $("cards").innerHTML = "";
    $("listMsg").innerHTML = '<div class="error">' + msg + "</div>";
  }

  // Everything except slate.json is optional: if a file is missing the page still works.
  function loadInjuries() {
    return loadJSON("injuries.json")
      .then(function (j) { j.news = j.news || []; state.liveInj = j; })
      .catch(function () { /* keep whatever we had */ });
  }
  function loadResults() {
    return loadJSON("results.json").then(function (j) { state.liveRes = j; }).catch(function () { /* none yet */ });
  }
  function loadPreview() {
    return loadJSON("preview.json")
      .then(function (j) { state.preview = j && j.meta && j.games ? j : null; })
      .catch(function () { /* no preview yet */ });
  }
  function loadDays() {
    return loadJSON("days/index.json")
      .then(function (j) { state.days = (j.days || []).map(function (d) { return d.date; }); })
      .catch(function () { state.days = []; });
  }
  function loadScore() {
    return loadJSON("scorecard.json")
      .then(function (j) { state.score = j && j.meta && j.accuracy && j.accuracy.length ? j : null; })
      .catch(function () { state.score = null; });
  }

  function loadLines() {
    return loadJSON("props.json")
      .then(function (j) { state.pp = j && j.meta && j.lines && j.meta.slate_date ? j : null; })
      .catch(function () { state.pp = null; });
  }

  // Shot-clock loading screen. Shown at least ~0.7s on the first visit of a session, then only while data loads.
  var loaderT0 = Date.now(), loaderMin = 0, loaderTick = null;
  (function () {
    var first = false;
    try { first = !sessionStorage.getItem("seenLoader"); sessionStorage.setItem("seenLoader", "1"); } catch (e) { first = false; }
    loaderMin = first && !reduceMotion ? 700 : 0;
    var n = 24, clk = $("loaderClock");
    if (clk && !reduceMotion) loaderTick = setInterval(function () {
      n = n <= 1 ? 24 : n - 1;
      clk.textContent = (n < 10 ? "0" : "") + n;
      clk.classList.toggle("low", n <= 5);
    }, 100);
  })();

  fetch("slate.json", { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      return Promise.all([loadInjuries(), loadScore(), loadDays(), loadResults(), loadPreview(), loadLines()]).then(function () { start(data); });
    })
    .catch(function () {
      fail("Couldn't load <code>slate.json</code>. Run <code>python build_slate.py</code> first. " +
        "If you opened <code>index.html</code> by double-clicking it, open it through a local server instead: " +
        "in the <code>site</code> folder run <code>python -m http.server 8000</code> and visit <code>http://localhost:8000</code>.");
    });
})();