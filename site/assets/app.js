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
  const SRC = '資料來源：司法院統計月報';

  // ---------- 工具 ----------
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const series = (i) => css(`--series-${i}`);
  const fmt = (v, d = 0) => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('zh-TW', { maximumFractionDigits: d, minimumFractionDigits: d });
  const fmtBig = (v) => {
    if (v == null) return { n: '—', u: '' };
    if (Math.abs(v) >= 1e6) return { n: (v / 1e4).toLocaleString('zh-TW', { maximumFractionDigits: 1 }), u: '萬' };
    return { n: fmt(v), u: '' };
  };
  const per = (p) => { const [y, m] = p.split('-'); return `${y}年${+m}月`; };
  const perShort = (p) => { const [y, m] = p.split('-'); return `${y}/${+m}`; };
  const shortCourt = (n) => n.replace(/^臺灣|^福建/, '').replace('地方法院', '地院').replace('少家法院', '少家');
  const pct = (a, b) => (b ? (a / b) * 100 : null);
  const tbl = (id) => T['t' + String(id).padStart(2, '0')];
  const latest = META.latest;
  const [LY, LM] = latest.split('-').map(Number);
  const ytdLabel = LM === 12 ? `${LY}年全年` : `${LY}年1–${LM}月`;
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
  const sourceOf = (...ids) => `${SRC} 表${ids.map((i) => String(i).padStart(2, '0')).join('、')}`;
  const lastSnapshot = (t) => { const ks = Object.keys(tbl(t).months); return ks[ks.length - 1]; };
  const isDistrictCourt = (n) => /^(臺灣|福建).+(地方法院|少家法院)$/.test(n);
  const sum = (arr) => arr.reduce((a, b) => a + (b || 0), 0);

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
        <button class="table-toggle" type="button" aria-expanded="false">查看數據</button></div>
      <div class="data-table-wrap" hidden></div>`;
    const btn = el.querySelector('.table-toggle');
    const wrap = el.querySelector('.data-table-wrap');
    btn.addEventListener('click', () => {
      const open = wrap.hidden;
      wrap.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? '隱藏數據' : '查看數據';
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

  const valueFormatter = (digits, unit = '') => (v) => (v == null ? '—' : fmt(v, digits) + unit);
  const axisNum = (v) => (Math.abs(v) >= 1e4 ? (v / 1e4).toLocaleString('zh-TW', { maximumFractionDigits: 1 }) + '萬' : v.toLocaleString('zh-TW'));

  /** 折線圖。ser: [{name, data, color}] */
  function lineChart(id, { title, takeaway, source, cats, ser, digits = 0, unit = '', catHead = '期間', yMin, endLabel = true, area = false, height, hint, selectedIndex, onSelectIndex, focusName, onSelectSeries }) {
    const el = card(id, { title, takeaway, source, height, hint });
    const o = baseOption();
    const ax = o._axis; delete o._axis;
    o.legend.show = ser.length > 1;
    if (ser.length === 1) o.grid.top = 16;
    // 線尾直接標名稱：只在 2–3 條線且名稱短時使用，否則交給圖例，避免文字重疊或被裁切
    const useEnd = endLabel && ser.length > 1 && ser.length <= 3 && ser.every((s) => s.name.length <= 4);
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
  function barChart(id, { title, takeaway, source, cats, ser, digits = 0, unit = '', catHead = '項目', horizontal = false, stack = false, height, labels = true, colors, hint, selected, onSelect }) {
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
        delta = `<p class="t-delta"><span class="${up ? 'up' : 'down'}">${arrow} ${fmt(Math.abs(it.delta), 1)}${it.deltaUnit || '%'}</span> ${it.deltaText || '較去年同期'}</p>`;
      } else if (it.note) delta = `<p class="t-delta">${it.note}</p>`;
      return `<div class="tile"><p class="t-label">${it.label}</p><p class="t-value">${b.n}<span class="t-unit">${b.u}${it.unit || ''}</span></p>${delta}</div>`;
    }).join('');
  }

  const yearCats = (t) => annualYears(t).map((y) => `${y}年`);
  const monthCats = (t) => months(t).map(perShort);

  // ---------- 一眼看懂 ----------
  function renderHome() {
    document.getElementById('ytdLabel').textContent = ytdLabel + ' ';
    tiles('homeTiles', [
      { label: '各級法院新收案件', value: ytd(1, '合計'), unit: '件', delta: yoy(1, '合計') },
      { label: '地方法院刑事新收', value: ytd(38, '受理件數/新收'), unit: '件', delta: yoy(38, '受理件數/新收') },
      { label: '地方法院民事新收', value: ytd(22, '受理件數/新收'), unit: '件', delta: yoy(22, '受理件數/新收') },
      { label: '詐欺罪第一審終結', value: ytd(41, '詐欺罪'), unit: '件', delta: yoy(41, '詐欺罪') },
      { label: '家暴保護令聲請（新收）', value: ytd(35, '受理件數/新收'), unit: '件', delta: yoy(35, '受理件數/新收') },
      { label: '刑事案件平均審理天數', value: fmt(ytd(38, '終結事件平均一件所需日數'), 1), raw: true, unit: '天', note: '地方法院，今年累計' },
    ]);

    homeState = { year: null, cat: null };
    const yb = document.getElementById('hYear'), cb = document.getElementById('hCat');
    yb.innerHTML = `<option value="">${ytdLabel}（今年累計）</option>` + annualYears(1).slice().reverse().map((y) => `<option value="${y}">${y}年</option>`).join('');
    cb.innerHTML = '<option value="">全部案件</option>' + HOME_CATS.map((c) => `<option value="${c.n}">${c.n}</option>`).join('');
    yb.onchange = () => { homeState.year = yb.value || null; drawHomeLinked(); };
    cb.onchange = () => { homeState.cat = cb.value || null; drawHomeLinked(); };
    document.getElementById('hReset').onclick = () => { homeState = { year: null, cat: null }; drawHomeLinked(); };
    drawHomeLinked();
  }

  // 「合計」不含公設辯護、調查保護（人）、家事調查官事件，這裡依合計的組成拆分
  const HOME_CATS = [
    { n: '強制執行', cols: ['強制執行'] }, { n: '民事', cols: ['民事'] }, { n: '刑事', cols: ['刑事'] },
    { n: '公證', cols: ['公證'] }, { n: '提存', cols: ['提存'] }, { n: '行政訴訟', cols: ['行政訴訟'] },
    { n: '其他（憲法法庭、陳訴等）', cols: ['憲法法庭', '人民陳訴', '刑事補償及法官評鑑等', '懲戒及職務'] },
  ];
  const catVal = (cat, row) => sum((cat ? cat.cols : ['合計']).map((c) => row?.[c]));
  let homeState = { year: null, cat: null };

  function drawHomeLinked() {
    const st = homeState;
    const cat = HOME_CATS.find((c) => c.n === st.cat) || null;
    const catLabel = cat ? cat.n.replace(/（.*）/, '') : '全部';
    const years = annualYears(1);
    const A = tbl(1).annual;
    document.getElementById('hYear').value = st.year || '';
    document.getElementById('hCat').value = st.cat || '';
    document.getElementById('hReset').hidden = !st.year && !st.cat;

    // 十年趨勢：依選取的案件類別
    const trend = years.map((y) => catVal(cat, A[y]));
    const first = trend[0], last = trend[trend.length - 1];
    lineChart('c-home-trend', {
      title: cat ? `十年來「${catLabel}」新收件數` : '十年來法院新收案件總數',
      takeaway: `${years[years.length - 1]}年${cat ? catLabel : '共'}新收 ${last >= 1e5 ? fmt(last / 1e4, 0) + ' 萬件' : fmt(last) + ' 件'}，比 ${years[0]}年${last >= first ? '增加' : '減少'} ${fmt(Math.abs(pct(last - first, first)), 0)}%。`,
      hint: '點選圖上任一年，右邊會顯示那一年的案件組成；再點一次取消。',
      source: sourceOf(1), cats: yearCats(1), ser: [{ name: cat ? catLabel : '新收案件', data: trend }], area: true, catHead: '年度',
      selectedIndex: st.year ? years.indexOf(st.year) : null,
      onSelectIndex: (i) => { const y = years[i]; homeState.year = homeState.year === y ? null : y; drawHomeLinked(); },
    });

    // 組成：依選取的年份
    const row = st.year ? A[st.year] : tbl(1).ytd.values;
    const period = st.year ? `${st.year}年` : ytdLabel;
    const mix = HOME_CATS.slice(0, -1).map((c) => ({ n: c.n, v: catVal(c, row) })).sort((a, b) => b.v - a.v)
      .concat([{ n: HOME_CATS[HOME_CATS.length - 1].n, v: catVal(HOME_CATS[HOME_CATS.length - 1], row) }]);
    const totalY = row['合計'];
    barChart('c-home-mix', {
      title: `法院在忙什麼？（${period}新收）`,
      takeaway: cat
        ? `${period}「${catLabel}」新收 ${fmt(catVal(cat, row))} 件，占全部 ${fmt(pct(catVal(cat, row), totalY), 1)}%。`
        : `強制執行（如拍賣、扣薪）和民事案件加起來占了 ${fmt(pct(row['強制執行'] + row['民事'], totalY), 0)}%，刑事案件約占 ${fmt(pct(row['刑事'], totalY), 0)}%。`,
      hint: '點選一種案件，左邊和下方的趨勢圖會改成只看這一類。',
      source: sourceOf(1), cats: mix.map((m) => m.n), ser: [{ name: '新收件數', data: mix.map((m) => m.v) }], horizontal: true, catHead: '案件類別',
      selected: st.cat, onSelect: (n) => { homeState.cat = homeState.cat === n ? null : n; drawHomeLinked(); },
    });

    // 每月：依選取的案件類別；選了年份時標出該年的月份範圍
    const mk = months(1);
    const mdata = mk.map((k) => catVal(cat, tbl(1).monthly[k]));
    lineChart('c-home-monthly', {
      title: cat ? `每月「${catLabel}」新收件數` : '每月新收案件數',
      takeaway: '每年 2 月因春節連假，新收案件通常明顯減少。',
      source: sourceOf(1), cats: monthCats(1), catHead: '月份', height: 'short',
      ser: [{ name: cat ? catLabel : '各級法院合計', data: mdata }],
    });
  }

  // ---------- 案件與法院 ----------
  const COURT_TYPES = {
    civil: { t: 23, name: '民事', new: '受理件數/新收', closed: '終結件數', pending: '未結件數', days: '終結事件平均一件所需日數' },
    criminal: { t: 39, name: '刑事', new: '受理件數/新收', closed: '終結件數', pending: '未結件數', days: '終結案件平均一件所需日數' },
    family: { t: 33, name: '家事', new: '受理件數/新收', closed: '終結件數', pending: '未結件數', days: '終結事件平均一件所需日數' },
  };
  const METRIC_LABEL = { new: ['新收件數', '件'], closed: ['終結件數', '件'], pending: ['未結件數', '件'], days: ['平均審理天數', '天'] };

  function fillMonthSelect(sel, t, keep) {
    const tb = tbl(t);
    const ks = Object.keys(tb.months).reverse();
    sel.innerHTML = ks.map((k) => `<option value="${k}">${tb.periods?.[k] || per(k)}</option>`).join('');
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
    const rows = Object.entries(snap).filter(([n]) => isDistrictCourt(n)).map(([n, v]) => ({ full: n, n: shortCourt(n), v: v[col] })).sort((a, b) => b.v - a.v);
    if (!courtSel || !rows.some((r) => r.full === courtSel)) courtSel = rows[0].full;
    document.getElementById('fCourt').value = courtSel;
    const [mLabel, unit] = METRIC_LABEL[metric];
    const avg = metric === 'days' ? snap['臺灣各地方法院計']?.[col] : null;
    const top = rows[0];
    const periodLabel = tbl(type.t).periods?.[month] || per(month);
    barChart('c-court-rank', {
      title: `各地方法院${type.name}${mLabel}（${periodLabel}）`,
      takeaway: metric === 'days'
        ? `全國平均約 ${fmt(avg, 0)} 天；最久的是${top.n}（${fmt(top.v, 0)} 天）。天數受案件類型、複雜度影響，不能直接代表效率。`
        : `${top.n}最多，共 ${fmt(top.v)} ${unit}；前三名合計占全國 ${fmt(pct(sum(rows.slice(0, 3).map((r) => r.v)), sum(rows.map((r) => r.v))), 0)}%。`,
      hint: '點選一所法院，右邊會顯示它的每月變化與重點數字。',
      source: sourceOf(type.t), cats: rows.map((r) => r.n), ser: [{ name: mLabel, data: rows.map((r) => r.v) }],
      horizontal: true, height: 'tall', digits: metric === 'days' ? 1 : 0, catHead: '法院',
      selected: shortCourt(courtSel),
      onSelect: (short) => { const r = rows.find((x) => x.n === short); if (r) { courtSel = r.full; renderCourtRank(); } },
    });
    renderCourtDetail(type, metric, month, rows);
  }

  function renderCourtDetail(type, metric, month, rows) {
    const T0 = tbl(type.t);
    const have = Object.keys(T0.months);
    // 補齊中間缺少的月份（例如半年報、期別錯誤被略過的月份），在圖上留空而不是直接相連
    const ms = [];
    for (let [y, m] = have[0].split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= have[have.length - 1]; m === 12 ? (y++, m = 1) : m++) ms.push(`${y}-${String(m).padStart(2, '0')}`);
    const gaps = ms.filter((k) => !T0.months[k]).map((k) => `${+k.split('-')[1]}月`);
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
      title: `${name}：每月${type.name}${mLabel}`,
      takeaway: (metric === 'days' ? '和全國地方法院平均天數比較。' : `和全國 ${nCourts} 所地方法院的平均值比較。`) + (gaps.length ? `${gaps.join('、')}沒有單月的機關別資料。` : ''),
      hint: '點選月份，左邊的排名會切換到那個月。',
      source: sourceOf(type.t), cats: ms.map(perShort), catHead: '月份', digits: metric === 'days' ? 1 : 0, unit: metric === 'days' ? '天' : '',
      ser: [{ name, data: own }, { name: metric === 'days' ? '全國平均' : '各院平均', data: nat, color: css('--neutral') }],
      endLabel: false, height: 'short',
      selectedIndex: ms.indexOf(month),
      onSelectIndex: (i) => { if (ms[i] && T0.months[ms[i]]) { document.getElementById('fCourtMonth').value = ms[i]; renderCourtRank(); } },
    });

    const snap = T0.months[month];
    const me = snap[courtSel] || {};
    const rankOf = (c) => {
      const vals = rows.map((r) => snap[r.full]?.[c]).filter((v) => v != null).sort((a, b) => b - a);
      return vals.indexOf(me[c]) + 1;
    };
    const items = [
      ['新收', fmt(me[type.new]), '件', `第 ${rankOf(type.new)} 多`],
      ['終結', fmt(me[type.closed]), '件', `第 ${rankOf(type.closed)} 多`],
      ['未結', fmt(me[type.pending]), '件', `第 ${rankOf(type.pending)} 多`],
      ['平均審理天數', fmt(me[type.days], 1), '天', `全國 ${fmt(snap['臺灣各地方法院計']?.[type.days], 1)} 天`],
    ];
    const up = Object.keys(me).find((k) => /^上訴(案件|事件)維持率$/.test(k));
    if (up && me[up] != null) items.push(['上訴維持率', fmt(me[up], 1), '%', '上級法院維持原判的比例']);
    const settle = me['調解成立百分比/百分比一'];
    if (settle != null) items.push(['調解成立比例', fmt(settle, 1), '%', '成立 ÷（成立＋不成立）']);
    document.getElementById('c-court-profile').innerHTML = `
      <h3>${name}重點數字</h3>
      <p class="takeaway">${type.name}事件，${T0.periods?.[month] || per(month)}；排名是在 ${nCourts} 所地方法院中的名次。</p>
      <dl class="profile">${items.map(([k, v, u, note]) => `<div><dt>${k}</dt><dd>${v}<small>${u}</small></dd><dd class="muted">${note}</dd></div>`).join('')}</dl>
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
      title: '一件案子平均要審多久？',
      takeaway: '地方法院終結案件平均所需天數。家事事件因常需調解、訪視，花的時間最久。',
      source: sourceOf(22, 32, 38), cats: yearCats(38), unit: '天', digits: 1, catHead: '年度', height: 'mid',
      ser: [
        { name: '家事', data: annual(32, '終結事件平均一件所需日數') },
        { name: '刑事', data: annual(38, '終結事件平均一件所需日數') },
        { name: '民事', data: annual(22, '終結事件平均一件所需日數') },
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
      title: `還沒審完的案件已經等了多久？（${per(p56)}底）`,
      takeaway: `地方法院未結案件共 ${fmt(totAll)} 件，${fmt(pct(within6, totAll), 0)}% 收案未滿半年；超過一年的有 ${fmt(over1y)} 件（${fmt(pct(over1y, totAll), 1)}%）。`,
      source: sourceOf(56), cats: buckets.map((b) => b.replace('以上未滿', '～')), catHead: '已經過時間',
      ser: [{ name: '民事', data: civ }, { name: '刑事', data: cri }], stack: true, horizontal: true, height: 'mid',
    });

    const trend = (id, t, name, takeawayFn) => {
      const d = annual(t, '受理件數/新收');
      lineChart(id, {
        title: `${name}新收件數`, takeaway: takeawayFn(d), source: sourceOf(t), cats: yearCats(t),
        ser: [{ name: '新收', data: d }], area: true, catHead: '年度', height: 'short',
      });
    };
    const chg = (d) => `${annualYears(22)[0]}→${annualYears(22).slice(-1)[0]}年：${d[d.length - 1] >= d[0] ? '增加' : '減少'} ${fmt(Math.abs(pct(d[d.length - 1] - d[0], d[0])), 0)}%`;
    trend('c-trend-civil', 22, '地方法院民事', chg);
    trend('c-trend-criminal', 38, '地方法院刑事', chg);
    trend('c-trend-family', 32, '地方法院家事', chg);
  }

  // ---------- 各級法院 ----------
  function renderLevels() {
    document.getElementById('ladderPeriod').textContent = ytdLabel;
    const n = (t, col = '受理件數/新收') => ytd(t, col);
    const box = (name, lines, cls = '') => `<div class="rung ${cls}"><strong>${name}</strong>${lines.map(([k, v]) => `<span>${k} <b>${fmt(v)}</b> 件</span>`).join('')}</div>`;
    document.getElementById('ladder').innerHTML = `
      <div class="lvl-label">第三審</div>
      ${box('最高法院', [['民事', n(5)], ['刑事', n(7)]])}
      ${box('最高行政法院', [['行政訴訟', n(9)]])}
      <div class="lvl-label">第二審</div>
      ${box('高等法院及分院', [['民事', n(18)], ['刑事', n(20)]])}
      ${box('高等行政法院', [['行政訴訟（含地方行政訴訟庭）', n(11)]], 'span2')}
      <div class="lvl-label">第一審</div>
      ${box('地方法院（22 所＋少家法院）', [['民事', n(22)], ['刑事', n(38)], ['家事', n(32)]])}
      <div class="lvl-label">專業法院</div>
      <div class="rung-row">
        ${box('憲法法庭', [['憲法案件', n(3)]])}
        ${box('懲戒法院', [['懲戒、職務案件', n(13)]])}
        ${box('智慧財產及商業法院', [['民刑事、行政', n(16)]])}
      </div>`;

    lineChart('c-lv-uphold', {
      title: '上訴到最高審級，多半被駁回',
      takeaway: `終審法院判決中「駁回上訴」（維持下級法院判決）所占比例。${annualYears(8).slice(-1)[0]}年刑事約 ${fmt(annual(8, '駁回上訴占駁回上訴與撤銷原判百分比').slice(-1)[0], 0)}%、民事約 ${fmt(annual(6, '駁回上訴占駁回上訴與廢棄原判百分比').slice(-1)[0], 0)}% 的上訴被駁回。`,
      source: sourceOf(6, 8, 10), cats: yearCats(6), catHead: '年度', unit: '%', digits: 1, yMin: 50,
      ser: [
        { name: '最高法院刑事', data: annual(8, '駁回上訴占駁回上訴與撤銷原判百分比') },
        { name: '最高行政法院', data: annual(10, '駁回上訴占駁回上訴與廢棄原判百分比') },
        { name: '最高法院民事', data: annual(6, '駁回上訴占駁回上訴與廢棄原判百分比') },
      ],
    });
    const sd = annual(5, '終結事件平均一件所需日數/收案至結案');
    const peak = Math.max(...sd), peakY = annualYears(5)[sd.indexOf(peak)];
    lineChart('c-lv-days', {
      title: '高等法院、最高法院平均審理天數',
      takeaway: `從收案到結案的平均天數。最高法院民事事件從${peakY}年的 ${fmt(peak, 0)} 天降到${annualYears(5).slice(-1)[0]}年的 ${fmt(sd[sd.length - 1], 0)} 天。`,
      source: sourceOf(5, 7, 18, 20), cats: yearCats(18), catHead: '年度', unit: '天', digits: 1,
      ser: [
        { name: '高院民事', data: annual(18, '終結事件平均一件所需日數') },
        { name: '高院刑事', data: annual(20, '終結事件平均一件所需日數') },
        { name: '最高民事', data: sd },
        { name: '最高刑事', data: annual(7, '終結案件平均一件所需日數/收案至結案') },
      ],
    });
    const hc = annual(18, '受理件數/新收'), hk = annual(20, '受理件數/新收');
    lineChart('c-lv-high', {
      title: '高等法院及分院：每年新收件數',
      takeaway: `第二審以刑事案件為主，${annualYears(20).slice(-1)[0]}年刑事新收 ${fmt(hk[hk.length - 1])} 件，約是民事的 ${fmt(hk[hk.length - 1] / hc[hc.length - 1], 1)} 倍。`,
      source: sourceOf(18, 20), cats: yearCats(18), catHead: '年度',
      ser: [{ name: '刑事', data: hk, color: series(2) }, { name: '民事', data: hc, color: series(1) }],
    });
    lineChart('c-lv-supreme', {
      title: '最高法院、最高行政法院：每年新收件數',
      takeaway: '第三審只審查下級法院判決有沒有違背法令，不再重新調查事實。',
      source: sourceOf(5, 7, 9), cats: yearCats(5), catHead: '年度',
      ser: [
        { name: '最高法院刑事', data: annual(7, '受理件數/新收'), color: series(2) },
        { name: '最高法院民事', data: annual(5, '受理件數/新收'), color: series(1) },
        { name: '最高行政法院', data: annual(9, '受理件數/新收'), color: series(3) },
      ],
    });

    // 行政訴訟第一審結果
    const v = (c) => ytd(12, c) || 0;
    const mixed = v('勝敗互見/部分無理由部分有理由') + v('勝敗互見/部分不合法部分有理由');
    const ar = [
      ['原告勝訴', v('勝訴')], ['勝敗互見', mixed], ['原告敗訴', v('敗訴')], ['裁定駁回', v('裁定駁回')],
      ['撤回', v('撤回')], ['移送管轄', v('移送管轄')], ['和解／調解成立', v('和解/件數') + v('調解成立/件數')], ['其他', v('其他') + v('情況判決')],
    ];
    const judged = v('勝訴') + mixed + v('敗訴') + v('情況判決');
    barChart('c-lv-admin-result', {
      title: `人民告政府，結果如何？（行政訴訟第一審，${ytdLabel}）`,
      takeaway: `有判決結果的案件中，原告（人民）全部或部分勝訴約占 ${fmt(pct(v('勝訴') + mixed, judged), 0)}%。另有不少案件因不合法被裁定駁回，或由原告自行撤回。`,
      source: sourceOf(12), cats: ar.map((x) => x[0]), ser: [{ name: '件數', data: ar.map((x) => x[1]) }],
      horizontal: true, catHead: '終結情形',
    });
    lineChart('c-lv-admin-trend', {
      title: '行政法院每年新收件數',
      takeaway: '112年8月行政訴訟新制上路，原本設在地方法院的行政訴訟庭改設在高等行政法院（地方行政訴訟庭），所以高等行政法院件數明顯增加。',
      source: sourceOf(9, 11), cats: yearCats(11), catHead: '年度',
      ser: [{ name: '高等行政法院', data: annual(11, '受理件數/新收') }, { name: '最高行政法院', data: annual(9, '受理件數/新收'), color: series(3) }],
    });

    barChart('c-lv-const', {
      title: '憲法法庭：每年新收與終結',
      takeaway: '111年1月《憲法訴訟法》施行，人民可以對確定判決聲請「裁判憲法審查」，當年新收案件暴增。',
      source: sourceOf(3), cats: yearCats(3), catHead: '年度',
      ser: [{ name: '新收', data: annual(3, '受理件數/新收') }, { name: '終結', data: annual(3, '終結件數/計') }],
    });
    const d14 = (c) => ytd(14, '終結情形/' + c) || 0;
    const disc = [
      ['撤職／免除職務', d14('受懲戒/撤職') + d14('受懲戒/免除職務')], ['休職', d14('受懲戒/休職')], ['降級', d14('受懲戒/降級')],
      ['減俸／罰款', d14('受懲戒/減俸') + d14('受懲戒/罰款')], ['記過／申誡', d14('受懲戒/記過') + d14('受懲戒/申誡')],
      ['剝奪、減少退休金', d14('受懲戒/剝奪、減少退休(職、伍)金') + d14('受懲戒/奪、減少退休(職、伍)金')],
      ['不受懲戒', d14('不受懲戒')], ['免議／不受理', d14('免議及不受理')], ['其他', d14('其他')],
    ];
    barChart('c-lv-discipline', {
      title: `公務員懲戒結果（${ytdLabel}）`,
      takeaway: '懲戒法院審理公務員違法失職案件，由監察院彈劾或機關首長移送。',
      source: sourceOf(14), cats: disc.map((x) => x[0]), ser: [{ name: '件數', data: disc.map((x) => x[1]) }],
      horizontal: true, catHead: '終結情形',
    });
    lineChart('c-lv-ip', {
      title: '智慧財產及商業法院：每年新收件數',
      takeaway: '審理專利、商標、著作權、營業秘密等案件；112年起另設商業法庭，處理重大商業紛爭。',
      source: sourceOf(16), cats: yearCats(16), catHead: '年度',
      ser: [{ name: '新收', data: annual(16, '受理件數/新收') }], area: true,
    });
  }

  // ---------- 刑事犯罪 ----------
  const CRIME_EXCLUDE = new Set(['合計', '普通刑法計', '特別刑事法令計', '其他', '併案裁判']);
  const crimeName = (c) => c.replace(/^殺人罪\//, '').replace(/^違反/, '').replace('毒品危害防制條例', '毒品條例').replace('槍砲彈藥刀械管制條例', '槍砲條例').replace('詐欺犯罪危害防制條例', '詐欺犯罪防制條例');

  function renderCrime() {
    const t41 = tbl(41);
    const crimes = t41.columns.filter((c) => !CRIME_EXCLUDE.has(c));
    const top = crimes.map((c) => ({ c, v: ytd(41, c) })).sort((a, b) => b.v - a.v).slice(0, 10);
    const totalY = ytd(41, '合計');

    const p55 = lastSnapshot(55);
    const prob = tbl(55).months[p55]['地方法院合計'];
    tiles('crimeTiles', [
      { label: `第一審終結案件（${ytdLabel}）`, value: totalY, unit: '件', delta: yoy(41, '合計') },
      { label: `科刑人數（${ytdLabel}）`, value: ytd(43, '合計'), unit: '人', delta: yoy(43, '合計') },
      { label: '詐欺＋洗錢案件占比', value: fmt(pct(ytd(41, '詐欺罪') + ytd(41, '違反洗錢防制法'), totalY), 1), raw: true, unit: '%', note: '詐欺集團案件常同時涉及兩者' },
      { label: `地院緩刑率（${per(p55)}）`, value: fmt(prob['合計/緩刑率'], 1), raw: true, unit: '%', note: '符合緩刑條件的被告中，獲宣告緩刑的比例' },
    ]);

    // 裁判結果（表42，單月）的選單
    const cSel = document.getElementById('fVerdictCrime');
    const mSel = document.getElementById('fVerdictMonth');
    fillMonthSelect(mSel, 42, mSel.value);
    const snap0 = tbl(42).months[lastSnapshot(42)];
    const rowsAll = Object.keys(snap0).filter((k) => !['男', '女', '其他'].includes(k));
    const popular = ['合計', '詐欺罪', '違反洗錢防制法', '公共危險罪', '竊盜罪', '傷害罪', '違反毒品危害防制條例'];
    const ordered = popular.filter((p) => rowsAll.includes(p)).concat(rowsAll.filter((r) => !popular.includes(r)));
    cSel.innerHTML = ordered.map((r) => `<option value="${r}">${r === '合計' ? '全部罪名' : crimeName(r)}</option>`).join('');
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
      title: `終結案件最多的十種罪名（${ytdLabel}）`,
      takeaway: selName && top.some((x) => x.c === crimeSel)
        ? `${selName}：${fmt(ytd(41, crimeSel))} 件，占全部第一審終結案件的 ${fmt(pct(ytd(41, crimeSel), totalY), 1)}%，較去年同期${yoy(41, crimeSel) >= 0 ? '增加' : '減少'} ${fmt(Math.abs(yoy(41, crimeSel)), 1)}%。`
        : `${crimeName(top[0].c)}最多，占全部第一審終結案件的 ${fmt(pct(top[0].v, totalY), 0)}%。「公共危險罪」大多是酒駕。`,
      hint: '點選罪名，右邊趨勢和下方的裁判結果會換成這個罪名；再點一次取消。',
      source: sourceOf(41), cats: top.map((x) => crimeName(x.c)), ser: [{ name: '終結件數', data: top.map((x) => x.v) }],
      horizontal: true, height: 'tall', catHead: '罪名',
      selected: selName, onSelect: pick,
    });

    const cols = CRIME_FOCUS.concat(crimeSel && !CRIME_FOCUS.includes(crimeSel) ? [crimeSel] : []);
    const fraud = annual(41, '詐欺罪');
    const sd = crimeSel ? annual(41, crimeSel) : null;
    lineChart('c-crime-trend', {
      title: '主要罪名十年趨勢（第一審終結件數）',
      takeaway: crimeSel
        ? `${selName}從 ${annualYears(41)[0]}年的 ${fmt(sd[0])} 件，變成 ${annualYears(41).slice(-1)[0]}年的 ${fmt(sd[sd.length - 1])} 件。`
        : `詐欺案件從 ${annualYears(41)[0]}年的 ${fmt(fraud[0])} 件增加到 ${annualYears(41).slice(-1)[0]}年的 ${fmt(fraud[fraud.length - 1])} 件，已超越公共危險罪（多為酒駕）；毒品案件則比十年前少了一半以上。`,
      hint: '點選線條也能選取罪名。',
      source: sourceOf(41), cats: yearCats(41), catHead: '年度', height: 'tall',
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
    const label = tbl(42).periods?.[month] || per(month);
    const name = crime === '合計' ? '全部罪名' : crimeName(crime);
    const parts = [
      ['有期徒刑', r['科刑/有期徒刑/小計']], ['拘役', r['科刑/拘役']], ['罰金', r['科刑/罰金']],
      ['無期徒刑／死刑', (r['科刑/無期徒刑'] || 0) + (r['科刑/死刑'] || 0)],
      ['無罪', r['無罪']], ['免除其刑', r['免除其刑']], ['其他（不受理、免訴等）', r['其他']],
    ];
    const total = r['被告人數'] || 0;
    barChart('c-verdict', {
      title: `被告最後被判了什麼？（${name}，${label}）`,
      takeaway: missingName ? `裁判結果表沒有「${missingName}」的分項，先顯示全部罪名。` : total ? `共 ${fmt(total)} 名被告，${fmt(pct(r['科刑/計'], total), 0)}% 被判有罪科刑，${fmt(pct(r['無罪'], total), 1)}% 無罪。` : '這個月沒有此罪名的終結案件。',
      source: sourceOf(42), cats: parts.map((p) => p[0]), ser: [{ name: '人數', data: parts.map((p) => p[1] || 0) }],
      horizontal: true, catHead: '裁判結果',
    });
    const prison = [
      ['一年以下', r['科刑/有期徒刑/一年以下']], ['逾1年至5年', r['科刑/有期徒刑/逾一年至五年以下']],
      ['逾5年至10年', r['科刑/有期徒刑/逾五年至十年以下']], ['逾10年', r['科刑/有期徒刑/逾十年']],
    ];
    const ps = r['科刑/有期徒刑/小計'] || 0;
    barChart('c-prison', {
      title: `判有期徒刑的刑期分布（${name}）`,
      takeaway: ps ? `有期徒刑 ${fmt(ps)} 人中，${fmt(pct(prison[0][1], ps), 0)}% 刑期在一年以下。` : '這個月沒有判處有期徒刑的被告。',
      source: sourceOf(42), cats: prison.map((p) => p[0]), ser: [{ name: '人數', data: prison.map((p) => p[1] || 0) }],
      catHead: '刑期', colors: [css('--seq-1'), css('--seq-2'), css('--seq-4'), css('--seq-5')],
    });
    // 緩刑率依法院
    const p55 = lastSnapshot(55);
    const s55 = tbl(55).months[p55];
    const rows = Object.entries(s55).filter(([n]) => isDistrictCourt(n)).map(([n, v]) => ({ n: shortCourt(n), v: v['合計/緩刑率'] })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
    barChart('c-probation', {
      title: `各地方法院緩刑率（${per(p55)}）`,
      takeaway: `宣告刑符合緩刑條件（通常是 2 年以下有期徒刑等）的被告中，法官宣告緩刑的比例。全體地方法院為 ${fmt(s55['地方法院合計']['合計/緩刑率'], 1)}%。單月人數少的法院，比例波動會比較大。`,
      source: sourceOf(55), cats: rows.map((x) => x.n), ser: [{ name: '緩刑率', data: rows.map((x) => x.v) }],
      digits: 1, unit: '%', catHead: '法院', horizontal: true, height: 'tall',
    });
  }

  // ---------- 保護令與卡債 ----------
  function renderLife() {
    // 家暴保護令
    const iss = ytd(35, '終結件數/核發'), rej = ytd(35, '終結件數/駁回');
    tiles('dvTiles', [
      { label: `家暴保護令新收（${ytdLabel}）`, value: ytd(35, '受理件數/新收'), unit: '件', delta: yoy(35, '受理件數/新收') },
      { label: '核發件數', value: iss, unit: '件', delta: yoy(35, '終結件數/核發') },
      { label: '核發率', value: fmt(pct(iss, iss + rej), 1), raw: true, unit: '%', note: '核發件數 ÷（核發＋駁回）' },
      { label: `跟蹤騷擾保護令新收（${ytdLabel}）`, value: ytd(30, '受理件數/新收'), unit: '件', delta: yoy(30, '受理件數/新收') },
    ]);

    lineChart('c-dv-trend', {
      title: '家暴保護令：每年聲請與核發件數',
      takeaway: '保護令可以禁止加害人施暴、騷擾，或命令遷出、遠離被害人住所。',
      source: sourceOf(35), cats: yearCats(35), catHead: '年度',
      ser: [{ name: '聲請', data: annual(35, '受理件數/新收') }, { name: '核發', data: annual(35, '終結件數/核發') }],
    });

    const pfx = '終結事件中准許核發保護令內容（項）/';
    const items = tbl(35).columns.filter((c) => c.startsWith(pfx)).map((c) => ({ n: c.slice(pfx.length), v: ytd(35, c) })).sort((a, b) => b.v - a.v);
    const topItems = items.slice(0, 6);
    const otherV = sum(items.slice(6).map((x) => x.v));
    const nm = (s) => s.replace('強制加害人完成處遇計畫', '加害人完成處遇計畫').replace('與未成年子女會面交往之方式或禁止會面交往', '子女會面交往').replace('未成年子女權利義務行使、負擔及交付子女', '子女親權').replace(/其他必要之.*護令/, '其他必要措施');
    barChart('c-dv-content', {
      title: `保護令內容最常見的是什麼？（${ytdLabel}，項）`,
      takeaway: '一張保護令可以同時包含好幾項內容，最常見的是「禁止實施家庭暴力」和「禁止騷擾」。',
      source: sourceOf(35), cats: topItems.map((x) => nm(x.n)).concat(['其他']), ser: [{ name: '項數', data: topItems.map((x) => x.v).concat([otherV]) }],
      horizontal: true, catHead: '保護令內容',
    });

    // 跟騷
    const sYears = annualYears(30).filter((y) => tbl(30).annual[y]['受理件數/合計'] > 0);
    const sCats = sYears.map((y) => `${y}年`).concat([`${LY}年1–${LM}月`]);
    const sNew = sYears.map((y) => tbl(30).annual[y]['受理件數/新收']).concat([ytd(30, '受理件數/新收')]);
    const sIss = sYears.map((y) => tbl(30).annual[y]['終結件數/核發']).concat([ytd(30, '終結件數/核發')]);
    const sRej = sYears.map((y) => tbl(30).annual[y]['終結件數/駁回']).concat([ytd(30, '終結件數/駁回')]);
    barChart('c-stalk-trend', {
      title: '跟蹤騷擾保護令：聲請與結果',
      takeaway: `《跟蹤騷擾防制法》111年6月施行，所以111年只有約半年資料。${LY}年1–${LM}月核發率為 ${fmt(pct(ytd(30, '終結件數/核發'), ytd(30, '終結件數/核發') + ytd(30, '終結件數/駁回')), 0)}%（核發 ÷ 核發＋駁回）。`,
      source: sourceOf(30), cats: sCats, catHead: '期間',
      ser: [{ name: '新收（聲請）', data: sNew }, { name: '核發', data: sIss }, { name: '駁回', data: sRej }],
    });
    const apfx = '終結事件聲請人別/';
    const apps = tbl(30).columns.filter((c) => c.startsWith(apfx) && !c.endsWith('/計')).map((c) => ({ n: c.slice(apfx.length), v: ytd(30, c) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    const appTot = ytd(30, '終結事件聲請人別/計');
    barChart('c-stalk-applicant', {
      title: `誰來聲請跟騷保護令？（${ytdLabel}）`,
      takeaway: `${fmt(pct(apps[0]?.v, appTot), 0)}% 由${apps[0]?.n}本人聲請，其次是${apps[1]?.n || '—'}。`,
      source: sourceOf(30), cats: apps.map((x) => x.n.replace('三親等以內血親或姻親', '三親等內親屬')), ser: [{ name: '件數', data: apps.map((x) => x.v) }],
      horizontal: true, catHead: '聲請人',
    });

    // 消債
    const dYears = annualYears(27);
    lineChart('c-debt-trend', {
      title: '卡債族向法院求助：消費者債務清理新收件數（每月）',
      takeaway: `${ytdLabel}共新收 ${fmt(ytd(27, '受理件數/新收'))} 件，較去年同期${yoy(27, '受理件數/新收') >= 0 ? '增加' : '減少'} ${fmt(Math.abs(yoy(27, '受理件數/新收')), 1)}%。年度新收：${dYears.map((y) => `${y}年 ${fmt(tbl(27).annual[y]['受理件數/新收'])} 件`).join('、')}。`,
      source: sourceOf(27), cats: monthCats(27), catHead: '月份',
      ser: [{ name: '新收件數', data: monthly(27, '受理件數/新收') }], area: true,
    });
    const disc = annualYears(29);
    const dcats = disc.map((y) => `${y}年`).concat([`${LY}年1–${LM}月`]);
    const dYes = disc.map((y) => tbl(29).annual[y]['聲請免責(不免責)終結情形/債務人免責']).concat([ytd(29, '聲請免責(不免責)終結情形/債務人免責')]);
    const dNo = disc.map((y) => tbl(29).annual[y]['聲請免責(不免責)終結情形/債務人不免責']).concat([ytd(29, '聲請免責(不免責)終結情形/債務人不免責')]);
    const lastRate = pct(dYes[dYes.length - 1], dYes[dYes.length - 1] + dNo[dNo.length - 1]);
    barChart('c-debt-discharge', {
      title: '清算後債務能不能「免責」？',
      takeaway: `走完清算程序後，法院裁定債務人「免責」，剩下的債務就不用再還。${LY}年1–${LM}月免責比例約 ${fmt(lastRate, 0)}%；不免責最常見的原因是消債條例第133條（有固定收入但未清償到一定比例）。`,
      source: sourceOf(29), cats: dcats, catHead: '期間', stack: true,
      ser: [{ name: '免責', data: dYes }, { name: '不免責', data: dNo }],
    });

    // 家事
    lineChart('c-family-trend', {
      title: '家事事件調解成立比例',
      takeaway: '離婚、監護權、扶養費等家事紛爭，很多在法院調解就能解決，不必走到判決。比例為調解成立件數 ÷（成立＋不成立）件數。',
      source: sourceOf(32), cats: yearCats(32), catHead: '年度', unit: '%', digits: 1,
      ser: [{ name: '調解成立比例', data: annual(32, '調解成立百分比/百分比一') }],
    });
    const p34 = lastSnapshot(34);
    const s34 = tbl(34).months[p34]['合計'];
    const fam = Object.entries(s34).filter(([k]) => k !== '合計').map(([k, v]) => ({ n: k.split('/').pop(), v })).sort((a, b) => b.v - a.v);
    const famTop = fam.slice(0, 9);
    barChart('c-family-type', {
      title: `家事法院處理哪些事？（${per(p34)}終結件數）`,
      takeaway: '最多的是繼承相關事件（如拋棄繼承、限定繼承），其次是保護令與調解。',
      source: sourceOf(34), cats: famTop.map((x) => x.n).concat(['其他']), ser: [{ name: '件數', data: famTop.map((x) => x.v).concat([sum(fam.slice(9).map((x) => x.v))]) }],
      horizontal: true, catHead: '事件類型',
    });
  }

  // ---------- 少年與通訊監察 ----------
  function renderYouth() {
    lineChart('c-youth-trend', {
      title: '少年及兒童保護事件：每年新收件數',
      takeaway: '少年法庭先「調查」，必要時才「開始審理」並給予保護處分。',
      source: sourceOf(46, 47), cats: yearCats(46), catHead: '年度',
      ser: [{ name: '調查新收', data: annual(46, '受理件數/新收') }, { name: '審理新收', data: annual(47, '受理件數/新收') }],
    });
    const ip = '終結情形(人)/';
    const inv = [
      ['開始審理', ytd(46, ip + '開始審理')], ['不付審理', ytd(46, ip + '不付審理/小計')],
      ['移送（轉）管轄', ytd(46, ip + '移送(轉)管轄')], ['移送檢察署', ytd(46, ip + '移送檢察廳')],
      ['其他（含協尋）', (ytd(46, ip + '其他') || 0) + (ytd(46, ip + '協尋') || 0)],
    ];
    const invTot = ytd(46, ip + '計');
    barChart('c-youth-type', {
      title: `調查之後怎麼處理？（${ytdLabel}，人）`,
      takeaway: `${fmt(pct(inv[0][1], invTot), 0)}% 的少年進入審理；${fmt(pct(inv[1][1], invTot), 0)}% 因情節輕微等原因不付審理。移送檢察署的是較重大案件，改依刑事程序處理。`,
      source: sourceOf(46), cats: inv.map((x) => x[0]), ser: [{ name: '人數', data: inv.map((x) => x[1] || 0) }],
      horizontal: true, catHead: '處理結果',
    });
    const dp = '終結情形(人)/';
    const disp = [
      ['訓誡', ytd(47, dp + '交付保護處分/訓誡')], ['訓誡並予假日生活輔導', ytd(47, dp + '交付保護處分/訓誡/訓誡並予假日生活輔導')],
      ['保護管束', ytd(47, dp + '交付保護處分/保護管束')], ['安置輔導', ytd(47, dp + '交付保護處分/安置輔導')],
      ['感化教育', ytd(47, dp + '交付保護處分/感化教育')], ['不付保護處分', ytd(47, dp + '不付保護處分')],
      ['移送檢察署', ytd(47, dp + '移送檢察廳')], ['其他', (ytd(47, dp + '其他') || 0) + (ytd(47, dp + '協尋') || 0) + (ytd(47, dp + '移送(轉)管轄') || 0)],
    ];
    disp.sort((a, b) => (a[0] === '其他') - (b[0] === '其他') || b[1] - a[1]);
    const dtot = ytd(47, dp + '計');
    barChart('c-youth-disposal', {
      title: `少年審理後的處遇（${ytdLabel}，人）`,
      takeaway: `最常見的是保護管束（${fmt(pct(ytd(47, dp + '交付保護處分/保護管束'), dtot), 0)}%），須在少年保護官輔導下生活；送感化教育的約占 ${fmt(pct(ytd(47, dp + '交付保護處分/感化教育'), dtot), 0)}%。`,
      source: sourceOf(47), cats: disp.map((d) => d[0]), ser: [{ name: '人數', data: disp.map((d) => d[1] || 0) }],
      horizontal: true, catHead: '處遇',
    });

    // 通訊監察
    const c = '檢察官聲請案件/';
    const ok = ytd(51, c + '核准/案件數'), no = ytd(51, c + '駁回/案件數'), part = ytd(51, c + '部分准駁/案件數');
    const rOk = ytd(52, '准許/案件數'), rNo = ytd(52, '駁回/案件數');
    tiles('wiretapTiles', [
      { label: `通訊監察聲請（${ytdLabel}）`, value: ytd(51, '合計/案件數'), unit: '件', delta: yoy(51, '合計/案件數') },
      { label: '通訊監察全部駁回比例', value: fmt(pct(no, ok + no + part), 1), raw: true, unit: '%', note: '法官全部駁回檢察官聲請的比例' },
      { label: `通信調取聲請（${ytdLabel}）`, value: ytd(52, '合計/案件數'), unit: '件', delta: yoy(52, '合計/案件數') },
      { label: '通信調取駁回比例', value: fmt(pct(rNo, ytd(52, '合計/案件數')), 1), raw: true, unit: '%', note: '駁回件數 ÷ 聲請件數' },
    ]);
    barChart('c-wiretap', {
      title: '通訊監察（監聽）：檢察官聲請的審查結果',
      takeaway: `檢察官要監聽，必須先向法院聲請「通訊監察書」。聲請件數從${annualYears(51)[0]}年的 ${fmt(annual(51, '合計/案件數')[0])} 件降到${annualYears(51).slice(-1)[0]}年的 ${fmt(annual(51, '合計/案件數').slice(-1)[0])} 件。`,
      source: sourceOf(51), cats: yearCats(51), catHead: '年度', stack: true,
      ser: [{ name: '核准', data: annual(51, c + '核准/案件數') }, { name: '部分准駁', data: annual(51, c + '部分准駁/案件數') }, { name: '駁回', data: annual(51, c + '駁回/案件數') }],
    });
    barChart('c-retrieve', {
      title: '通信調取（調通聯紀錄）：審查結果',
      takeaway: '調取通話紀錄、上網紀錄等通信紀錄，也必須經法官核發調取票。',
      source: sourceOf(52), cats: yearCats(52), catHead: '年度', stack: true,
      ser: [{ name: '准許', data: annual(52, '准許/案件數') }, { name: '駁回', data: annual(52, '駁回/案件數') }],
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
  function renderGlossary() {
    document.getElementById('glossary').innerHTML = GLOSSARY.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('');
    document.getElementById('buildInfo').textContent = `資料涵蓋 ${META.months.map(per).join('、')} 月報；網站資料產生時間：${META.built}。`;
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
  document.getElementById('themeBtn').addEventListener('click', () => {
    const root = document.documentElement;
    const isDark = root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
    rerenderAll();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', rerenderAll);
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => charts.forEach((c) => c.resize()), 120); });

  document.getElementById('asof').textContent = META.latestLabel;
  const initial = (location.hash || '#home').slice(1);
  show(RENDER[initial] ? initial : 'home', false);
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (RENDER[h]) show(h, false); });
})();
