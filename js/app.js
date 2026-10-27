(function () {
  "use strict";

  /* ---------------------------------------------------------------------
     STATE  (모든 상태 변수는 파일 맨 위에서 선언 — 함수보다 아래에 두면
     초기화 전에 접근해서 페이지 전체가 멈출 수 있음)
     --------------------------------------------------------------------- */
  let DATA = [];               // 전체 회차 (회차 오름차순)
  let sortMode = "desc";
  let currentPage = 1;
  const PAGE_SIZE = 15;
  let currentRange = 20;       // 20 | 50 | 100 | "all"

  let lastCounts = null;       // 마지막 통계 계산 결과 { 1: n, ..., 45: n }
  let lastAvg = 0;
  let lastRangeLabel = "";

  const genState = {
    include: new Set(),
    exclude: new Set(),
    consec: "any",             // any | no | yes
    count: 5,
  };

  const POS_NAMES = ["1번째", "2번째", "3번째", "4번째", "5번째", "6번째"];
  // 자리별 비중 추출 상태 (init 에서 쓰이므로 반드시 위쪽에 선언)
  const posState = {
    count: 5,
    view: "count",             // count | share
    threshold: 30,
    range: "all",
    counts: null,              // counts[n][k] : n번이 k번째 자리(0~5)에 나온 횟수
    totals: null,              // totals[n] : n번이 나온 전체 횟수
    cands: [[], [], [], [], [], []],
    W: null,                   // W[k][prev] : k번째 자리부터 끝까지 채울 수 있는 경우의 수
    combos: 0,
    rounds: 0,
  };

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  /* ---------------------------------------------------------------------
     HELPERS
     --------------------------------------------------------------------- */
  function ballClass(n) {
    if (n <= 10) return "ball--y";
    if (n <= 20) return "ball--b";
    if (n <= 30) return "ball--r";
    if (n <= 40) return "ball--g";
    return "ball--n";
  }
  function ballHtml(n, size) {
    const sz = size ? " ball--" + size : "";
    return `<span class="ball ${ballClass(n)}${sz}">${n}</span>`;
  }
  function ballsHtml(nums, size) {
    return nums.map((n) => ballHtml(n, size)).join("");
  }
  function fmtDate(iso) {
    const [y, m, d] = iso.split("-");
    return `${y}.${m}.${d}`;
  }
  function safeScroll(el) {
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  function sampleDistinct(pool, k) {
    const arr = pool.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, k);
  }

  /* ---------------------------------------------------------------------
     BOOT
     --------------------------------------------------------------------- */
  if (typeof LOTTO_DATA !== "undefined" && LOTTO_DATA.length) {
    DATA = LOTTO_DATA.slice().sort((a, b) => a.round - b.round);
    init();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      $("#roundTableBody").innerHTML =
        '<tr><td colspan="4" style="padding:24px;">데이터를 불러오지 못했습니다. data/lotto645.js 경로를 확인해주세요.</td></tr>';
    });
  }

  function init() {
    $("#totalRoundsText").textContent = DATA.length.toLocaleString("ko-KR");
    renderHero();
    renderTable();
    renderStats();
    bindNav();
    bindLookup();
    bindRangeTabs();
    initGenerator();
    initPos();
  }

  /* ---------------------------------------------------------------------
     NAV
     --------------------------------------------------------------------- */
  function bindNav() {
    $$("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => safeScroll(document.getElementById(btn.dataset.nav)));
    });

    if (typeof IntersectionObserver === "undefined") return;
    const navLinks = $$(".nav-link");
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          navLinks.forEach((l) => l.classList.toggle("is-active", l.dataset.nav === entry.target.id));
        });
      },
      { rootMargin: "-40% 0px -50% 0px" }
    );
    ["hero", "lookup", "stats", "posgen", "generator"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
  }

  /* ---------------------------------------------------------------------
     HERO
     --------------------------------------------------------------------- */
  function renderHero() {
    const latest = DATA[DATA.length - 1];
    $("#latestRound").textContent = latest.round.toLocaleString("ko-KR");
    $("#latestDate").textContent = fmtDate(latest.date) + " 추첨";
    $("#latestBalls").innerHTML = ballsHtml(latest.numbers);
    $("#latestBonus").innerHTML = ballHtml(latest.bonus, "sm");
  }

  /* ---------------------------------------------------------------------
     LOOKUP
     --------------------------------------------------------------------- */
  function getSortedData() {
    const arr = DATA.slice();
    arr.sort((a, b) => (sortMode === "asc" ? a.round - b.round : b.round - a.round));
    return arr;
  }

  function renderTable(highlightRound) {
    const sorted = getSortedData();
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;

    $("#roundTableBody").innerHTML = sorted
      .slice(start, start + PAGE_SIZE)
      .map(
        (r) => `
        <tr class="${highlightRound && r.round === highlightRound ? "is-highlight" : ""}">
          <td class="cell-round">${r.round.toLocaleString("ko-KR")}</td>
          <td class="cell-date">${fmtDate(r.date)}</td>
          <td><div class="cell-balls">${ballsHtml(r.numbers, "sm")}</div></td>
          <td>${ballHtml(r.bonus, "sm")}</td>
        </tr>`
      )
      .join("");
    renderPagination(totalPages);
  }

  function renderPagination(totalPages) {
    const maxButtons = 7;
    let start = Math.max(1, currentPage - 3);
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);

    let html = `<button class="page-btn" data-page="prev" ${currentPage === 1 ? "disabled" : ""}>‹</button>`;
    for (let p = start; p <= end; p++) {
      html += `<button class="page-btn ${p === currentPage ? "is-active" : ""}" data-page="${p}">${p}</button>`;
    }
    html += `<button class="page-btn" data-page="next" ${currentPage === totalPages ? "disabled" : ""}>›</button>`;

    const box = $("#pagination");
    box.innerHTML = html;
    $$(".page-btn", box).forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.page;
        if (v === "prev") currentPage = Math.max(1, currentPage - 1);
        else if (v === "next") currentPage = currentPage + 1;
        else currentPage = parseInt(v, 10);
        renderTable();
        safeScroll($("#lookup"));
      });
    });
  }

  function bindLookup() {
    $("#sortSelect").addEventListener("change", (e) => {
      sortMode = e.target.value;
      currentPage = 1;
      renderTable();
    });

    $("#roundForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const msg = $("#roundMsg");
      const val = parseInt($("#roundInput").value, 10);
      const latest = DATA[DATA.length - 1].round;
      if (!val || val < 1 || val > latest) {
        msg.textContent = `1 ~ ${latest}회 사이의 회차를 입력해주세요.`;
        return;
      }
      msg.textContent = "";
      const idx = getSortedData().findIndex((r) => r.round === val);
      currentPage = Math.floor(idx / PAGE_SIZE) + 1;
      renderTable(val);
      safeScroll($("#lookup"));
    });
  }

  /* ---------------------------------------------------------------------
     STATS
     --------------------------------------------------------------------- */
  function bindRangeTabs() {
    $$(".range-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$(".range-tab").forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        currentRange = tab.dataset.range === "all" ? "all" : parseInt(tab.dataset.range, 10);
        renderStats();
      });
    });
    $("#aboveRecommendBtn").addEventListener("click", runAboveRecommend);
  }

  function getRangeData() {
    return currentRange === "all" ? DATA : DATA.slice(-currentRange);
  }

  function renderStats() {
    const rd = getRangeData();
    const counts = {};
    for (let n = 1; n <= 45; n++) counts[n] = 0;
    rd.forEach((r) => r.numbers.forEach((n) => counts[n]++));

    lastCounts = counts;
    lastAvg = (rd.length * 6) / 45;
    lastRangeLabel =
      currentRange === "all"
        ? `전체 ${rd.length.toLocaleString("ko-KR")}회 기준`
        : `최근 ${rd.length}회 기준 (${rd[0].round}~${rd[rd.length - 1].round}회)`;

    $("#freqLabel").textContent = `${lastRangeLabel} · 번호당 평균 ${lastAvg.toFixed(1)}회`;
    $("#aboveOnlyHint").textContent = `(${lastRangeLabel})`;

    renderFreqGrid(counts);
    renderHotCold(counts);
    renderOddBars(rd);
    renderBandBars(counts, rd.length);
  }

  function renderFreqGrid(counts) {
    let html = "";
    for (let n = 1; n <= 45; n++) {
      const above = counts[n] > lastAvg;
      html += `
        <div class="freq-cell${above ? " freq-cell--above" : ""}" title="${n}번 · ${counts[n]}회 (평균 ${lastAvg.toFixed(1)}회)">
          ${ballHtml(n, "sm")}
          <span class="freq-count">${counts[n]}</span>
        </div>`;
    }
    $("#freqGrid").innerHTML = html;
  }

  function rankedNumbers(counts, desc) {
    const arr = [];
    for (let n = 1; n <= 45; n++) arr.push([n, counts[n]]);
    arr.sort((a, b) => (desc ? b[1] - a[1] : a[1] - b[1]) || a[0] - b[0]);
    return arr.slice(0, 6);
  }

  function renderHotCold(counts) {
    const hot = rankedNumbers(counts, true);
    const cold = rankedNumbers(counts, false);
    $("#hotBalls").innerHTML = hot.map(([n]) => ballHtml(n, "sm")).join("");
    $("#coldBalls").innerHTML = cold.map(([n]) => ballHtml(n, "sm")).join("");
    const row = ([n, c]) => `<div class="rank-row"><span>${n}번</span><strong>${c}회</strong></div>`;
    $("#hotList").innerHTML = hot.map(row).join("");
    $("#coldList").innerHTML = cold.map(row).join("");
  }

  function barRow(label, value, max, tail) {
    const pct = max ? Math.round((value / max) * 100) : 0;
    return `
      <div class="bar-row">
        <span class="bar-label">${label}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <span class="bar-count">${tail}</span>
      </div>`;
  }

  function renderOddBars(rd) {
    const dist = [0, 0, 0, 0, 0, 0, 0];
    rd.forEach((r) => dist[r.numbers.filter((n) => n % 2 === 1).length]++);
    const max = Math.max(...dist);
    $("#oddBars").innerHTML = dist
      .map((c, i) => barRow(`홀 ${i}개`, c, max, `${c}회 · ${((c / rd.length) * 100).toFixed(1)}%`))
      .join("");
  }

  function renderBandBars(counts, rounds) {
    const bands = [
      ["1~10", 1, 10],
      ["11~20", 11, 20],
      ["21~30", 21, 30],
      ["31~40", 31, 40],
      ["41~45", 41, 45],
    ];
    const total = rounds * 6;
    const shares = bands.map(([, lo, hi]) => {
      let s = 0;
      for (let n = lo; n <= hi; n++) s += counts[n];
      return s;
    });
    const max = Math.max(...shares);
    $("#bandBars").innerHTML = bands
      .map(([label, lo, hi], i) => {
        const expected = ((hi - lo + 1) / 45) * 100;
        const actual = (shares[i] / total) * 100;
        return barRow(label, shares[i], max, `${actual.toFixed(1)}% (기대 ${expected.toFixed(1)}%)`);
      })
      .join("");
  }

  function aboveAveragePool() {
    const pool = [];
    for (let n = 1; n <= 45; n++) if (lastCounts[n] > lastAvg) pool.push(n);
    return pool;
  }

  function renderMiniTickets(target, games, tag) {
    $(target).innerHTML = games
      .map(
        (nums, i) => `
        <div class="mini-ticket">
          <div class="mini-head"><span>GAME ${i + 1}</span><span>${tag || ""}</span></div>
          <div class="mini-balls">${ballsHtml(nums, "sm")}</div>
        </div>`
      )
      .join("");
  }

  function runAboveRecommend() {
    if (!lastCounts) return;
    let pool = aboveAveragePool();
    if (pool.length < 6) pool = Array.from({ length: 45 }, (_, i) => i + 1);
    const games = [];
    for (let i = 0; i < 5; i++) games.push(sampleDistinct(pool, 6).sort((a, b) => a - b));
    renderMiniTickets("#aboveRecommendTickets", games, `평균 초과 ${pool.length}개 풀`);
  }

  /* ---------------------------------------------------------------------
     POSITION-SHARE GENERATOR (자리별 비중 추출)
     --------------------------------------------------------------------- */
  function initPos() {
    const slider = $("#posThrSlider");
    const num = $("#posThrNum");

    function setThreshold(v) {
      let t = parseInt(v, 10);
      if (!isFinite(t)) return;
      t = Math.max(1, Math.min(100, t));
      posState.threshold = t;
      slider.value = String(t);
      if (document.activeElement !== num) num.value = String(t);
      recomputePos();
    }
    slider.addEventListener("input", () => setThreshold(slider.value));
    num.addEventListener("input", () => setThreshold(num.value));
    num.addEventListener("blur", () => { num.value = String(posState.threshold); });

    $("#posRange").addEventListener("change", (e) => {
      posState.range = e.target.value;
      recomputePos();
    });

    $$("#posCountChoice .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        $$("#posCountChoice .chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        posState.count = parseInt(chip.dataset.count, 10);
      });
    });
    $$("#posViewChoice .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        $$("#posViewChoice .chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        posState.view = chip.dataset.view;
        renderPosTable();
      });
    });
    $("#posForm").addEventListener("submit", (e) => {
      e.preventDefault();
      runPosGenerate();
    });

    recomputePos();
  }

  function posRangeData() {
    if (posState.range === "all") return DATA;
    return DATA.slice(-parseInt(posState.range, 10));
  }

  // 번호×자리 표 + 후보 + 경우의 수를 다시 계산 (범위/기준이 바뀔 때마다)
  function recomputePos() {
    const rounds = posRangeData();
    const counts = [];
    for (let n = 0; n <= 45; n++) counts.push([0, 0, 0, 0, 0, 0]);
    rounds.forEach((r) => {
      const s = r.numbers.slice().sort((a, b) => a - b);
      s.forEach((n, k) => { counts[n][k]++; });
    });
    const totals = counts.map((row) => row.reduce((a, b) => a + b, 0));
    posState.counts = counts;
    posState.totals = totals;
    posState.rounds = rounds.length;
    computePosCandidates();
    renderPosAll();
  }

  function candidatesAt(thr) {
    const c = [[], [], [], [], [], []];
    const { counts, totals } = posState;
    for (let k = 0; k < 6; k++) {
      for (let n = 1; n <= 45; n++) {
        // 정수 비교: counts/totals >= thr/100  <=>  counts*100 >= thr*totals
        if (totals[n] > 0 && counts[n][k] > 0 && counts[n][k] * 100 >= thr * totals[n]) c[k].push(n);
      }
    }
    return c;
  }

  // W[k][p] = 앞 번호가 p일 때 k번째~6번째 자리를 후보로 채우는 경우의 수
  function buildW(cands) {
    const W = [];
    for (let k = 0; k <= 6; k++) W.push(new Array(46).fill(0));
    for (let p = 0; p <= 45; p++) W[6][p] = 1;
    for (let k = 5; k >= 0; k--) {
      for (let p = 0; p <= 45; p++) {
        let s = 0;
        for (const c of cands[k]) if (c > p) s += W[k + 1][c];
        W[k][p] = s;
      }
    }
    return W;
  }

  function computePosCandidates() {
    posState.cands = candidatesAt(posState.threshold);
    posState.W = buildW(posState.cands);
    posState.combos = posState.W[0][0];
  }

  // 후보가 하나도 안 이어지는 경우를 위해: 6개를 만들 수 있는 가장 높은 기준(%)
  function maxFeasibleThreshold() {
    for (let t = 100; t >= 1; t--) {
      if (buildW(candidatesAt(t))[0][0] > 0) return t;
    }
    return 0;
  }

  function drawPosOne(weighted) {
    const { cands, W, counts } = posState;
    const out = [];
    let prev = 0;
    for (let k = 0; k < 6; k++) {
      const opts = cands[k].filter((c) => c > prev && W[k + 1][c] > 0);
      if (!opts.length) return null;
      let pick;
      if (weighted) {
        const total = opts.reduce((a, c) => a + counts[c][k], 0);
        let r = Math.random() * total;
        pick = opts[opts.length - 1];
        for (const c of opts) {
          r -= counts[c][k];
          if (r < 0) { pick = c; break; }
        }
      } else {
        pick = opts[Math.floor(Math.random() * opts.length)];
      }
      out.push(pick);
      prev = pick;
    }
    return out;
  }

  function runPosGenerate() {
    const err = $("#posError");
    err.textContent = "";
    if (posState.combos === 0) {
      const mx = maxFeasibleThreshold();
      err.textContent = mx
        ? `이 기준(${posState.threshold}%)으로는 6개를 이을 수 없어요. ${mx}% 이하로 낮춰보세요.`
        : "후보를 만들 수 없어요. 데이터 범위를 바꿔보세요.";
      $("#posTickets").innerHTML = '<div class="gen-empty">조건에 맞는 조합을 찾지 못했어요.</div>';
      return;
    }
    const weighted = $("#posMode").value === "weighted";
    const games = [];
    for (let i = 0; i < posState.count; i++) {
      const g = drawPosOne(weighted);
      if (g) games.push(g);
    }
    renderMiniTickets("#posTickets", games, `기준 ${posState.threshold}%`);
  }

  function renderPosAll() {
    renderPosSummary();
    renderPosCands();
    renderPosTable();
    $("#posError").textContent = "";
  }

  function renderPosSummary() {
    const { cands, combos, rounds } = posState;
    const C645 = 8145060;
    const sizes = cands.map((c) => c.length).join(" / ");
    // 이 기준의 후보 안에 6개가 모두 들어가는 과거 회차
    const inside = posRangeData().filter((r) =>
      r.numbers.slice().sort((a, b) => a - b).every((n, k) => cands[k].includes(n))
    ).length;
    const pct = (combos / C645) * 100;
    let html =
      `<div class="pos-stat"><span>기준</span><b>${posState.threshold}%</b></div>` +
      `<div class="pos-stat"><span>자리별 후보 수</span><b>${sizes}</b></div>` +
      `<div class="pos-stat"><span>만들 수 있는 조합</span><b>${combos.toLocaleString("ko-KR")}개</b><em>전체의 ${pct.toFixed(1)}%</em></div>` +
      `<div class="pos-stat"><span>과거 회차 중 후보 안에 든 회차</span><b>${inside} / ${rounds}</b><em>${((inside / rounds) * 100).toFixed(1)}%</em></div>`;
    if (combos === 0) {
      const mx = maxFeasibleThreshold();
      html += `<p class="pos-warn">이 기준에서는 6개를 이을 수 없어요.${mx ? ` ${mx}% 이하로 낮춰보세요.` : ""}</p>`;
    }
    $("#posSummary").innerHTML = html;
  }

  function renderPosCands() {
    $("#posCands").innerHTML = posState.cands
      .map(
        (list, k) => `
        <div class="pos-cand-row">
          <div class="pos-cand-name">${POS_NAMES[k]} <em>${list.length}개</em></div>
          <div class="pos-cand-balls">${list.length ? ballsHtml(list, "xs") : '<span class="pos-none">후보 없음</span>'}</div>
        </div>`
      )
      .join("");
  }

  function renderPosTable() {
    const { counts, totals, cands, view } = posState;
    const candSet = cands.map((c) => new Set(c));
    let html = '<div class="pos-row pos-row--head"><div class="pos-cell pos-cell--n">번호</div>';
    POS_NAMES.forEach((nm) => { html += `<div class="pos-cell">${nm}</div>`; });
    html += '<div class="pos-cell">합계</div></div>';
    for (let n = 1; n <= 45; n++) {
      html += `<div class="pos-row"><div class="pos-cell pos-cell--n">${ballHtml(n, "xs")}</div>`;
      for (let k = 0; k < 6; k++) {
        const c = counts[n][k];
        let text;
        if (view === "share") text = totals[n] && c ? ((c / totals[n]) * 100).toFixed(1) : "·";
        else text = c ? String(c) : "·";
        const on = candSet[k].has(n) ? " pos-cell--above" : "";
        html += `<div class="pos-cell${on}">${text}</div>`;
      }
      html += `<div class="pos-cell pos-cell--sum">${totals[n]}</div></div>`;
    }
    $("#posTable").innerHTML = html;
  }

  /* ---------------------------------------------------------------------
     GENERATOR
     --------------------------------------------------------------------- */
  function initGenerator() {
    buildPicker("#includePicker", genState.include, genState.exclude, "#excludePicker", "#includeCount");
    buildPicker("#excludePicker", genState.exclude, genState.include, "#includePicker", "#excludeCount");

    $$("#consecChoice .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        $$("#consecChoice .chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        genState.consec = chip.dataset.consec;
      });
    });

    $$("#countChoice .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        $$("#countChoice .chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        genState.count = parseInt(chip.dataset.count, 10);
      });
    });

    $("#genForm").addEventListener("submit", (e) => {
      e.preventDefault();
      runGenerate();
    });
  }

  function buildPicker(sel, ownSet, otherSet, otherSel, countSel) {
    const box = $(sel);
    let html = "";
    for (let n = 1; n <= 45; n++) html += `<button type="button" class="num-btn" data-n="${n}">${n}</button>`;
    box.innerHTML = html;

    $$(".num-btn", box).forEach((btn) => {
      btn.addEventListener("click", () => {
        const n = parseInt(btn.dataset.n, 10);
        if (ownSet.has(n)) {
          ownSet.delete(n);
          btn.classList.remove("is-active");
        } else {
          ownSet.add(n);
          btn.classList.add("is-active");
          if (otherSet.has(n)) {
            otherSet.delete(n);
            const ob = $(`.num-btn[data-n="${n}"]`, $(otherSel));
            if (ob) ob.classList.remove("is-active");
          }
        }
        $("#includeCount").textContent = `(${genState.include.size}개 선택)`;
        $("#excludeCount").textContent = `(${genState.exclude.size}개 선택)`;
      });
    });
  }

  function readConditions() {
    const odd = $("#oddCount").value;
    const sMin = $("#sumMin").value;
    const sMax = $("#sumMax").value;
    return {
      include: Array.from(genState.include),
      exclude: Array.from(genState.exclude),
      consec: genState.consec,
      count: genState.count,
      oddCount: odd === "any" ? null : parseInt(odd, 10),
      sumMin: sMin === "" ? null : parseInt(sMin, 10),
      sumMax: sMax === "" ? null : parseInt(sMax, 10),
      aboveOnly: $("#aboveOnly").checked,
      avoidPast: $("#avoidPast").checked,
    };
  }

  function buildPool(cond) {
    let pool = [];
    for (let n = 1; n <= 45; n++) {
      if (cond.exclude.includes(n)) continue;
      if (cond.include.includes(n)) continue; // 포함 번호는 따로 먼저 넣음
      if (cond.aboveOnly && !(lastCounts[n] > lastAvg)) continue;
      pool.push(n);
    }
    return pool;
  }

  function validate(cond, pool) {
    if (cond.include.length > 6) return "포함할 번호는 최대 6개까지 고를 수 있어요.";
    if (cond.sumMin !== null && cond.sumMax !== null && cond.sumMin > cond.sumMax) return "합계 최소값이 최대값보다 커요.";
    if (cond.sumMax !== null && cond.sumMax < 21) return "합계는 최소 21(1+2+3+4+5+6)이에요. 최대값을 키워주세요.";
    if (cond.sumMin !== null && cond.sumMin > 255) return "합계는 최대 255(40+41+...+45)예요. 최소값을 줄여주세요.";
    const need = 6 - cond.include.length;
    if (pool.length < need) {
      return cond.aboveOnly
        ? `평균 초과 번호 풀이 부족해요(${pool.length}개 남음). '평균 초과 번호만' 옵션을 끄거나 제외 번호를 줄여주세요.`
        : `제외 번호가 너무 많아서 6개를 채울 수 없어요.`;
    }
    return null;
  }

  function hasConsecutive(nums) {
    for (let i = 1; i < nums.length; i++) if (nums[i] - nums[i - 1] === 1) return true;
    return false;
  }

  function tryOne(cond, pool, pastSet) {
    const nums = cond.include.concat(sampleDistinct(pool, 6 - cond.include.length)).sort((a, b) => a - b);

    if (cond.oddCount !== null && nums.filter((n) => n % 2 === 1).length !== cond.oddCount) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    if (cond.sumMin !== null && sum < cond.sumMin) return null;
    if (cond.sumMax !== null && sum > cond.sumMax) return null;
    const consec = hasConsecutive(nums);
    if (cond.consec === "no" && consec) return null;
    if (cond.consec === "yes" && !consec) return null;
    if (pastSet && pastSet.has(nums.join("-"))) return null;
    return nums;
  }

  function runGenerate() {
    const errEl = $("#genError");
    const cond = readConditions();
    const pool = buildPool(cond);

    const err = validate(cond, pool);
    if (err) {
      errEl.textContent = err;
      return;
    }
    errEl.textContent = "";

    const pastSet = cond.avoidPast ? new Set(DATA.map((r) => r.numbers.join("-"))) : null;
    const results = [];
    const seen = new Set();
    const MAX_ATTEMPTS = 80000;
    let attempts = 0;

    while (results.length < cond.count && attempts < MAX_ATTEMPTS) {
      attempts++;
      const one = tryOne(cond, pool, pastSet);
      if (!one) continue;
      const key = one.join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(one);
    }

    if (results.length === 0) {
      $("#genTickets").innerHTML = '<div class="gen-empty">이 조건에 맞는 번호를 찾지 못했어요. 조건을 조금 완화해보세요.</div>';
      return;
    }
    if (results.length < cond.count) {
      errEl.textContent = `조건이 까다로워서 ${results.length}게임만 뽑혔어요 (요청: ${cond.count}게임).`;
    }
    renderMiniTickets("#genTickets", results, "");
  }
})();
