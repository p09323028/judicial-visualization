/* 司法統計視覺化：讀取 data/data.js（window.JUDICIAL_DATA）並繪製圖表 */
(function () {
  'use strict';
  const DATA = window.JUDICIAL_DATA;
  if (!DATA) {
    document.querySelector('main').innerHTML = '<p class="lede">找不到資料檔，請先執行 <code>python scripts/build_data.py</code>。</p>';
    return;
  }
  const META = DATA.meta;
  const T = DATA.tables;

  // ---------- 語言 ----------
  // tr(中文, 英文)：依目前語言挑字串；英文版年份一律換成西元（民國年 + 1911）
  const { EN, t: tr, label: lb, court: courtEn, MON } = window.I18N || { EN: false, t: (z) => z, label: (s) => s, court: (s) => s, MON: [] };
  const LOCALE = EN ? 'en-US' : 'zh-TW';
  const SRC = tr('資料來源：司法院統計月報', 'Source: Judicial Yuan Monthly Statistics');
  const ad = (y) => +y + 1911;
  const yr = (y) => (EN ? String(ad(y)) : `${y}年`);           // 年份標籤：115年 / 2026
  const U = (u) => (EN ? ({ '件': ' cases', '天': ' days', '人': ' people', '項': ' items' }[u] ?? u) : u);   // 單位
  const monthRange = (m1, m2, y) => (EN ? `${MON[m1 - 1]}–${MON[m2 - 1]} ${ad(y)}` : `${y}年${m1}–${m2}月`);

  // ---------- 工具 ----------
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const series = (i) => css(`--series-${i}`);
  const fmt = (v, d = 0) => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString(LOCALE, { maximumFractionDigits: d, minimumFractionDigits: d });
  const fmtBig = (v) => {
    if (v == null) return { n: '—', u: '' };
    if (Math.abs(v) >= 1e6) return EN
      ? { n: (v / 1e6).toLocaleString(LOCALE, { maximumFractionDigits: 2 }), u: 'M' }
      : { n: (v / 1e4).toLocaleString(LOCALE, { maximumFractionDigits: 1 }), u: '萬' };
    return { n: fmt(v), u: '' };
  };
  const per = (p) => { const [y, m] = p.split('-'); return EN ? `${MON[+m - 1]} ${ad(y)}` : `${y}年${+m}月`; };
  const perShort = (p) => { const [y, m] = p.split('-'); return EN ? `${MON[+m - 1]} ’${String(ad(y)).slice(2)}` : `${y}/${+m}`; };
  // 表的期間標籤（6 月為推算值）與累計期間
  const periodOf = (t0, k) => (EN ? per(k) + ((tbl(t0).derived || []).includes(k) ? ' (est.)' : '') : (tbl(t0).periods?.[k] || per(k)));
  const cumOf = (t0, k) => {
    const c = tbl(t0).cumulative?.[k];
    if (!EN) return c || '累計資料';
    const [y, m] = k.split('-');
    return c ? `${monthRange(1, +m, y)} cumulative figures` : 'cumulative figures';
  };
  const shortCourt = (n) => {
    const s = n.replace(/^臺灣|^福建/, '').replace('地方法院', '地院').replace('少家法院', '少家');
    return EN ? courtEn(s.replace('地院', '')) : s;
  };
  const pct = (a, b) => (b ? (a / b) * 100 : null);
  const tbl = (id) => T['t' + String(id).padStart(2, '0')];
  const latest = META.latest;
  const [LY, LM] = latest.split('-').map(Number);
  const ytdLabel = LM === 12 ? tr(`${LY}年全年`, `${ad(LY)} full year`) : monthRange(1, LM, LY);
  const annualYears = (t) => Object.keys(tbl(t).annual);
  const annual = (t, col) => annualYears(t).map((y) => tbl(t).annual[y][col] ?? null);
  const months = (t) => Object.keys(tbl(t).monthly);
  const monthly = (t, col) => months(t).map((k) => tbl(t).monthly[k][col] ?? null);
  const ytd = (t, col) => tbl(t).ytd?.values?.[col];
  const yoy = (t, col) => {
    const v = tbl(t).YoY?.[col];
    if (v != null) return v;
    // 表內沒有「與上年同期比較」列時，用月資料自行計算
    const mo = tbl(t).monthly || {};
    let cur = 0, prev = 0;
    for (let m = 1; m <= LM; m++) {
      const a = mo[`${LY}-${String(m).padStart(2, '0')}`]?.[col], b = mo[`${LY - 1}-${String(m).padStart(2, '0')}`]?.[col];
      if (a == null || b == null) return null;
      cur += a; prev += b;
    }
    return prev ? ((cur - prev) / prev) * 100 : null;
  };
  const sourceOf = (...ids) => `${SRC} ${tr('表', ids.length > 1 ? 'Tables ' : 'Table ')}${ids.map((i) => String(i).padStart(2, '0')).join(tr('、', ', '))}`;
  const lastSnapshot = (t) => { const ks = Object.keys(tbl(t).months); return ks[ks.length - 1]; };
  const isDistrictCourt = (n) => /^(臺灣|福建).+(地方法院|少家法院)$/.test(n);
  const sum = (arr) => arr.reduce((a, b) => a + (b || 0), 0);
  // 平均天數這類比率沒有官方的「較去年同期」，用每月平均天數 × 終結件數加權，重算去年同期（1 月～最新月份）的平均
  const prevYtdAvg = (t, col, weightCol) => {
    const mo = tbl(t).monthly || {};
    let num = 0, den = 0;
    for (let m = 1; m <= LM; m++) {
      const r = mo[`${LY - 1}-${String(m).padStart(2, '0')}`];
      if (r?.[col] == null || !r[weightCol]) return null;
      num += r[col] * r[weightCol]; den += r[weightCol];
    }
    return den ? num / den : null;
  };

  // ---------- 卡片與圖表 ----------
  const charts = [];
  function card(id, { title, takeaway, source, height, hint }) {
    const el = document.getElementById(id);
    const chartDom = el.querySelector('.chart');
    if (chartDom && echarts.getInstanceByDom(chartDom)) {
      el.querySelector('h3').textContent = title;
      const tk = el.querySelector('.takeaway');
      if (tk) tk.textContent = takeaway || '';
      el.querySelector('.source').textContent = source || SRC;
      const h = el.querySelector('.hint');
      if (h) h.textContent = hint || '';
      chartDom.className = `chart ${height || ''}`;
      return el;
    }
    el.innerHTML = `
      <h3>${title}</h3>
      <p class="takeaway">${takeaway || ''}</p>
      ${hint ? `<p class="hint">${hint}</p>` : ''}
      <div class="chart ${height || ''}"></div>
      <div class="card-foot"><span class="source">${source || SRC}</span>
        <button class="table-toggle" type="button" aria-expanded="false">${tr('查看數據', 'View data')}</button></div>
      <div class="data-table-wrap" hidden></div>`;
    const btn = el.querySelector('.table-toggle');
    const wrap = el.querySelector('.data-table-wrap');
    btn.addEventListener('click', () => {
      const open = wrap.hidden;
      wrap.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? tr('隱藏數據', 'Hide data') : tr('查看數據', 'View data');
    });
    return el;
  }

  function renderTable(el, cats, ser, catHead, digits) {
    const head = `<tr><th>${catHead || ''}</th>${ser.map((s) => `<th>${s.name}</th>`).join('')}</tr>`;
    const rows = cats.map((c, i) => `<tr><td>${c}</td>${ser.map((s) => `<td>${fmt(s.data[i], s.digits ?? digits ?? 0)}</td>`).join('')}</tr>`).join('');
    el.querySelector('.data-table-wrap').innerHTML = `<table class="data-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  }

  function baseOption() {
    const muted = css('--axis-muted'), grid = css('--grid'), base = css('--baseline');
    const text2 = css('--text-secondary');
    return {
      animationDuration: 400,
      textStyle: { fontFamily: css('--font') || 'system-ui', color: text2 },
      grid: { left: 8, right: 24, top: 36, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', confine: true,
        backgroundColor: css('--surface-1'), borderColor: css('--border'), borderWidth: 1,
        textStyle: { color: css('--text-primary'), fontSize: 13 },
        axisPointer: { type: 'line', lineStyle: { color: base, width: 1 } },
      },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 12, textStyle: { color: text2, fontSize: 13 } },
      _axis: {
        axisLine: { lineStyle: { color: base } },
        axisTick: { show: false },
        axisLabel: { color: muted, fontSize: 12 },
        splitLine: { lineStyle: { color: grid, width: 1 } },
      },
    };
  }

  function mount(el, option, handlers = {}) {
    const dom = el.querySelector('.chart');
    let c = echarts.getInstanceByDom(dom);
    if (!c) {
      c = echarts.init(dom, null, { renderer: 'svg' }); charts.push(c);
      c.setOption(option, true);
    } else {
      // 連動更新：用合併模式讓長條、線條平滑過渡（整份替換會銷毀提示框並重播進場動畫）；
      // 只有資料系列數量改變時才替換系列
      c.resize();
      const prevN = (c.getOption().series || []).length;
      c.setOption(option, prevN === option.series.length ? undefined : { replaceMerge: ['series'] });
    }
    // 只移除自己綁的處理器；不帶參數的 getZr().off('click') 會連 ECharts 內部的點擊處理一起移除
    c.off('click');
    if (c.__zrClick) { c.getZr().off('click', c.__zrClick); c.__zrClick = null; }
    const clickable = !!(handlers.item || handlers.axisIndex);
    dom.classList.toggle('clickable', clickable);
    if (handlers.item) {
      c.on('click', (p) => {
        if (p.componentType === 'series') handlers.item(p.name, p.seriesName);
        else if (p.componentType === 'xAxis' || p.componentType === 'yAxis') handlers.item(p.value, null);
      });
    }
    if (handlers.axisIndex) {
      // 點圖表任何位置都選到最近的類別（年份、月份），不必剛好點中資料點
      c.__zrClick = (e) => {
        const pt = [e.offsetX, e.offsetY];
        if (!c.containPixel('grid', pt)) return;
        const v = c.convertFromPixel({ gridIndex: 0 }, pt);
        const i = v ? Math.round(v[0]) : -1;
        const n = c.getOption().xAxis[0].data.length;
        if (i >= 0 && i < n) handlers.axisIndex(i);
      };
      c.getZr().on('click', c.__zrClick);
    }
    el._chart = c;
    return c;
  }

  const valueFormatter = (digits, unit = '') => (v) => (v == null ? '—' : fmt(v, digits) + U(unit));
  const axisNum = (v) => (EN
    ? (Math.abs(v) >= 1e6 ? +(v / 1e6).toFixed(2) + 'M' : Math.abs(v) >= 1e4 ? +(v / 1e3).toFixed(1) + 'K' : v.toLocaleString(LOCALE))
    : (Math.abs(v) >= 1e4 ? (v / 1e4).toLocaleString(LOCALE, { maximumFractionDigits: 1 }) + '萬' : v.toLocaleString(LOCALE)));

  /** 折線圖。ser: [{name, data, color}] */
  function lineChart(id, { title, takeaway, source, cats, ser, digits = 0, unit = '', catHead = tr('期間', 'Period'), yMin, endLabel = true, area = false, height, hint, selectedIndex, onSelectIndex, focusName, onSelectSeries }) {
    const el = card(id, { title, takeaway, source, height, hint });
    const o = baseOption();
    const ax = o._axis; delete o._axis;
    o.legend.show = ser.length > 1;
    if (ser.length === 1) o.grid.top = 16;
    // 線尾直接標名稱：只在 2–3 條線且名稱短時使用，否則交給圖例，避免文字重疊或被裁切
    const useEnd = endLabel && ser.length > 1 && ser.length <= 3 && ser.every((s) => s.name.length <= (EN ? 10 : 4));
    o.grid.right = useEnd ? 64 : 24;
    o.tooltip.valueFormatter = valueFormatter(digits, unit);
    o.xAxis = { type: 'category', data: cats, boundaryGap: false, ...ax, splitLine: { show: false } };
    o.yAxis = { type: 'value', min: yMin, ...ax, axisLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: unit === '%' ? '{value}%' : axisNum } };
    o.series = ser.map((s, i) => {
      const dim = focusName && s.name !== focusName;
      const strong = focusName && s.name === focusName;
      const color = s.color || series(i + 1);
      return {
        name: s.name, type: 'line', data: s.data, smooth: false, symbol: 'circle', symbolSize: strong ? 9 : 7, showSymbol: cats.length <= 24,
        z: strong ? 5 : 2,
        triggerLineEvent: !!onSelectSeries,
        lineStyle: { width: strong ? 3 : 2, color, opacity: dim ? 0.35 : 1 },
        itemStyle: { color, borderColor: css('--surface-1'), borderWidth: 2, opacity: dim ? 0.35 : 1 },
        areaStyle: area ? { color, opacity: 0.08 } : undefined,
        endLabel: useEnd ? { show: true, formatter: '{a}', color: css('--text-secondary'), fontSize: 12 } : undefined,
        emphasis: { focus: focusName ? 'none' : 'series' },
        markLine: {
          silent: true, symbol: 'none', animation: false,
          lineStyle: { color: css('--text-secondary'), width: 1, type: 'solid' },
          label: { show: true, position: 'end', formatter: selectedIndex != null ? cats[selectedIndex] : '', color: css('--text-primary'), fontSize: 12, fontWeight: 600 },
          data: i === 0 && selectedIndex != null ? [{ xAxis: selectedIndex }] : [],
        },
      };
    });
    if (selectedIndex != null) o.grid.top = Math.max(o.grid.top, 28);
    mount(el, o, {
      axisIndex: onSelectIndex,
      item: onSelectSeries ? (_n, seriesName) => seriesName && onSelectSeries(seriesName) : undefined,
    });
    renderTable(el, cats, ser, catHead, digits);
    return el;
  }

  /** 長條圖（horizontal=true 為橫條，適合排名） */
  function barChart(id, { title, takeaway, source, cats, ser, digits = 0, unit = '', catHead = tr('項目', 'Item'), horizontal = false, stack = false, height, labels = true, colors, hint, selected, onSelect }) {
    const el = card(id, { title, takeaway, source, height, hint });
    if (selected != null && ser.length === 1 && cats.includes(selected)) {
      colors = cats.map((c, j) => (c === selected ? (colors ? colors[j] : (ser[0].color || series(1))) : css('--neutral')));
    }
    const o = baseOption();
    const ax = o._axis; delete o._axis;
    o.legend.show = ser.length > 1;
    if (ser.length === 1) o.grid.top = 12;
    o.tooltip.trigger = 'axis';
    o.tooltip.axisPointer = { type: 'shadow', shadowStyle: { color: css('--grid'), opacity: 0.4 } };
    o.tooltip.valueFormatter = valueFormatter(digits, unit);
    const catAxis = { type: 'category', data: cats, triggerEvent: !!onSelect, ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, color: css('--text-secondary'), fontSize: 12, interval: 0,
      ...(selected != null ? { formatter: (v) => (v === selected ? `{sel|${v}}` : v), rich: { sel: { color: css('--text-primary'), fontWeight: 700, fontSize: 12 } } } : {}) } };
    const valAxis = { type: 'value', ...ax, splitNumber: window.innerWidth < 600 ? 3 : 5, axisLine: { show: false }, axisLabel: { ...ax.axisLabel, hideOverlap: true, formatter: unit === '%' ? '{value}%' : axisNum } };
    if (horizontal) { catAxis.inverse = true; o.xAxis = valAxis; o.yAxis = catAxis; o.grid.right = labels ? 64 : 24; }
    else { o.xAxis = catAxis; o.yAxis = valAxis; if (cats.length > 8) catAxis.axisLabel.rotate = 0; catAxis.axisLabel.hideOverlap = true; catAxis.axisLabel.interval = 'auto'; }
    const r = 4;
    o.series = ser.map((s, i) => ({
      name: s.name, type: 'bar', data: s.data.map((v, j) => (colors ? { value: v, itemStyle: { color: colors[j] } } : v)),
      stack: stack ? 'a' : undefined,
      barMaxWidth: horizontal ? 18 : 28, barCategoryGap: horizontal ? '35%' : '30%', barGap: '12%',
      itemStyle: {
        color: s.color || series(i + 1),
        borderRadius: stack ? (i === ser.length - 1 ? (horizontal ? [0, r, r, 0] : [r, r, 0, 0]) : 0) : (horizontal ? [0, r, r, 0] : [r, r, 0, 0]),
        borderColor: stack ? css('--surface-1') : undefined, borderWidth: stack ? 1 : 0,
      },
      label: labels && !stack && ser.length === 1 ? {
        show: true, position: horizontal ? 'right' : 'top', color: css('--text-secondary'), fontSize: 12,
        formatter: (p) => fmt(p.value, digits) + (unit === '%' ? '%' : ''),
      } : undefined,
      emphasis: { focus: ser.length > 1 ? 'series' : 'none' },
    }));
    mount(el, o, { item: onSelect ? (name) => onSelect(name) : undefined });
    renderTable(el, cats, ser, catHead, digits);
    return el;
  }

  function tiles(containerId, items) {
    document.getElementById(containerId).innerHTML = items.map((it) => {
      const b = it.raw ? { n: it.value, u: '' } : fmtBig(it.value);
      let delta = '';
      if (it.delta != null && !isNaN(it.delta)) {
        const up = it.delta > 0;
        const arrow = it.delta === 0 ? '→' : (up ? '▲' : '▼');
        delta = `<p class="t-delta"><span class="${up ? 'up' : 'down'}">${arrow} ${fmt(Math.abs(it.delta), 1)}${it.deltaUnit || '%'}</span> ${it.deltaText || tr('較去年同期', 'vs. same period last year')}</p>`;
      } else if (it.note) delta = `<p class="t-delta">${it.note}</p>`;
      return `<div class="tile"><p class="t-label">${it.label}</p><p class="t-value">${b.n}<span class="t-unit">${b.u}${U(it.unit || '')}</span></p>${delta}</div>`;
    }).join('');
  }

  const yearCats = (t) => annualYears(t).map(yr);
  const monthCats = (t) => months(t).map(perShort);

  // ---------- 一眼看懂 ----------
  function renderHome() {
    document.getElementById('ytdLabel').textContent = ytdLabel + ' ';
    tiles('homeTiles', [
      { label: tr('各級法院新收案件', 'New cases, all courts'), value: ytd(1, '合計'), unit: '件', delta: yoy(1, '合計') },
      { label: tr('地方法院刑事新收', 'District court criminal cases'), value: ytd(38, '受理件數/新收'), unit: '件', delta: yoy(38, '受理件數/新收') },
      { label: tr('地方法院民事新收', 'District court civil cases'), value: ytd(22, '受理件數/新收'), unit: '件', delta: yoy(22, '受理件數/新收') },
      { label: tr('詐欺罪第一審終結', 'Fraud cases closed'), value: ytd(41, '詐欺罪'), unit: '件', delta: yoy(41, '詐欺罪') },
      { label: tr('家暴保護令聲請（新收）', 'DV protection order petitions'), value: ytd(35, '受理件數/新收'), unit: '件', delta: yoy(35, '受理件數/新收') },
      (() => {
        const col = '終結事件平均一件所需日數', cur = ytd(38, col), prev = prevYtdAvg(38, col, '終結件數');
        return { label: tr('地方法院刑事平均審理天數', 'District court criminal: avg. days'), value: fmt(cur, 1), raw: true, unit: '天',
          delta: cur != null && prev != null ? cur - prev : null, deltaUnit: tr(' 天', ' days'),
          note: tr('地方法院，今年累計', 'District courts, year to date') };
      })(),
    ]);

    homeState = { year: null, cat: null };
    const yb = document.getElementById('hYear'), cb = document.getElementById('hCat');
    yb.innerHTML = `<option value="">${ytdLabel}${tr('（今年累計）', ' (year to date)')}</option>` + annualYears(1).slice().reverse().map((y) => `<option value="${y}">${yr(y)}</option>`).join('');
    cb.innerHTML = `<option value="">${tr('全部案件', 'All cases')}</option>` + HOME_CATS.map((c) => `<option value="${c.n}">${c.n}</option>`).join('');
    yb.onchange = () => { homeState.year = yb.value || null; drawHomeLinked(); };
    cb.onchange = () => { homeState.cat = cb.value || null; drawHomeLinked(); };
    document.getElementById('hReset').onclick = () => { homeState = { year: null, cat: null }; drawHomeLinked(); };
    drawHomeLinked();
  }

  // 「合計」不含公設辯護、調查保護（人）、家事調查官事件，這裡依合計的組成拆分
  const HOME_CATS = [
    { n: tr('強制執行', 'Enforcement'), cols: ['強制執行'] }, { n: tr('民事', 'Civil'), cols: ['民事'] }, { n: tr('刑事', 'Criminal'), cols: ['刑事'] },
    { n: tr('公證', 'Notarization'), cols: ['公證'] }, { n: tr('提存', 'Escrow'), cols: ['提存'] }, { n: tr('行政訴訟', 'Administrative'), cols: ['行政訴訟'] },
    { n: tr('其他（憲法法庭、陳訴等）', 'Other (Constitutional Court, petitions, etc.)'), cols: ['憲法法庭', '人民陳訴', '刑事補償及法官評鑑等', '懲戒及職務'] },
  ];
  const catVal = (cat, row) => sum((cat ? cat.cols : ['合計']).map((c) => row?.[c]));
  let homeState = { year: null, cat: null };

  function drawHomeLinked() {
    const st = homeState;
    const cat = HOME_CATS.find((c) => c.n === st.cat) || null;
    const catLabel = cat ? cat.n.replace(/（.*）|\s*\(.*\)/, '') : '';
    const years = annualYears(1);
    const A = tbl(1).annual;
    document.getElementById('hYear').value = st.year || '';
    document.getElementById('hCat').value = st.cat || '';
    document.getElementById('hReset').hidden = !st.year && !st.cat;

    // 十年趨勢：依選取的案件類別
    const trend = years.map((y) => catVal(cat, A[y]));
    const first = trend[0], last = trend[trend.length - 1];
    lineChart('c-home-trend', {
      title: cat ? tr(`十年來「${catLabel}」新收件數`, `New ${catLabel.toLowerCase()} cases over ten years`) : tr('十年來法院新收案件總數', 'Total new court cases over ten years'),
      takeaway: tr(`${years[years.length - 1]}年${cat ? catLabel : '共'}新收 ${last >= 1e5 ? fmt(last / 1e4, 0) + ' 萬件' : fmt(last) + ' 件'}，比 ${years[0]}年${last >= first ? '增加' : '減少'} ${fmt(Math.abs(pct(last - first, first)), 0)}%。`,
        `In ${ad(years[years.length - 1])}, new ${cat ? catLabel.toLowerCase() + ' ' : ''}cases totaled ${last >= 1e6 ? fmt(last / 1e6, 2) + ' million' : fmt(last)}, ${last >= first ? 'up' : 'down'} ${fmt(Math.abs(pct(last - first, first)), 0)}% from ${ad(years[0])}.`),
      hint: tr('點選圖上任一年，右邊會顯示那一年的案件組成；再點一次取消。', 'Click any year to see that year’s case mix; click again to clear.'),
      source: sourceOf(1), cats: yearCats(1), ser: [{ name: cat ? catLabel : tr('新收案件', 'New cases'), data: trend }], area: true, catHead: tr('年度', 'Year'),
      selectedIndex: st.year ? years.indexOf(st.year) : null,
      onSelectIndex: (i) => { const y = years[i]; homeState.year = homeState.year === y ? null : y; drawHomeLinked(); },
    });

    // 組成：依選取的年份
    const row = st.year ? A[st.year] : tbl(1).ytd.values;
    const period = st.year ? yr(st.year) : ytdLabel;
    const mix = HOME_CATS.slice(0, -1).map((c) => ({ n: c.n, v: catVal(c, row) })).sort((a, b) => b.v - a.v)
      .concat([{ n: HOME_CATS[HOME_CATS.length - 1].n, v: catVal(HOME_CATS[HOME_CATS.length - 1], row) }]);
    const totalY = row['合計'];
    barChart('c-home-mix', {
      title: tr(`法院在忙什麼？（${period}新收）`, `What are the courts busy with? (new cases, ${period})`),
      takeaway: cat
        ? tr(`${period}「${catLabel}」新收 ${fmt(catVal(cat, row))} 件，占全部 ${fmt(pct(catVal(cat, row), totalY), 1)}%。`,
          `${catLabel}: ${fmt(catVal(cat, row))} new cases in ${period}, ${fmt(pct(catVal(cat, row), totalY), 1)}% of the total.`)
        : tr(`強制執行（如拍賣、扣薪）和民事案件加起來占了 ${fmt(pct(row['強制執行'] + row['民事'], totalY), 0)}%，刑事案件約占 ${fmt(pct(row['刑事'], totalY), 0)}%。`,
          `Enforcement (e.g. auctions, wage garnishment) and civil cases together make up ${fmt(pct(row['強制執行'] + row['民事'], totalY), 0)}%; criminal cases about ${fmt(pct(row['刑事'], totalY), 0)}%.`),
      hint: tr('點選一種案件，左邊和下方的趨勢圖會改成只看這一類。', 'Click a case type to filter the trend charts to it.'),
      source: sourceOf(1), cats: mix.map((m) => m.n), ser: [{ name: tr('新收件數', 'New cases'), data: mix.map((m) => m.v) }], horizontal: true, catHead: tr('案件類別', 'Case type'),
      selected: st.cat, onSelect: (n) => { homeState.cat = homeState.cat === n ? null : n; drawHomeLinked(); },
    });

    // 每月：依選取的案件類別；選了年份時標出該年的月份範圍
    const mk = months(1);
    const mdata = mk.map((k) => catVal(cat, tbl(1).monthly[k]));
    lineChart('c-home-monthly', {
      title: cat ? tr(`每月「${catLabel}」新收件數`, `Monthly new ${catLabel.toLowerCase()} cases`) : tr('每月新收案件數', 'Monthly new cases'),
      takeaway: tr('每年 2 月因春節連假，新收案件通常明顯減少。', 'New cases usually dip every February because of the Lunar New Year holiday.'),
      source: sourceOf(1), cats: monthCats(1), catHead: tr('月份', 'Month'), height: 'short',
      ser: [{ name: cat ? catLabel : tr('各級法院合計', 'All courts'), data: mdata }],
    });
  }

  // ---------- 案件與法院 ----------
  const COURT_TYPES = {
    civil: { t: 23, name: tr('民事', 'Civil'), new: '受理件數/新收', closed: '終結件數', pending: '未結件數', days: '終結事件平均一件所需日數' },
    criminal: { t: 39, name: tr('刑事', 'Criminal'), new: '受理件數/新收', closed: '終結件數', pending: '未結件數', days: '終結案件平均一件所需日數' },
    family: { t: 33, name: tr('家事', 'Family'), new: '受理件數/新收', closed: '終結件數', pending: '未結件數', days: '終結事件平均一件所需日數' },
  };
  const METRIC_LABEL = { new: [tr('新收件數', 'new cases'), '件'], closed: [tr('終結件數', 'closed cases'), '件'], pending: [tr('未結件數', 'pending cases'), '件'], days: [tr('平均審理天數', 'average days to close'), '天'] };

  function fillMonthSelect(sel, t, keep) {
    const tb = tbl(t);
    const ks = Object.keys(tb.months).reverse();
    sel.innerHTML = ks.map((k) => `<option value="${k}">${periodOf(t, k)}</option>`).join('');
    if (keep && ks.includes(keep)) sel.value = keep;
  }

  let courtSel = null;   // 目前選取的法院（全名）

  function courtList(t) {
    return Object.keys(tbl(t).months[lastSnapshot(t)]).filter(isDistrictCourt);
  }

  function renderCourtRank() {
    const type = COURT_TYPES[document.getElementById('fCourtType').value];
    const metric = document.getElementById('fCourtMetric').value;
    const mSel = document.getElementById('fCourtMonth');
    const month = mSel.value;
    const snap = tbl(type.t).months[month];
    const col = type[metric];
    const allRows = Object.entries(snap).filter(([n]) => isDistrictCourt(n)).map(([n, v]) => ({ full: n, n: shortCourt(n), v: v[col] }));
    const derived = (tbl(type.t).derived || []).includes(month);
    // 推算月份的比率（平均天數等）無法由累計還原，值為空
    const rows = allRows.filter((r) => r.v != null).sort((a, b) => b.v - a.v);
    if (!courtSel || !allRows.some((r) => r.full === courtSel)) courtSel = (rows[0] || allRows[0]).full;
    document.getElementById('fCourt').value = courtSel;
    const [mLabel, unit] = METRIC_LABEL[metric];
    const avg = metric === 'days' ? snap['臺灣各地方法院計']?.[col] : null;
    const top = rows[0];
    const periodLabel = periodOf(type.t, month);
    barChart('c-court-rank', {
      title: tr(`各地方法院${type.name}${mLabel}（${periodLabel}）`, `District courts: ${type.name.toLowerCase()} ${mLabel} (${periodLabel})`),
      takeaway: !rows.length
        ? tr(`${per(month)}的單月數字是用「${cumOf(type.t, month)}」減去前幾個月推算的，平均天數這類比率無法這樣還原，請改選其他指標或月份。`,
          `${per(month)} figures are estimated by subtracting earlier months from the ${cumOf(type.t, month)}. Ratios such as average days can’t be recovered this way — please choose another measure or month.`)
        : (derived ? tr(`${per(month)}為推算數字：由「${cumOf(type.t, month)}」減去前幾個月單月。`, `${per(month)} figures are estimates: the ${cumOf(type.t, month)} minus earlier months. `) : '') + (metric === 'days'
        ? tr(`全國平均約 ${fmt(avg, 0)} 天；最久的是${top.n}（${fmt(top.v, 0)} 天）。天數受案件類型、複雜度影響，不能直接代表效率。`,
          `The national average is about ${fmt(avg, 0)} days; the longest is ${top.n} (${fmt(top.v, 0)} days). Duration depends on case mix and complexity, so it isn’t a direct measure of efficiency.`)
        : tr(`${top.n}最多，共 ${fmt(top.v)} ${unit}；前三名合計占全國 ${fmt(pct(sum(rows.slice(0, 3).map((r) => r.v)), sum(rows.map((r) => r.v))), 0)}%。`,
          `${top.n} has the most, with ${fmt(top.v)}; the top three account for ${fmt(pct(sum(rows.slice(0, 3).map((r) => r.v)), sum(rows.map((r) => r.v))), 0)}% of the national total.`)),
      hint: tr('點選一所法院，右邊會顯示它的每月變化與重點數字。', 'Click a court to see its monthly trend and key figures.'),
      source: sourceOf(type.t), cats: rows.map((r) => r.n), ser: [{ name: mLabel, data: rows.map((r) => r.v) }],
      horizontal: true, height: 'tall', digits: metric === 'days' ? 1 : 0, catHead: tr('法院', 'Court'),
      selected: shortCourt(courtSel),
      onSelect: (short) => { const r = rows.find((x) => x.n === short); if (r) { courtSel = r.full; renderCourtRank(); } },
    });
    renderCourtDetail(type, metric, month, allRows);
  }

  const NA_EST = tr('推算月份無此數據', 'n/a for estimated month');
  function renderCourtDetail(type, metric, month, rows) {
    const T0 = tbl(type.t);
    const have = Object.keys(T0.months);
    // 補齊中間缺少的月份（例如半年報、期別錯誤被略過的月份），在圖上留空而不是直接相連
    const ms = [];
    for (let [y, m] = have[0].split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= have[have.length - 1]; m === 12 ? (y++, m = 1) : m++) ms.push(`${y}-${String(m).padStart(2, '0')}`);
    const gaps = ms.filter((k) => !T0.months[k]).map((k) => (EN ? MON[+k.split('-')[1] - 1] : `${+k.split('-')[1]}月`));
    const col = type[metric];
    const [mLabel] = METRIC_LABEL[metric];
    const name = shortCourt(courtSel);
    const nCourts = rows.length;
    const own = ms.map((k) => T0.months[k]?.[courtSel]?.[col] ?? null);
    const nat = ms.map((k) => {
      const v = T0.months[k]?.['臺灣各地方法院計']?.[col];
      return v == null ? null : (metric === 'days' ? v : v / nCourts);
    });
    lineChart('c-court-detail', {
      title: tr(`${name}：每月${type.name}${mLabel}`, `${name}: monthly ${type.name.toLowerCase()} ${mLabel}`),
      takeaway: (metric === 'days' ? tr('和全國地方法院平均天數比較。', 'Compared with the national district court average.') : tr(`和全國 ${nCourts} 所地方法院的平均值比較。`, `Compared with the average of ${nCourts} district courts.`))
        + ((T0.derived || []).length ? tr(`標 * 的月份是由累計資料推算${metric === 'days' ? '，沒有平均天數' : ''}。`, ` Months marked * are estimated from cumulative data${metric === 'days' ? ' (no average days)' : ''}.`) : '')
        + (gaps.length ? tr(`${gaps.join('、')}沒有單月的機關別資料。`, ` No single-month court data for ${gaps.join(', ')}.`) : ''),
      hint: tr('點選月份，左邊的排名會切換到那個月。', 'Click a month to switch the ranking to that month.'),
      source: sourceOf(type.t), cats: ms.map((k) => perShort(k) + ((T0.derived || []).includes(k) ? '*' : '')), catHead: tr('月份', 'Month'), digits: metric === 'days' ? 1 : 0, unit: metric === 'days' ? '天' : '',
      ser: [{ name, data: own }, { name: metric === 'days' ? tr('全國平均', 'National average') : tr('各院平均', 'Court average'), data: nat, color: css('--neutral') }],
      endLabel: false, height: 'short',
      selectedIndex: ms.indexOf(month),
      onSelectIndex: (i) => { if (ms[i] && T0.months[ms[i]]) { document.getElementById('fCourtMonth').value = ms[i]; renderCourtRank(); } },
    });

    const snap = T0.months[month];
    const me = snap[courtSel] || {};
    const rankOf = (c) => {
      if (me[c] == null) return NA_EST;
      const vals = rows.map((r) => snap[r.full]?.[c]).filter((v) => v != null).sort((a, b) => b - a);
      return tr(`第 ${vals.indexOf(me[c]) + 1} 多`, `Rank ${vals.indexOf(me[c]) + 1} of ${vals.length}`);
    };
    const items = [
      [tr('新收', 'New'), fmt(me[type.new]), '件', rankOf(type.new)],
      [tr('終結', 'Closed'), fmt(me[type.closed]), '件', rankOf(type.closed)],
      [tr('未結', 'Pending'), fmt(me[type.pending]), '件', rankOf(type.pending)],
      [tr('平均審理天數', 'Average days'), fmt(me[type.days], 1), '天', me[type.days] == null ? NA_EST : tr(`全國 ${fmt(snap['臺灣各地方法院計']?.[type.days], 1)} 天`, `National: ${fmt(snap['臺灣各地方法院計']?.[type.days], 1)} days`)],
    ];
    const up = Object.keys(me).find((k) => /^上訴(案件|事件)維持率$/.test(k));
    if (up && (me[up] != null || T0.derived?.includes(month))) items.push([tr('上訴維持率', 'Upheld on appeal'), fmt(me[up], 1), '%', me[up] == null ? NA_EST : tr('上級法院維持原判的比例', 'Share upheld by the higher court')]);
    const settle = me['調解成立百分比/百分比一'];
    if (settle != null || (type.t === 33 && T0.derived?.includes(month))) items.push([tr('調解成立比例', 'Mediation success'), fmt(settle, 1), '%', settle == null ? NA_EST : tr('成立 ÷（成立＋不成立）', 'Settled ÷ (settled + failed)')]);
    document.getElementById('c-court-profile').innerHTML = `
      <h3>${tr(`${name}重點數字`, `${name}: key figures`)}</h3>
      <p class="takeaway">${tr(`${type.name}事件，${periodOf(type.t, month)}；排名是在 ${nCourts} 所地方法院中的名次。`, `${type.name} cases, ${periodOf(type.t, month)}. Ranks are among ${nCourts} district courts.`)}</p>
      <dl class="profile">${items.map(([k, v, u, note]) => `<div><dt>${k}</dt><dd>${v}<small>${U(u)}</small></dd><dd class="muted">${note}</dd></div>`).join('')}</dl>
      <div class="card-foot"><span class="source">${sourceOf(type.t)}</span></div>`;
  }

  function renderCourts() {
    const mSel = document.getElementById('fCourtMonth');
    const typeSel = document.getElementById('fCourtType');
    const cSel = document.getElementById('fCourt');
    fillMonthSelect(mSel, COURT_TYPES[typeSel.value].t, mSel.value);
    cSel.innerHTML = courtList(COURT_TYPES[typeSel.value].t).map((n) => `<option value="${n}">${shortCourt(n)}</option>`).join('');
    typeSel.onchange = (() => { fillMonthSelect(mSel, COURT_TYPES[typeSel.value].t, mSel.value); renderCourtRank(); });
    document.getElementById('fCourtMetric').onchange = renderCourtRank;
    mSel.onchange = renderCourtRank;
    cSel.onchange = () => { courtSel = cSel.value; renderCourtRank(); };
    renderCourtRank();

    lineChart('c-court-days', {
      title: tr('一件案子平均要審多久？', 'How long does a case take?'),
      takeaway: tr('地方法院終結案件平均所需天數。家事事件因常需調解、訪視，花的時間最久。', 'Average days to close a case in the district courts. Family cases take longest because they often involve mediation and home visits.'),
      source: sourceOf(22, 32, 38), cats: yearCats(38), unit: '天', digits: 1, catHead: tr('年度', 'Year'), height: 'mid',
      ser: [
        { name: tr('家事', 'Family'), data: annual(32, '終結事件平均一件所需日數') },
        { name: tr('刑事', 'Criminal'), data: annual(38, '終結事件平均一件所需日數') },
        { name: tr('民事', 'Civil'), data: annual(22, '終結事件平均一件所需日數') },
      ],
    });

    const p56 = lastSnapshot(56);
    const s56 = tbl(56).months[p56];
    const buckets = Object.keys(s56).filter((k) => k !== '合計');
    const civ = buckets.map((b) => s56[b]['地方法院未結案件/民事']);
    const cri = buckets.map((b) => s56[b]['地方法院未結案件/刑事']);
    const totAll = s56['合計']['地方法院未結案件/合計'];
    const within6 = sum(buckets.slice(0, 3).map((b) => s56[b]['地方法院未結案件/合計']));
    const over1y = sum(buckets.slice(5).map((b) => s56[b]['地方法院未結案件/合計']));
    barChart('c-court-pending', {
      title: tr(`還沒審完的案件已經等了多久？（${per(p56)}底）`, `How long have pending cases been waiting? (end of ${per(p56)})`),
      takeaway: tr(`地方法院未結案件共 ${fmt(totAll)} 件，${fmt(pct(within6, totAll), 0)}% 收案未滿半年；超過一年的有 ${fmt(over1y)} 件（${fmt(pct(over1y, totAll), 1)}%）。`,
        `District courts have ${fmt(totAll)} pending cases; ${fmt(pct(within6, totAll), 0)}% were filed less than six months ago, and ${fmt(over1y)} (${fmt(pct(over1y, totAll), 1)}%) have been pending for over a year.`),
      source: sourceOf(56), cats: buckets.map((b) => lb(b.replace('以上未滿', '～'))), catHead: tr('已經過時間', 'Time pending'),
      ser: [{ name: tr('民事', 'Civil'), data: civ }, { name: tr('刑事', 'Criminal'), data: cri }], stack: true, horizontal: true, height: 'mid',
    });

    const trend = (id, t, name, takeawayFn) => {
      const d = annual(t, '受理件數/新收');
      lineChart(id, {
        title: tr(`${name}新收件數`, `${name}: new cases`), takeaway: takeawayFn(d), source: sourceOf(t), cats: yearCats(t),
        ser: [{ name: tr('新收', 'New'), data: d }], area: true, catHead: tr('年度', 'Year'), height: 'short',
      });
    };
    const chg = (d) => tr(`${annualYears(22)[0]}→${annualYears(22).slice(-1)[0]}年：${d[d.length - 1] >= d[0] ? '增加' : '減少'} ${fmt(Math.abs(pct(d[d.length - 1] - d[0], d[0])), 0)}%`,
      `${ad(annualYears(22)[0])}→${ad(annualYears(22).slice(-1)[0])}: ${d[d.length - 1] >= d[0] ? 'up' : 'down'} ${fmt(Math.abs(pct(d[d.length - 1] - d[0], d[0])), 0)}%`);
    trend('c-trend-civil', 22, tr('地方法院民事', 'District court civil'), chg);
    trend('c-trend-criminal', 38, tr('地方法院刑事', 'District court criminal'), chg);
    trend('c-trend-family', 32, tr('地方法院家事', 'District court family'), chg);
  }

  // ---------- 各級法院 ----------
  const CASES = tr('件數', 'Cases'), PEOPLE = tr('人數', 'People');
  function renderLevels() {
    document.getElementById('ladderPeriod').textContent = ytdLabel;
    const n = (t, col = '受理件數/新收') => ytd(t, col);
    // 法院卡片：名稱＋各類案件件數（數字靠右對齊）；note 為補充說明
    const box = (name, lines, cls = '', note = '') => `
      <div class="rung ${cls}">
        <strong>${name}</strong>${note ? `<small>${note}</small>` : ''}
        <dl>${lines.map(([k, v]) => `<div><dt>${k}</dt><dd>${fmt(v)}<span>${tr('件', '')}</span></dd></div>`).join('')}</dl>
      </div>`;
    const CIV = tr('民事', 'Civil'), CRI = tr('刑事', 'Criminal'), ADM = tr('行政訴訟', 'Administrative');
    const tier = (cls, name, role) => `<div class="lvl-label ${cls}"><b>${name}</b><span>${role}</span></div>`;
    document.getElementById('ladder').innerHTML = `
      <div class="col-head h-general">${tr('普通法院', 'Ordinary courts')}<span>${tr('民事、刑事、家事', 'Civil, criminal, family')}</span></div>
      <div class="col-head h-admin">${tr('行政法院', 'Administrative courts')}<span>${tr('人民告政府', 'Suits against the government')}</span></div>
      ${tier('t3', tr('第三審', 'Third instance'), tr('終審', 'Final appeal'))}
      ${box(tr('最高法院', 'Supreme Court'), [[CIV, n(5)], [CRI, n(7)]], 'c-sup')}
      ${box(tr('最高行政法院', 'Supreme Administrative Court'), [[ADM, n(9)]], 'c-supadm')}
      ${tier('t2', tr('第二審', 'Second instance'), tr('上訴審', 'Appeals'))}
      ${box(tr('高等法院及分院', 'High Court and branches'), [[CIV, n(18)], [CRI, n(20)]], 'c-high')}
      ${box(tr('高等行政法院', 'High Administrative Courts'), [[ADM, n(11)]], 'c-highadm', tr('件數含院內地方行政訴訟庭', 'Includes their district-level divisions'))}
      ${tier('t1', tr('第一審', 'First instance'), tr('起訴、聲請', 'Trials and petitions'))}
      ${box(tr('地方法院', 'District courts'), [[CIV, n(22)], [CRI, n(38)], [tr('家事', 'Family'), n(32)]], 'c-dist', tr('22 所地方法院及高雄少年及家事法院', '22 district courts plus the Kaohsiung Juvenile and Family Court'))}
      <div class="rung c-admlocal"><strong>${tr('地方行政訴訟庭', 'District-level administrative divisions')}</strong><small>${tr('設在高等行政法院內，審理行政訴訟第一審；件數併入上方高等行政法院', 'Housed in the High Administrative Courts and hear administrative cases at first instance; their figures are included above')}</small></div>
      <div class="ladder-divider"></div>
      ${tier('ts', tr('專業法院', 'Specialized courts'), tr('專門審理特定案件', 'Dedicated jurisdictions'))}
      <div class="rung-row">
        ${box(tr('憲法法庭', 'Constitutional Court'), [[tr('憲法案件', 'Constitutional cases'), n(3)]])}
        ${box(tr('懲戒法院', 'Disciplinary Court'), [[tr('懲戒、職務案件', 'Disciplinary cases'), n(13)]])}
        ${box(tr('智慧財產及商業法院', 'IP and Commercial Court'), [[tr('民刑事、行政', 'Civil, criminal, admin.'), n(16)]])}
      </div>`;

    lineChart('c-lv-uphold', {
      title: tr('上訴到最高審級，多半被駁回', 'Most appeals to the highest courts are rejected'),
      takeaway: tr(`終審法院判決中「駁回上訴」（維持下級法院判決）所占比例。${annualYears(8).slice(-1)[0]}年刑事約 ${fmt(annual(8, '駁回上訴占駁回上訴與撤銷原判百分比').slice(-1)[0], 0)}%、民事約 ${fmt(annual(6, '駁回上訴占駁回上訴與廢棄原判百分比').slice(-1)[0], 0)}% 的上訴被駁回。`,
        `Share of final-instance rulings that dismiss the appeal (upholding the lower court). In ${ad(annualYears(8).slice(-1)[0])}, about ${fmt(annual(8, '駁回上訴占駁回上訴與撤銷原判百分比').slice(-1)[0], 0)}% of criminal and ${fmt(annual(6, '駁回上訴占駁回上訴與廢棄原判百分比').slice(-1)[0], 0)}% of civil appeals were dismissed.`),
      source: sourceOf(6, 8, 10), cats: yearCats(6), catHead: tr('年度', 'Year'), unit: '%', digits: 1, yMin: 50,
      ser: [
        { name: tr('最高法院刑事', 'Supreme Court, criminal'), data: annual(8, '駁回上訴占駁回上訴與撤銷原判百分比') },
        { name: tr('最高行政法院', 'Supreme Administrative Court'), data: annual(10, '駁回上訴占駁回上訴與廢棄原判百分比') },
        { name: tr('最高法院民事', 'Supreme Court, civil'), data: annual(6, '駁回上訴占駁回上訴與廢棄原判百分比') },
      ],
    });
    const sd = annual(5, '終結事件平均一件所需日數/收案至結案');
    const peak = Math.max(...sd), peakY = annualYears(5)[sd.indexOf(peak)];
    lineChart('c-lv-days', {
      title: tr('高等法院、最高法院平均審理天數', 'Average days per case: High Court and Supreme Court'),
      takeaway: tr(`從收案到結案的平均天數。最高法院民事事件從${peakY}年的 ${fmt(peak, 0)} 天降到${annualYears(5).slice(-1)[0]}年的 ${fmt(sd[sd.length - 1], 0)} 天。`,
        `Average days from filing to closing. Civil cases at the Supreme Court fell from ${fmt(peak, 0)} days in ${ad(peakY)} to ${fmt(sd[sd.length - 1], 0)} days in ${ad(annualYears(5).slice(-1)[0])}.`),
      source: sourceOf(5, 7, 18, 20), cats: yearCats(18), catHead: tr('年度', 'Year'), unit: '天', digits: 1,
      ser: [
        { name: tr('高院民事', 'High Court, civil'), data: annual(18, '終結事件平均一件所需日數') },
        { name: tr('高院刑事', 'High Court, criminal'), data: annual(20, '終結事件平均一件所需日數') },
        { name: tr('最高民事', 'Supreme Court, civil'), data: sd },
        { name: tr('最高刑事', 'Supreme Court, criminal'), data: annual(7, '終結案件平均一件所需日數/收案至結案') },
      ],
    });
    const hc = annual(18, '受理件數/新收'), hk = annual(20, '受理件數/新收');
    lineChart('c-lv-high', {
      title: tr('高等法院及分院：每年新收件數', 'High Court and branches: new cases per year'),
      takeaway: tr(`第二審以刑事案件為主，${annualYears(20).slice(-1)[0]}年刑事新收 ${fmt(hk[hk.length - 1])} 件，約是民事的 ${fmt(hk[hk.length - 1] / hc[hc.length - 1], 1)} 倍。`,
        `The second instance is mostly criminal: ${fmt(hk[hk.length - 1])} new criminal cases in ${ad(annualYears(20).slice(-1)[0])}, about ${fmt(hk[hk.length - 1] / hc[hc.length - 1], 1)} times the civil caseload.`),
      source: sourceOf(18, 20), cats: yearCats(18), catHead: tr('年度', 'Year'),
      ser: [{ name: tr('刑事', 'Criminal'), data: hk, color: series(2) }, { name: tr('民事', 'Civil'), data: hc, color: series(1) }],
    });
    lineChart('c-lv-supreme', {
      title: tr('最高法院、最高行政法院：每年新收件數', 'Supreme Court and Supreme Administrative Court: new cases per year'),
      takeaway: tr('第三審只審查下級法院判決有沒有違背法令，不再重新調查事實。', 'The third instance only reviews whether lower-court rulings applied the law correctly; it doesn’t re-examine the facts.'),
      source: sourceOf(5, 7, 9), cats: yearCats(5), catHead: tr('年度', 'Year'),
      ser: [
        { name: tr('最高法院刑事', 'Supreme Court, criminal'), data: annual(7, '受理件數/新收'), color: series(2) },
        { name: tr('最高法院民事', 'Supreme Court, civil'), data: annual(5, '受理件數/新收'), color: series(1) },
        { name: tr('最高行政法院', 'Supreme Administrative Court'), data: annual(9, '受理件數/新收'), color: series(3) },
      ],
    });

    // 行政訴訟第一審結果
    const v = (c) => ytd(12, c) || 0;
    const mixed = v('勝敗互見/部分無理由部分有理由') + v('勝敗互見/部分不合法部分有理由');
    const ar = [
      [tr('原告勝訴', 'Plaintiff won'), v('勝訴')], [tr('勝敗互見', 'Partly won'), mixed], [tr('原告敗訴', 'Plaintiff lost'), v('敗訴')], [tr('裁定駁回', 'Dismissed by ruling'), v('裁定駁回')],
      [tr('撤回', 'Withdrawn'), v('撤回')], [tr('移送管轄', 'Transferred'), v('移送管轄')], [tr('和解／調解成立', 'Settled'), v('和解/件數') + v('調解成立/件數')], [tr('其他', 'Other'), v('其他') + v('情況判決')],
    ];
    const judged = v('勝訴') + mixed + v('敗訴') + v('情況判決');
    barChart('c-lv-admin-result', {
      title: tr(`人民告政府，結果如何？（行政訴訟第一審，${ytdLabel}）`, `Suing the government: how did it turn out? (first instance, ${ytdLabel})`),
      takeaway: tr(`有判決結果的案件中，原告（人民）全部或部分勝訴約占 ${fmt(pct(v('勝訴') + mixed, judged), 0)}%。另有不少案件因不合法被裁定駁回，或由原告自行撤回。`,
        `Among cases decided by judgment, plaintiffs won in full or in part about ${fmt(pct(v('勝訴') + mixed, judged), 0)}% of the time. Many other cases were dismissed as procedurally improper or withdrawn.`),
      source: sourceOf(12), cats: ar.map((x) => x[0]), ser: [{ name: CASES, data: ar.map((x) => x[1]) }],
      horizontal: true, catHead: tr('終結情形', 'Outcome'),
    });
    lineChart('c-lv-admin-trend', {
      title: tr('行政法院每年新收件數', 'Administrative courts: new cases per year'),
      takeaway: tr('112年8月行政訴訟新制上路，原本設在地方法院的行政訴訟庭改設在高等行政法院（地方行政訴訟庭），所以高等行政法院件數明顯增加。',
        'Under reforms effective August 2023, administrative divisions moved from the district courts into the High Administrative Courts, so their caseloads rose sharply.'),
      source: sourceOf(9, 11), cats: yearCats(11), catHead: tr('年度', 'Year'),
      ser: [{ name: tr('高等行政法院', 'High Administrative Courts'), data: annual(11, '受理件數/新收') }, { name: tr('最高行政法院', 'Supreme Administrative Court'), data: annual(9, '受理件數/新收'), color: series(3) }],
    });

    barChart('c-lv-const', {
      title: tr('憲法法庭：每年新收與終結', 'Constitutional Court: new and closed cases per year'),
      takeaway: tr('111年1月《憲法訴訟法》施行，人民可以對確定判決聲請「裁判憲法審查」，當年新收案件暴增。',
        'The Constitutional Court Procedure Act took effect in January 2022, letting people challenge final court rulings on constitutional grounds; new cases surged that year.'),
      source: sourceOf(3), cats: yearCats(3), catHead: tr('年度', 'Year'),
      ser: [{ name: tr('新收', 'New'), data: annual(3, '受理件數/新收') }, { name: tr('終結', 'Closed'), data: annual(3, '終結件數/計') }],
    });
    const d14 = (c) => ytd(14, '終結情形/' + c) || 0;
    const disc = [
      [tr('撤職／免除職務', 'Dismissal'), d14('受懲戒/撤職') + d14('受懲戒/免除職務')], [tr('休職', 'Suspension'), d14('受懲戒/休職')], [tr('降級', 'Demotion'), d14('受懲戒/降級')],
      [tr('減俸／罰款', 'Pay cut / fine'), d14('受懲戒/減俸') + d14('受懲戒/罰款')], [tr('記過／申誡', 'Demerit / reprimand'), d14('受懲戒/記過') + d14('受懲戒/申誡')],
      [tr('剝奪、減少退休金', 'Pension cut or stripped'), d14('受懲戒/剝奪、減少退休(職、伍)金') + d14('受懲戒/奪、減少退休(職、伍)金')],
      [tr('不受懲戒', 'Not disciplined'), d14('不受懲戒')], [tr('免議／不受理', 'Dismissed'), d14('免議及不受理')], [tr('其他', 'Other'), d14('其他')],
    ];
    barChart('c-lv-discipline', {
      title: tr(`公務員懲戒結果（${ytdLabel}）`, `Civil servant discipline outcomes (${ytdLabel})`),
      takeaway: tr('懲戒法院審理公務員違法失職案件，由監察院彈劾或機關首長移送。', 'The Disciplinary Court hears misconduct cases against civil servants, referred by the Control Yuan or agency heads.'),
      source: sourceOf(14), cats: disc.map((x) => x[0]), ser: [{ name: CASES, data: disc.map((x) => x[1]) }],
      horizontal: true, catHead: tr('終結情形', 'Outcome'),
    });
    lineChart('c-lv-ip', {
      title: tr('智慧財產及商業法院：每年新收件數', 'IP and Commercial Court: new cases per year'),
      takeaway: tr('審理專利、商標、著作權、營業秘密等案件；112年起另設商業法庭，處理重大商業紛爭。',
        'Hears patent, trademark, copyright and trade-secret cases; since 2023 a commercial division has also handled major business disputes.'),
      source: sourceOf(16), cats: yearCats(16), catHead: tr('年度', 'Year'),
      ser: [{ name: tr('新收', 'New'), data: annual(16, '受理件數/新收') }], area: true,
    });
  }

  // ---------- 刑事犯罪 ----------
  const ALL_OFF = tr('全部罪名', 'All offenses');
  const CRIME_EXCLUDE = new Set(['合計', '普通刑法計', '特別刑事法令計', '其他', '併案裁判']);
  const crimeName = (c) => EN ? lb(c.replace(/^殺人罪\//, '')) : c.replace(/^殺人罪\//, '').replace(/^違反/, '').replace('毒品危害防制條例', '毒品條例').replace('槍砲彈藥刀械管制條例', '槍砲條例').replace('詐欺犯罪危害防制條例', '詐欺犯罪防制條例');

  function renderCrime() {
    const t41 = tbl(41);
    const crimes = t41.columns.filter((c) => !CRIME_EXCLUDE.has(c));
    const top = crimes.map((c) => ({ c, v: ytd(41, c) })).sort((a, b) => b.v - a.v).slice(0, 10);
    const totalY = ytd(41, '合計');

    const p55 = lastSnapshot(55);
    const prob = tbl(55).months[p55]['地方法院合計'];
    tiles('crimeTiles', [
      { label: tr(`第一審終結案件（${ytdLabel}）`, `Cases closed at first instance (${ytdLabel})`), value: totalY, unit: '件', delta: yoy(41, '合計') },
      { label: tr(`科刑人數（${ytdLabel}）`, `People sentenced (${ytdLabel})`), value: ytd(43, '合計'), unit: '人', delta: yoy(43, '合計') },
      { label: tr('詐欺＋洗錢案件占比', 'Fraud + money laundering share'), value: fmt(pct(ytd(41, '詐欺罪') + ytd(41, '違反洗錢防制法'), totalY), 1), raw: true, unit: '%', note: tr('詐欺集團案件常同時涉及兩者', 'Fraud ring cases often involve both') },
      { label: tr(`地院緩刑率（${per(p55)}）`, `Suspended sentence rate (${per(p55)})`), value: fmt(prob['合計/緩刑率'], 1), raw: true, unit: '%', note: tr('符合緩刑條件的被告中，獲宣告緩刑的比例', 'Share of eligible defendants given a suspended sentence') },
    ]);

    // 裁判結果（表42，單月）的選單
    const cSel = document.getElementById('fVerdictCrime');
    const mSel = document.getElementById('fVerdictMonth');
    fillMonthSelect(mSel, 42, mSel.value);
    const snap0 = tbl(42).months[lastSnapshot(42)];
    const rowsAll = Object.keys(snap0).filter((k) => !['男', '女', '其他'].includes(k));
    const popular = ['合計', '詐欺罪', '違反洗錢防制法', '公共危險罪', '竊盜罪', '傷害罪', '違反毒品危害防制條例'];
    const ordered = popular.filter((p) => rowsAll.includes(p)).concat(rowsAll.filter((r) => !popular.includes(r)));
    cSel.innerHTML = ordered.map((r) => `<option value="${r}">${r === '合計' ? ALL_OFF : crimeName(r)}</option>`).join('');
    cSel.onchange = () => { crimeSel = fromT42(cSel.value); drawCrimeLinked(); };
    mSel.onchange = () => drawCrimeLinked();
    crimeCtx = { top, totalY, crimes };
    drawCrimeLinked();
  }

  // 表41（罪名別件數）與表42（裁判結果）罪名寫法不同的對照
  const T41_TO_T42 = { '殺人罪/殺人': '殺人', '殺人罪/過失致死': '過失致死', '偽造有價證卷罪': '偽造有價證券罪', '藏匿犯人及湮滅證據罪': '藏匿人犯及湮滅證據罪', '違反公權人員選舉罷免法': '違反公職人員選舉罷免法' };
  const toT42 = (c) => (c ? T41_TO_T42[c] || c : '合計');
  const fromT42 = (r) => (r === '合計' ? null : (Object.keys(T41_TO_T42).find((k) => T41_TO_T42[k] === r) || r));
  let crimeSel = null;   // 目前選取的罪名（表41欄名），null 表示全部
  let crimeCtx = null;
  const CRIME_FOCUS = ['詐欺罪', '違反洗錢防制法', '公共危險罪', '竊盜罪', '違反毒品危害防制條例'];

  function drawCrimeLinked() {
    const { top, totalY, crimes } = crimeCtx;
    const selName = crimeSel ? crimeName(crimeSel) : null;
    const pick = (name) => { const c = crimes.find((x) => crimeName(x) === name); crimeSel = crimeSel === c ? null : c; drawCrimeLinked(); };

    barChart('c-crime-top', {
      title: tr(`終結案件最多的十種罪名（${ytdLabel}）`, `Top 10 offenses by cases closed (${ytdLabel})`),
      takeaway: selName && top.some((x) => x.c === crimeSel)
        ? tr(`${selName}：${fmt(ytd(41, crimeSel))} 件，占全部第一審終結案件的 ${fmt(pct(ytd(41, crimeSel), totalY), 1)}%，較去年同期${yoy(41, crimeSel) >= 0 ? '增加' : '減少'} ${fmt(Math.abs(yoy(41, crimeSel)), 1)}%。`,
          `${selName}: ${fmt(ytd(41, crimeSel))} cases, ${fmt(pct(ytd(41, crimeSel), totalY), 1)}% of all first-instance closures, ${yoy(41, crimeSel) >= 0 ? 'up' : 'down'} ${fmt(Math.abs(yoy(41, crimeSel)), 1)}% from the same period last year.`)
        : tr(`${crimeName(top[0].c)}最多，占全部第一審終結案件的 ${fmt(pct(top[0].v, totalY), 0)}%。「公共危險罪」大多是酒駕。`,
          `${crimeName(top[0].c)} is the most common, at ${fmt(pct(top[0].v, totalY), 0)}% of all first-instance closures. “Public endangerment” is mostly drunk driving.`),
      hint: tr('點選罪名，右邊趨勢和下方的裁判結果會換成這個罪名；再點一次取消。', 'Click an offense to update the trend and sentencing charts; click again to clear.'),
      source: sourceOf(41), cats: top.map((x) => crimeName(x.c)), ser: [{ name: tr('終結件數', 'Cases closed'), data: top.map((x) => x.v) }],
      horizontal: true, height: 'tall', catHead: tr('罪名', 'Offense'),
      selected: selName, onSelect: pick,
    });

    const cols = CRIME_FOCUS.concat(crimeSel && !CRIME_FOCUS.includes(crimeSel) ? [crimeSel] : []);
    const fraud = annual(41, '詐欺罪');
    const sd = crimeSel ? annual(41, crimeSel) : null;
    lineChart('c-crime-trend', {
      title: tr('主要罪名十年趨勢（第一審終結件數）', 'Major offenses over ten years (cases closed at first instance)'),
      takeaway: crimeSel
        ? tr(`${selName}從 ${annualYears(41)[0]}年的 ${fmt(sd[0])} 件，變成 ${annualYears(41).slice(-1)[0]}年的 ${fmt(sd[sd.length - 1])} 件。`,
          `${selName}: from ${fmt(sd[0])} cases in ${ad(annualYears(41)[0])} to ${fmt(sd[sd.length - 1])} in ${ad(annualYears(41).slice(-1)[0])}.`)
        : tr(`詐欺案件從 ${annualYears(41)[0]}年的 ${fmt(fraud[0])} 件增加到 ${annualYears(41).slice(-1)[0]}年的 ${fmt(fraud[fraud.length - 1])} 件，已超越公共危險罪（多為酒駕）；毒品案件則比十年前少了一半以上。`,
          `Fraud cases rose from ${fmt(fraud[0])} in ${ad(annualYears(41)[0])} to ${fmt(fraud[fraud.length - 1])} in ${ad(annualYears(41).slice(-1)[0])}, overtaking public endangerment (mostly drunk driving); drug cases have fallen by more than half over the decade.`),
      hint: tr('點選線條也能選取罪名。', 'You can also click a line to select an offense.'),
      source: sourceOf(41), cats: yearCats(41), catHead: tr('年度', 'Year'), height: 'tall',
      ser: cols.map((c) => ({ name: crimeName(c), data: annual(41, c) })),
      focusName: selName, onSelectSeries: pick,
    });

    const cSel = document.getElementById('fVerdictCrime');
    const want = toT42(crimeSel);
    const has = [...cSel.options].some((o) => o.value === want);
    cSel.value = has ? want : '合計';
    renderVerdict(cSel.value, document.getElementById('fVerdictMonth').value, crimeSel && !has ? selName : null);
  }

  function renderVerdict(crime, month, missingName) {
    const snap = tbl(42).months[month];
    const r = snap[crime] || {};
    const label = periodOf(42, month);
    const name = crime === '合計' ? ALL_OFF : crimeName(crime);
    const parts = [
      [tr('有期徒刑', 'Prison term'), r['科刑/有期徒刑/小計']], [tr('拘役', 'Short detention'), r['科刑/拘役']], [tr('罰金', 'Fine'), r['科刑/罰金']],
      [tr('無期徒刑／死刑', 'Life / death'), (r['科刑/無期徒刑'] || 0) + (r['科刑/死刑'] || 0)],
      [tr('無罪', 'Acquitted'), r['無罪']], [tr('免除其刑', 'Penalty waived'), r['免除其刑']], [tr('其他（不受理、免訴等）', 'Other (dismissed, etc.)'), r['其他']],
    ];
    const total = r['被告人數'] || 0;
    barChart('c-verdict', {
      title: tr(`被告最後被判了什麼？（${name}，${label}）`, `What sentences did defendants receive? (${name}, ${label})`),
      takeaway: missingName ? tr(`裁判結果表沒有「${missingName}」的分項，先顯示全部罪名。`, `The sentencing table has no breakdown for “${missingName}”; showing all offenses.`)
        : total ? tr(`共 ${fmt(total)} 名被告，${fmt(pct(r['科刑/計'], total), 0)}% 被判有罪科刑，${fmt(pct(r['無罪'], total), 1)}% 無罪。`,
          `${fmt(total)} defendants: ${fmt(pct(r['科刑/計'], total), 0)}% were convicted and sentenced, ${fmt(pct(r['無罪'], total), 1)}% acquitted.`)
        : tr('這個月沒有此罪名的終結案件。', 'No closed cases for this offense this month.'),
      source: sourceOf(42), cats: parts.map((p) => p[0]), ser: [{ name: PEOPLE, data: parts.map((p) => p[1] || 0) }],
      horizontal: true, catHead: tr('裁判結果', 'Outcome'),
    });
    const prison = [
      [tr('一年以下', '≤ 1 year'), r['科刑/有期徒刑/一年以下']], [tr('逾1年至5年', '1–5 years'), r['科刑/有期徒刑/逾一年至五年以下']],
      [tr('逾5年至10年', '5–10 years'), r['科刑/有期徒刑/逾五年至十年以下']], [tr('逾10年', '> 10 years'), r['科刑/有期徒刑/逾十年']],
    ];
    const ps = r['科刑/有期徒刑/小計'] || 0;
    barChart('c-prison', {
      title: tr(`判有期徒刑的刑期分布（${name}）`, `Length of prison terms (${name})`),
      takeaway: ps ? tr(`有期徒刑 ${fmt(ps)} 人中，${fmt(pct(prison[0][1], ps), 0)}% 刑期在一年以下。`, `Of ${fmt(ps)} people sentenced to prison, ${fmt(pct(prison[0][1], ps), 0)}% received one year or less.`)
        : tr('這個月沒有判處有期徒刑的被告。', 'No prison sentences this month.'),
      source: sourceOf(42), cats: prison.map((p) => p[0]), ser: [{ name: PEOPLE, data: prison.map((p) => p[1] || 0) }],
      catHead: tr('刑期', 'Sentence'), colors: [css('--seq-1'), css('--seq-2'), css('--seq-4'), css('--seq-5')],
    });
    // 緩刑率依法院
    const p55 = lastSnapshot(55);
    const s55 = tbl(55).months[p55];
    const rows = Object.entries(s55).filter(([n]) => isDistrictCourt(n)).map(([n, v]) => ({ n: shortCourt(n), v: v['合計/緩刑率'] })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
    barChart('c-probation', {
      title: tr(`各地方法院緩刑率（${per(p55)}）`, `Suspended sentence rate by district court (${per(p55)})`),
      takeaway: tr(`宣告刑符合緩刑條件（通常是 2 年以下有期徒刑等）的被告中，法官宣告緩刑的比例。全體地方法院為 ${fmt(s55['地方法院合計']['合計/緩刑率'], 1)}%。單月人數少的法院，比例波動會比較大。`,
        `Among defendants eligible for a suspended sentence (usually a prison term of 2 years or less), the share granted one. All district courts: ${fmt(s55['地方法院合計']['合計/緩刑率'], 1)}%. Courts with few cases in a month can swing widely.`),
      source: sourceOf(55), cats: rows.map((x) => x.n), ser: [{ name: tr('緩刑率', 'Suspension rate'), data: rows.map((x) => x.v) }],
      digits: 1, unit: '%', catHead: tr('法院', 'Court'), horizontal: true, height: 'tall',
    });
  }

  // ---------- 保護令與卡債 ----------
  function renderLife() {
    // 家暴保護令
    const iss = ytd(35, '終結件數/核發'), rej = ytd(35, '終結件數/駁回');
    tiles('dvTiles', [
      { label: tr(`家暴保護令新收（${ytdLabel}）`, `DV protection order petitions (${ytdLabel})`), value: ytd(35, '受理件數/新收'), unit: '件', delta: yoy(35, '受理件數/新收') },
      { label: tr('核發件數', 'Orders issued'), value: iss, unit: '件', delta: yoy(35, '終結件數/核發') },
      { label: tr('核發率', 'Issuance rate'), value: fmt(pct(iss, iss + rej), 1), raw: true, unit: '%', note: tr('核發件數 ÷（核發＋駁回）', 'Issued ÷ (issued + denied)') },
      { label: tr(`跟蹤騷擾保護令新收（${ytdLabel}）`, `Stalking protection order petitions (${ytdLabel})`), value: ytd(30, '受理件數/新收'), unit: '件', delta: yoy(30, '受理件數/新收') },
    ]);

    lineChart('c-dv-trend', {
      title: tr('家暴保護令：每年聲請與核發件數', 'DV protection orders: petitions and orders issued per year'),
      takeaway: tr('保護令可以禁止加害人施暴、騷擾，或命令遷出、遠離被害人住所。', 'Protection orders can bar abusers from violence or harassment, or order them to move out or stay away from the victim’s home.'),
      source: sourceOf(35), cats: yearCats(35), catHead: tr('年度', 'Year'),
      ser: [{ name: tr('聲請', 'Petitions'), data: annual(35, '受理件數/新收') }, { name: tr('核發', 'Issued'), data: annual(35, '終結件數/核發') }],
    });

    const pfx = '終結事件中准許核發保護令內容（項）/';
    const items = tbl(35).columns.filter((c) => c.startsWith(pfx)).map((c) => ({ n: c.slice(pfx.length), v: ytd(35, c) })).sort((a, b) => b.v - a.v);
    const topItems = items.slice(0, 6);
    const otherV = sum(items.slice(6).map((x) => x.v));
    const nm = (s) => s.replace('強制加害人完成處遇計畫', '加害人完成處遇計畫').replace('與未成年子女會面交往之方式或禁止會面交往', '子女會面交往').replace('未成年子女權利義務行使、負擔及交付子女', '子女親權').replace(/其他必要之.*護令/, '其他必要措施');
    barChart('c-dv-content', {
      title: tr(`保護令內容最常見的是什麼？（${ytdLabel}，項）`, `Most common protection order provisions (${ytdLabel})`),
      takeaway: tr('一張保護令可以同時包含好幾項內容，最常見的是「禁止實施家庭暴力」和「禁止騷擾」。', 'One order can contain several provisions; the most common are “no domestic violence” and “no harassment”.'),
      source: sourceOf(35), cats: topItems.map((x) => lb(nm(x.n))).concat([tr('其他', 'Other')]), ser: [{ name: tr('項數', 'Provisions'), data: topItems.map((x) => x.v).concat([otherV]) }],
      horizontal: true, catHead: tr('保護令內容', 'Provision'),
    });

    // 跟騷
    const sYears = annualYears(30).filter((y) => tbl(30).annual[y]['受理件數/合計'] > 0);
    const sCats = sYears.map(yr).concat([monthRange(1, LM, LY)]);
    const sNew = sYears.map((y) => tbl(30).annual[y]['受理件數/新收']).concat([ytd(30, '受理件數/新收')]);
    const sIss = sYears.map((y) => tbl(30).annual[y]['終結件數/核發']).concat([ytd(30, '終結件數/核發')]);
    const sRej = sYears.map((y) => tbl(30).annual[y]['終結件數/駁回']).concat([ytd(30, '終結件數/駁回')]);
    barChart('c-stalk-trend', {
      title: tr('跟蹤騷擾保護令：聲請與結果', 'Stalking protection orders: petitions and outcomes'),
      takeaway: tr(`《跟蹤騷擾防制法》111年6月施行，所以111年只有約半年資料。${LY}年1–${LM}月核發率為 ${fmt(pct(ytd(30, '終結件數/核發'), ytd(30, '終結件數/核發') + ytd(30, '終結件數/駁回')), 0)}%（核發 ÷ 核發＋駁回）。`,
        `The Stalking and Harassment Prevention Act took effect in June 2022, so 2022 covers only about half a year. In ${monthRange(1, LM, LY)}, the issuance rate was ${fmt(pct(ytd(30, '終結件數/核發'), ytd(30, '終結件數/核發') + ytd(30, '終結件數/駁回')), 0)}% (issued ÷ issued + denied).`),
      source: sourceOf(30), cats: sCats, catHead: tr('期間', 'Period'),
      ser: [{ name: tr('新收（聲請）', 'New petitions'), data: sNew }, { name: tr('核發', 'Issued'), data: sIss }, { name: tr('駁回', 'Denied'), data: sRej }],
    });
    const apfx = '終結事件聲請人別/';
    const apps = tbl(30).columns.filter((c) => c.startsWith(apfx) && !c.endsWith('/計')).map((c) => ({ n: c.slice(apfx.length), v: ytd(30, c) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    const appTot = ytd(30, '終結事件聲請人別/計');
    barChart('c-stalk-applicant', {
      title: tr(`誰來聲請跟騷保護令？（${ytdLabel}）`, `Who petitions for stalking protection orders? (${ytdLabel})`),
      takeaway: tr(`${fmt(pct(apps[0]?.v, appTot), 0)}% 由${apps[0]?.n}本人聲請，其次是${apps[1]?.n || '—'}。`,
        `${fmt(pct(apps[0]?.v, appTot), 0)}% were filed by the ${lb(apps[0]?.n || '').toLowerCase()}, followed by ${apps[1] ? lb(apps[1].n).toLowerCase() : '—'}.`),
      source: sourceOf(30), cats: apps.map((x) => lb(x.n.replace('三親等以內血親或姻親', '三親等內親屬'))), ser: [{ name: CASES, data: apps.map((x) => x.v) }],
      horizontal: true, catHead: tr('聲請人', 'Petitioner'),
    });

    // 消債
    const dYears = annualYears(27);
    lineChart('c-debt-trend', {
      title: tr('卡債族向法院求助：消費者債務清理新收件數（每月）', 'Debtors turning to the courts: new consumer debt cases (monthly)'),
      takeaway: tr(`${ytdLabel}共新收 ${fmt(ytd(27, '受理件數/新收'))} 件，較去年同期${yoy(27, '受理件數/新收') >= 0 ? '增加' : '減少'} ${fmt(Math.abs(yoy(27, '受理件數/新收')), 1)}%。年度新收：${dYears.map((y) => `${y}年 ${fmt(tbl(27).annual[y]['受理件數/新收'])} 件`).join('、')}。`,
        `${ytdLabel}: ${fmt(ytd(27, '受理件數/新收'))} new cases, ${yoy(27, '受理件數/新收') >= 0 ? 'up' : 'down'} ${fmt(Math.abs(yoy(27, '受理件數/新收')), 1)}% from the same period last year. Annual totals: ${dYears.map((y) => `${ad(y)}: ${fmt(tbl(27).annual[y]['受理件數/新收'])}`).join(', ')}.`),
      source: sourceOf(27), cats: monthCats(27), catHead: tr('月份', 'Month'),
      ser: [{ name: tr('新收件數', 'New cases'), data: monthly(27, '受理件數/新收') }], area: true,
    });
    const disc = annualYears(29);
    const dcats = disc.map(yr).concat([monthRange(1, LM, LY)]);
    const dYes = disc.map((y) => tbl(29).annual[y]['聲請免責(不免責)終結情形/債務人免責']).concat([ytd(29, '聲請免責(不免責)終結情形/債務人免責')]);
    const dNo = disc.map((y) => tbl(29).annual[y]['聲請免責(不免責)終結情形/債務人不免責']).concat([ytd(29, '聲請免責(不免責)終結情形/債務人不免責')]);
    const lastRate = pct(dYes[dYes.length - 1], dYes[dYes.length - 1] + dNo[dNo.length - 1]);
    barChart('c-debt-discharge', {
      title: tr('清算後債務能不能「免責」？', 'After liquidation, are debts discharged?'),
      takeaway: tr(`走完清算程序後，法院裁定債務人「免責」，剩下的債務就不用再還。${LY}年1–${LM}月免責比例約 ${fmt(lastRate, 0)}%；不免責最常見的原因是消債條例第133條（有固定收入但未清償到一定比例）。`,
        `If the court grants a discharge after liquidation, the remaining debt no longer has to be repaid. In ${monthRange(1, LM, LY)}, about ${fmt(lastRate, 0)}% of debtors were discharged; the most common reason for denial is Article 133 of the Consumer Debt Clearance Act (steady income but too little repaid).`),
      source: sourceOf(29), cats: dcats, catHead: tr('期間', 'Period'), stack: true,
      ser: [{ name: tr('免責', 'Discharged'), data: dYes }, { name: tr('不免責', 'Not discharged'), data: dNo }],
    });

    // 家事
    lineChart('c-family-trend', {
      title: tr('家事事件調解成立比例', 'Family cases: mediation success rate'),
      takeaway: tr('離婚、監護權、扶養費等家事紛爭，很多在法院調解就能解決，不必走到判決。比例為調解成立件數 ÷（成立＋不成立）件數。',
        'Many family disputes — divorce, custody, child support — are resolved through court mediation without a judgment. Rate = settled ÷ (settled + failed).'),
      source: sourceOf(32), cats: yearCats(32), catHead: tr('年度', 'Year'), unit: '%', digits: 1,
      ser: [{ name: tr('調解成立比例', 'Success rate'), data: annual(32, '調解成立百分比/百分比一') }],
    });
    const p34 = lastSnapshot(34);
    const s34 = tbl(34).months[p34]['合計'];
    const fam = Object.entries(s34).filter(([k]) => k !== '合計').map(([k, v]) => ({ n: k.split('/').pop(), v })).sort((a, b) => b.v - a.v);
    const famTop = fam.slice(0, 9);
    barChart('c-family-type', {
      title: tr(`家事法院處理哪些事？（${per(p34)}終結件數）`, `What do family courts handle? (cases closed, ${per(p34)})`),
      takeaway: tr('最多的是繼承相關事件（如拋棄繼承、限定繼承），其次是保護令與調解。', 'Inheritance matters (such as renouncing or limiting an inheritance) are the most common, followed by protection orders and mediation.'),
      source: sourceOf(34), cats: famTop.map((x) => lb(x.n)).concat([tr('其他', 'Other')]), ser: [{ name: CASES, data: famTop.map((x) => x.v).concat([sum(fam.slice(9).map((x) => x.v))]) }],
      horizontal: true, catHead: tr('事件類型', 'Case type'),
    });
  }

  // ---------- 少年與通訊監察 ----------
  const OTHER = tr('其他', 'Other');
  function renderYouth() {
    lineChart('c-youth-trend', {
      title: tr('少年及兒童保護事件：每年新收件數', 'Juvenile and child protection cases: new cases per year'),
      takeaway: tr('少年法庭先「調查」，必要時才「開始審理」並給予保護處分。', 'The juvenile court first investigates, and opens a hearing with protective measures only when needed.'),
      source: sourceOf(46, 47), cats: yearCats(46), catHead: tr('年度', 'Year'),
      ser: [{ name: tr('調查新收', 'New investigations'), data: annual(46, '受理件數/新收') }, { name: tr('審理新收', 'New hearings'), data: annual(47, '受理件數/新收') }],
    });
    const ip = '終結情形(人)/';
    const inv = [
      [tr('開始審理', 'Hearing opened'), ytd(46, ip + '開始審理')], [tr('不付審理', 'No hearing'), ytd(46, ip + '不付審理/小計')],
      [tr('移送（轉）管轄', 'Transferred'), ytd(46, ip + '移送(轉)管轄')], [tr('移送檢察署', 'Referred to prosecutors'), ytd(46, ip + '移送檢察廳')],
      [tr('其他（含協尋）', 'Other'), (ytd(46, ip + '其他') || 0) + (ytd(46, ip + '協尋') || 0)],
    ];
    const invTot = ytd(46, ip + '計');
    barChart('c-youth-type', {
      title: tr(`調查之後怎麼處理？（${ytdLabel}，人）`, `What happens after investigation? (${ytdLabel}, people)`),
      takeaway: tr(`${fmt(pct(inv[0][1], invTot), 0)}% 的少年進入審理；${fmt(pct(inv[1][1], invTot), 0)}% 因情節輕微等原因不付審理。移送檢察署的是較重大案件，改依刑事程序處理。`,
        `${fmt(pct(inv[0][1], invTot), 0)}% of juveniles went on to a hearing; ${fmt(pct(inv[1][1], invTot), 0)}% did not, often because the matter was minor. Serious cases are referred to prosecutors and handled under criminal procedure.`),
      source: sourceOf(46), cats: inv.map((x) => x[0]), ser: [{ name: PEOPLE, data: inv.map((x) => x[1] || 0) }],
      horizontal: true, catHead: tr('處理結果', 'Outcome'),
    });
    const dp = '終結情形(人)/';
    const disp = [
      [tr('訓誡', 'Reprimand'), ytd(47, dp + '交付保護處分/訓誡')], [tr('訓誡並予假日生活輔導', 'Reprimand + weekend guidance'), ytd(47, dp + '交付保護處分/訓誡/訓誡並予假日生活輔導')],
      [tr('保護管束', 'Probation'), ytd(47, dp + '交付保護處分/保護管束')], [tr('安置輔導', 'Residential placement'), ytd(47, dp + '交付保護處分/安置輔導')],
      [tr('感化教育', 'Reformatory education'), ytd(47, dp + '交付保護處分/感化教育')], [tr('不付保護處分', 'No protective measure'), ytd(47, dp + '不付保護處分')],
      [tr('移送檢察署', 'Referred to prosecutors'), ytd(47, dp + '移送檢察廳')], [OTHER, (ytd(47, dp + '其他') || 0) + (ytd(47, dp + '協尋') || 0) + (ytd(47, dp + '移送(轉)管轄') || 0)],
    ];
    disp.sort((a, b) => (a[0] === OTHER) - (b[0] === OTHER) || b[1] - a[1]);
    const dtot = ytd(47, dp + '計');
    barChart('c-youth-disposal', {
      title: tr(`少年審理後的處遇（${ytdLabel}，人）`, `Dispositions after a juvenile hearing (${ytdLabel}, people)`),
      takeaway: tr(`最常見的是保護管束（${fmt(pct(ytd(47, dp + '交付保護處分/保護管束'), dtot), 0)}%），須在少年保護官輔導下生活；送感化教育的約占 ${fmt(pct(ytd(47, dp + '交付保護處分/感化教育'), dtot), 0)}%。`,
        `Probation is the most common (${fmt(pct(ytd(47, dp + '交付保護處分/保護管束'), dtot), 0)}%), with the juvenile supervised by a probation officer; reformatory education accounts for about ${fmt(pct(ytd(47, dp + '交付保護處分/感化教育'), dtot), 0)}%.`),
      source: sourceOf(47), cats: disp.map((d) => d[0]), ser: [{ name: PEOPLE, data: disp.map((d) => d[1] || 0) }],
      horizontal: true, catHead: tr('處遇', 'Disposition'),
    });

    // 通訊監察
    const c = '檢察官聲請案件/';
    const ok = ytd(51, c + '核准/案件數'), no = ytd(51, c + '駁回/案件數'), part = ytd(51, c + '部分准駁/案件數');
    const rOk = ytd(52, '准許/案件數'), rNo = ytd(52, '駁回/案件數');
    tiles('wiretapTiles', [
      { label: tr(`通訊監察聲請（${ytdLabel}）`, `Wiretap applications (${ytdLabel})`), value: ytd(51, '合計/案件數'), unit: '件', delta: yoy(51, '合計/案件數') },
      { label: tr('通訊監察全部駁回比例', 'Wiretaps fully denied'), value: fmt(pct(no, ok + no + part), 1), raw: true, unit: '%', note: tr('法官全部駁回檢察官聲請的比例', 'Share of prosecutors’ applications rejected outright') },
      { label: tr(`通信調取聲請（${ytdLabel}）`, `Records requests (${ytdLabel})`), value: ytd(52, '合計/案件數'), unit: '件', delta: yoy(52, '合計/案件數') },
      { label: tr('通信調取駁回比例', 'Records requests denied'), value: fmt(pct(rNo, ytd(52, '合計/案件數')), 1), raw: true, unit: '%', note: tr('駁回件數 ÷ 聲請件數', 'Denied ÷ requested') },
    ]);
    barChart('c-wiretap', {
      title: tr('通訊監察（監聽）：檢察官聲請的審查結果', 'Wiretaps: court review of prosecutors’ applications'),
      takeaway: tr(`檢察官要監聽，必須先向法院聲請「通訊監察書」。聲請件數從${annualYears(51)[0]}年的 ${fmt(annual(51, '合計/案件數')[0])} 件降到${annualYears(51).slice(-1)[0]}年的 ${fmt(annual(51, '合計/案件數').slice(-1)[0])} 件。`,
        `Prosecutors need a court-issued warrant to wiretap. Applications fell from ${fmt(annual(51, '合計/案件數')[0])} in ${ad(annualYears(51)[0])} to ${fmt(annual(51, '合計/案件數').slice(-1)[0])} in ${ad(annualYears(51).slice(-1)[0])}.`),
      source: sourceOf(51), cats: yearCats(51), catHead: tr('年度', 'Year'), stack: true,
      ser: [{ name: tr('核准', 'Approved'), data: annual(51, c + '核准/案件數') }, { name: tr('部分准駁', 'Partly approved'), data: annual(51, c + '部分准駁/案件數') }, { name: tr('駁回', 'Denied'), data: annual(51, c + '駁回/案件數') }],
    });
    barChart('c-retrieve', {
      title: tr('通信調取（調通聯紀錄）：審查結果', 'Communication records (call logs): review results'),
      takeaway: tr('調取通話紀錄、上網紀錄等通信紀錄，也必須經法官核發調取票。', 'Obtaining call logs, internet logs and other communication records also requires a judge-issued warrant.'),
      source: sourceOf(52), cats: yearCats(52), catHead: tr('年度', 'Year'), stack: true,
      ser: [{ name: tr('准許', 'Approved'), data: annual(52, '准許/案件數') }, { name: tr('駁回', 'Denied'), data: annual(52, '駁回/案件數') }],
    });
  }

  // ---------- 名詞解釋 ----------
  const GLOSSARY = [
    ['新收', '這段期間內法院新收到的案件。最能反映「有多少新糾紛、新案件進到法院」。'],
    ['舊受', '上一期還沒審完、延續到這一期的案件。'],
    ['受理件數', '舊受＋新收，也就是這段期間法院手上要處理的全部案件。'],
    ['終結', '案件已經結束，例如判決、裁定、和解、撤回等。'],
    ['未結', '到期末還沒結束的案件。'],
    ['平均一件所需日數', '已終結的案件，從收案到結案平均花了幾天。'],
    ['第一審', '案件第一次由法院審理。不服判決可以上訴到第二審（高等法院）。'],
    ['科刑', '被告被判有罪並處以刑罰，包括死刑、無期徒刑、有期徒刑、拘役、罰金。'],
    ['緩刑', '被判 2 年以下有期徒刑等較輕刑罰時，法官可以暫緩執行；緩刑期間沒有再犯，刑罰就不用執行。'],
    ['家暴保護令', '依《家庭暴力防治法》，法院可核發通常、暫時、緊急三種保護令，保護家暴被害人。'],
    ['跟騷保護令', '依《跟蹤騷擾防制法》（111年6月施行），被害人可向法院聲請，禁止加害人繼續跟蹤騷擾。'],
    ['消債（更生、清算）', '《消費者債務清理條例》讓還不出錢的人向法院求助。「更生」是有收入者分期還一部分債；「清算」是變賣財產還債，之後由法院決定是否「免責」。'],
    ['調解成立', '雙方在法院調解委員協助下達成協議，不必等到判決。'],
    ['少年保護事件', '12 歲以上未滿 18 歲少年觸法時，由少年法庭以輔導、保護為主的方式處理，例如訓誡、保護管束、感化教育。'],
    ['曝險行為', '112年起取代過去的「虞犯」，指少年有加入幫派、施用毒品等可能觸法的危險行為，以輔導為優先。'],
    ['通訊監察', '俗稱監聽。檢察官偵查重大犯罪時，須向法院聲請，由法官審查是否核發通訊監察書。'],
    ['通信調取', '調閱通話紀錄、上網紀錄、使用者資料等通信紀錄，也須經法官核發調取票。'],
  ];
  const GLOSSARY_EN = [
    ['New cases (新收)', 'Cases the court received during the period — the best gauge of how many new disputes and cases reach the courts.'],
    ['Carried over (舊受)', 'Cases not finished in the previous period and carried into this one.'],
    ['Caseload (受理件數)', 'Carried over + new cases: everything the court has to handle during the period.'],
    ['Closed (終結)', 'Cases that have ended, e.g. by judgment, ruling, settlement or withdrawal.'],
    ['Pending (未結)', 'Cases still open at the end of the period.'],
    ['Average days per case', 'For closed cases, the average number of days from filing to closing.'],
    ['First instance (第一審)', 'The first time a court hears a case. A ruling can be appealed to the second instance (the High Court).'],
    ['Sentenced (科刑)', 'The defendant is convicted and punished: death, life imprisonment, a prison term, short-term detention, or a fine.'],
    ['Suspended sentence (緩刑)', 'For lighter sentences such as a prison term of 2 years or less, the judge may suspend the sentence; if the person doesn’t reoffend during the suspension, it is never served.'],
    ['DV protection order', 'Under the Domestic Violence Prevention Act, courts can issue ordinary, temporary or emergency protection orders for victims.'],
    ['Stalking protection order', 'Under the Stalking and Harassment Prevention Act (in force since June 2022), victims can ask the court to order the offender to stop.'],
    ['Consumer debt relief (更生、清算)', 'The Consumer Debt Clearance Act lets people who can’t pay their debts seek court help. “Rehabilitation” lets debtors with income repay part of the debt in installments; “liquidation” sells assets to repay creditors, after which the court decides whether to discharge the rest.'],
    ['Mediation settled (調解成立)', 'The parties reach an agreement with the help of a court mediator, without waiting for a judgment.'],
    ['Juvenile protection cases', 'When youths aged 12 to 17 break the law, the juvenile court handles the case with an emphasis on guidance and protection — e.g. reprimand, probation, or reformatory education.'],
    ['At-risk behavior (曝險行為)', 'Since 2023 this replaces the old “pre-delinquent” category: behavior such as joining a gang or using drugs that may lead to offending, handled with guidance first.'],
    ['Wiretap (通訊監察)', 'When investigating serious crimes, prosecutors must apply to the court; a judge decides whether to issue a surveillance warrant.'],
    ['Communication records (通信調取)', 'Obtaining call logs, internet logs and subscriber data also requires a judge-issued warrant.'],
  ];
  function renderGlossary() {
    document.getElementById('glossary').innerHTML = (EN ? GLOSSARY_EN : GLOSSARY).map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('');
    const m0 = per(META.months[0]), m1 = per(META.months[META.months.length - 1]), built = META.built.slice(0, 10);
    document.getElementById('buildInfo').innerHTML = tr(`資料涵蓋 ${m0}～${m1}月報；<br>網站資料產生時間：${built}。`, `Covers the monthly reports from ${m0} to ${m1}.<br>Site data generated: ${built}.`);
  }

  // ---------- 分頁、主題 ----------
  const rendered = {};
  const RENDER = { home: renderHome, courts: renderCourts, levels: renderLevels, crime: renderCrime, life: renderLife, youth: renderYouth, glossary: renderGlossary };
  function show(tab, push) {
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${tab}`; });
    if (!rendered[tab]) { RENDER[tab](); rendered[tab] = true; }
    charts.forEach((c) => c.resize());
    if (push) history.replaceState(null, '', `#${tab}`);
  }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab, true)));

  function rerenderAll() {
    const current = document.querySelector('.tabs button[aria-selected="true"]').dataset.tab;
    Object.keys(rendered).forEach((k) => { if (k !== 'glossary') delete rendered[k]; });
    charts.splice(0).forEach((c) => c.dispose());
    show(current, false);
  }
  // 量測標題列高度，手機版用它把頁首往上推，捲動時只留分頁列
  const headerRow = document.querySelector('.header-row');
  const setHdr = () => document.documentElement.style.setProperty('--hdr-row-h', `${headerRow.offsetHeight}px`);
  if (window.ResizeObserver) new ResizeObserver(setHdr).observe(headerRow); else setHdr();

  // 模式下拉選單：司法院（預設）／淺色／深色
  const themeSelect = document.getElementById('themeSelect');
  themeSelect.value = document.documentElement.getAttribute('data-theme') || 'judicial';
  themeSelect.addEventListener('change', () => {
    const next = themeSelect.value;
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
    rerenderAll();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', rerenderAll);
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => charts.forEach((c) => c.resize()), 120); });

  document.getElementById('asof').textContent = EN ? per(META.latest) : META.latestLabel;
  const initial = (location.hash || '#home').slice(1);
  show(RENDER[initial] ? initial : 'home', false);
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (RENDER[h]) show(h, false); });
})();
