/* 語言切換：中文（預設）／英文
   - 決定語言：網址 ?lang=en|zh 優先，其次是上次的選擇（localStorage），否則中文
   - 靜態頁面文字以 data-i18n 標記，英文版在 app.js 執行前替換
   - 資料標籤（法院、罪名、事件類型等）的英譯也放在這裡，查不到時沿用中文 */
(function () {
  'use strict';
  let lang = 'zh';
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'zh') { lang = q; localStorage.setItem('lang', q); }
    else if (localStorage.getItem('lang') === 'en') lang = 'en';
  } catch (e) {}
  const EN = lang === 'en';
  document.documentElement.lang = EN ? 'en' : 'zh-Hant-TW';

  // ---------- 靜態頁面文字（英文） ----------
  const STATIC = {
    'skip': 'Skip to main content',
    'site-title': 'Taiwan Judicial Statistics',
    'sub': 'Data through <strong id="asof">—</strong><span class="dot" aria-hidden="true">·</span>Source: Judicial Yuan Monthly Statistics',
    'theme': 'Theme',
    'tab-home': 'Overview', 'tab-courts': 'Cases &amp; Courts', 'tab-levels': 'Court Levels', 'tab-crime': 'Criminal Cases',
    'tab-life': 'Protection Orders &amp; Debt', 'tab-youth': 'Juveniles &amp; Surveillance', 'tab-glossary': 'Glossary',
    'home-lede': 'Taiwan’s courts handle more than 4 million cases a year. This site turns the Judicial Yuan’s monthly statistics into charts, so you can quickly see what the courts are busy with and how caseloads are changing.',
    'home-ytd': '<span id="ytdLabel">This year</span> at a glance',
    'home-explore': 'Explore',
    'f-year': 'Year', 'f-cat': 'Case type', 'reset': 'Clear selection',
    'linkbar-note': 'You can also click the charts — all three update together.',
    'courts-lede': 'Caseloads vary widely between district courts. Pick a case type and a measure to compare Taiwan’s 22 district courts and the Kaohsiung Juvenile and Family Court.',
    'f-type': 'Case type', 'f-metric': 'Measure', 'f-month': 'Month', 'f-court': 'Court',
    'o-civil': 'Civil', 'o-criminal': 'Criminal', 'o-family': 'Family',
    'o-new': 'New cases', 'o-closed': 'Closed cases', 'o-pending': 'Pending cases', 'o-days': 'Average days to close',
    'courts-trend': 'New cases by type over ten years',
    'levels-lede': 'A case doesn’t always end at the district court. Rulings can be appealed to the High Court and the Supreme Court; suits against the government go to the administrative courts; misconduct by civil servants goes to the Disciplinary Court; and constitutional disputes go to the Constitutional Court.',
    'ladder-title': 'How are Taiwan’s courts organized?',
    'ladder-note': 'Most cases follow a “three levels, three instances” system: first instance → second instance → third instance. Figures below are new cases for <span id="ladderPeriod">this year</span>.',
    'levels-appeal': 'After an appeal',
    'levels-admin': 'Administrative courts: suing the government',
    'levels-special': 'Constitutional Court, Disciplinary Court, Intellectual Property and Commercial Court',
    'crime-lede': 'Among criminal cases closed at first instance in the district courts, which offenses are most common, and what sentences do defendants receive?',
    'f-crime': 'Offense',
    'life-lede': 'The court services that touch everyday life most: domestic violence protection orders, stalking protection orders, consumer debt relief, and family matters.',
    'life-dv': 'Domestic violence protection orders', 'life-stalk': 'Stalking protection orders',
    'life-debt': 'Credit card debt and consumer debt relief', 'life-family': 'Family matters',
    'youth-lede': 'Juvenile cases focus on protection and guidance rather than punishment. Wiretaps and communication-record requests require a judge’s approval — an important safeguard for privacy.',
    'youth-cases': 'Juvenile and child protection cases', 'youth-wiretap': 'Wiretaps and communication records',
    'glossary-lede': 'Terms in the statistics don’t always mean what they mean in everyday speech. Here they are in plain language.',
    'about-title': 'About the data',
    'about-1': 'Data come from the Judicial Yuan’s monthly <i>Judicial Statistics</i> reports. The latest issue is used, since each issue revises earlier figures.',
    'about-2': '“Year” means a full calendar year; “this year” means January through the latest month, compared with the same period last year.',
    'about-3': 'Court-by-court comparisons use single-month data. Every month shown is the Judicial Yuan’s published single-month figure; nothing is estimated.',
    'about-4': 'This site shows only the figures most relevant to the public; see the Judicial Yuan’s statistics portal for the full tables. Years are shown in the Gregorian calendar (ROC year + 1911).',
    'footer': 'Source: Judicial Yuan Monthly Judicial Statistics. Click “View data” on any chart to see the numbers as a table.',
  };

  // ---------- 資料標籤（英文） ----------
  const COURT = {
    '臺北': 'Taipei', '士林': 'Shilin', '新北': 'New Taipei', '桃園': 'Taoyuan', '新竹': 'Hsinchu', '苗栗': 'Miaoli',
    '臺中': 'Taichung', '南投': 'Nantou', '彰化': 'Changhua', '雲林': 'Yunlin', '嘉義': 'Chiayi', '臺南': 'Tainan',
    '高雄': 'Kaohsiung', '橋頭': 'Ciaotou', '高雄少家': 'Kaohsiung Juvenile & Family', '屏東': 'Pingtung', '臺東': 'Taitung',
    '花蓮': 'Hualien', '宜蘭': 'Yilan', '基隆': 'Keelung', '澎湖': 'Penghu', '金門': 'Kinmen', '連江': 'Lienchiang',
  };
  const LABEL = {
    // 罪名（表41、表42）
    '合計': 'All offenses', '普通刑法計': 'Criminal Code (subtotal)', '特別刑事法令計': 'Special criminal laws (subtotal)','瀆職罪': 'Malfeasance', '妨害公務罪': 'Obstructing public officials', '妨害投票罪': 'Election offenses',
    '妨害秩序罪': 'Public order offenses', '脫逃罪': 'Escape', '藏匿犯人及湮滅證據罪': 'Harboring offenders / destroying evidence',
    '藏匿人犯及湮滅證據罪': 'Harboring offenders / destroying evidence', '偽證罪': 'Perjury', '誣告罪': 'False accusation',
    '妨害司法公正罪': 'Obstruction of justice', '公共危險罪': 'Public endangerment', '偽造貨幣罪': 'Counterfeiting currency',
    '偽造有價證卷罪': 'Forging securities', '偽造有價證券罪': 'Forging securities', '偽造度量衡罪': 'Forging weights and measures',
    '偽造文書印文罪': 'Forgery of documents and seals', '妨害性自主罪': 'Sexual offenses', '妨害風化罪': 'Offenses against public morals',
    '妨害婚姻及家庭罪': 'Offenses against marriage and family', '褻瀆祀典及侵害墳墓屍體罪': 'Desecration of graves and corpses',
    '妨害農工商罪': 'Offenses against agriculture, industry and commerce', '賭博罪': 'Gambling', '殺人罪': 'Homicide',
    '殺人': 'Homicide', '過失致死': 'Negligent homicide', '傷害罪': 'Assault', '墮胎罪': 'Illegal abortion', '遺棄罪': 'Abandonment',
    '妨害自由罪': 'Offenses against personal liberty', '妨害名譽及信用罪': 'Defamation', '妨害秘密罪': 'Invasion of privacy',
    '妨害性隱私及不實性影像罪': 'Sexual privacy and deepfake imagery', '竊盜罪': 'Theft', '強盜罪': 'Robbery',
    '搶奪及海盜罪': 'Snatching and piracy', '侵占罪': 'Embezzlement', '詐欺罪': 'Fraud', '背信罪': 'Breach of trust', '重利罪': 'Usury',
    '恐嚇取財罪': 'Extortion', '擄人勒贖罪': 'Kidnapping for ransom', '贓物罪': 'Handling stolen goods', '毀棄損壞罪': 'Property damage',
    '妨害電腦使用罪': 'Computer crimes', '貪污治罪條例': 'Anti-Corruption Act', '懲治盜匪條例': 'Banditry Act',
    '妨害兵役治罪條例': 'Military Service Obstruction Act', '違反毒品危害防制條例': 'Narcotics Act', '違反菸酒管理法': 'Tobacco and Alcohol Act',
    '違反藥事法': 'Pharmaceutical Affairs Act', '違反麻醉藥品管理條例': 'Controlled Drugs Act', '違反著作權法': 'Copyright Act',
    '違反專利法': 'Patent Act', '違反商標法': 'Trademark Act', '違反槍砲彈藥刀械管制條例': 'Firearms Act',
    '違反公權人員選舉罷免法': 'Election and Recall Act', '違反公職人員選舉罷免法': 'Election and Recall Act',
    '違反洗錢防制法': 'Money Laundering Control Act', '違反跟蹤騷擾防制法': 'Stalking and Harassment Act',
    '違反家庭暴力防治法': 'Domestic Violence Act', '違反詐欺犯罪危害防制條例': 'Fraud Crime Prevention Act',
    '違反電信法': 'Telecommunications Act', '違反糧食管理法': 'Food Grain Act', '違反國家總動員法': 'National Mobilization Act',
    '懲治走私條例': 'Smuggling Act', '違反森林法': 'Forestry Act', '違反漁業法': 'Fisheries Act', '陸海空軍刑法': 'Criminal Code of the Armed Forces',
    '違反水利法': 'Water Act', '違反電業法': 'Electricity Act', '違反海商法': 'Maritime Act', '違反各種稅法': 'Tax laws',
    '妨害國幣懲治條例': 'National Currency Act', '違反醫師法': 'Physicians Act', '違反公司法': 'Company Act',
    '違反食品衛生管理法': 'Food Safety Act', '國家安全法': 'National Security Act', '集會遊行法': 'Assembly and Parade Act',
    '違反銀行法': 'Banking Act',
    // 保護令內容（表35）
    '禁止實施家庭暴力': 'No domestic violence', '禁止騷擾等行為': 'No harassment or contact', '強制遷出': 'Move-out order',
    '強制遷出及禁止使用、益或處分不動產': 'Move-out and property restrictions', '強制遠離': 'Stay-away order', '使用權歸屬': 'Use of property',
    '子女親權': 'Child custody', '子女會面交往': 'Child visitation', '租金、扶養費給付': 'Rent / support payments',
    '醫療、輔導、庇護所及財物損害費用給付': 'Medical, counseling and damage costs', '加害人完成處遇計畫': 'Offender treatment program',
    '負擔相當之律師費': 'Attorney fees', '禁止查閱被害人及未成年子女相關資訊': 'No access to victim’s records',
    '禁止重製、散布、播送、交付、公然陳列被害人性影像': 'No sharing of victim’s sexual images', '交付持有之被害人性影像予被害人': 'Hand over victim’s sexual images',
    '刪除持有之被害人性影像': 'Delete victim’s sexual images', '刪除已上傳網際網路之被害人性影像': 'Delete victim’s images posted online',
    '申請移除已上傳網際網路之被害人性影像': 'Request removal of images online',
    '其他必要措施': 'Other necessary measures', '其他': 'Other',
    // 跟騷保護令聲請人（表30）
    '被害人': 'Victim', '檢察官': 'Prosecutor', '警察機關': 'Police', '配偶': 'Spouse', '法定代理人': 'Legal guardian',
    '三親等內親屬': 'Relative', '三親等以內血親或姻親': 'Relative',
    // 家事事件（表34）
    '婚姻訴訟': 'Marriage litigation', '親子訴訟': 'Parent–child litigation', '其他家事訴訟': 'Other family litigation', '再審': 'Retrial',
    '第三人撤銷訴訟': 'Third-party revocation', '抗告程序': 'Interlocutory appeals', '調解程序': 'Mediation', '暫時處分': 'Interim orders',
    '調解裁定': 'Mediation rulings', '婚姻非訟': 'Marriage (non-contentious)', '親子非訟': 'Parent–child (non-contentious)', '收養': 'Adoption',
    '監護及輔助宣告': 'Guardianship and assistance', '失蹤人財產管理': 'Missing persons’ property', '宣告死亡': 'Declaration of death',
    '繼承非訟': 'Inheritance', '保護安置': 'Protective placement', '精神衛生法聲請事件': 'Mental Health Act petitions',
    '其他家事非訟': 'Other non-contentious', '保護令聲請事件': 'Protection order petitions', '履行勸告事件': 'Compliance advisories',
    '保全程序': 'Provisional remedies', '公示催告': 'Public summons', '其他事件': 'Other matters',
    // 未結案件經過時間（表56）
    '未滿二月': '< 2 months', '二月～三月': '2–3 months', '三月～六月': '3–6 months', '六月～九月': '6–9 months',
    '九月～一年': '9–12 months', '一年～一年半': '1–1.5 years', '一年半～二年': '1.5–2 years', '二年～三年': '2–3 years',
    '三年～四年': '3–4 years', '四年～五年': '4–5 years', '五年～十年': '5–10 years', '十年以上': '10+ years',
  };

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  window.I18N = {
    lang, EN,
    /** 依語言挑選字串 */
    t: (zh, en) => (EN ? en : zh),
    /** 資料標籤英譯，查無則回傳原文 */
    label: (s) => (EN ? (LABEL[s] ?? s) : s),
    court: (shortZh) => (EN ? (COURT[shortZh] ?? shortZh) : shortZh),
    MON,
  };

  // 套用靜態文字（本檔放在 app.js 前、頁面內容之後載入）
  if (EN) {
    document.title = 'Taiwan Judicial Statistics';
    const md = document.querySelector('meta[name="description"]');
    if (md) md.content = 'Charts that explain Taiwan’s court caseloads: overall trends, criminal cases, protection orders, consumer debt, juvenile cases and surveillance.';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const v = STATIC[el.dataset.i18n];
      if (v != null) el.innerHTML = v;
    });
    const aria = { '#themeBtn': 'Toggle light / dark mode', '.tabs': 'Sections', '.linkbar': 'Overview chart filters' };
    Object.entries(aria).forEach(([sel, v]) => document.querySelector(sel)?.setAttribute('aria-label', v));
  }

  // 語言按鈕：切換後重新載入，所有圖表與文字一次換好
  const btn = document.getElementById('langBtn');
  if (btn) {
    btn.textContent = EN ? '中文' : 'EN';
    btn.setAttribute('lang', EN ? 'zh-Hant-TW' : 'en');
    btn.setAttribute('aria-label', EN ? '切換為中文' : 'Switch to English');
    btn.addEventListener('click', () => {
      const next = EN ? 'zh' : 'en';
      try { localStorage.setItem('lang', next); } catch (e) {}
      const u = new URL(location.href);
      u.searchParams.set('lang', next);
      location.href = u.toString();
    });
  }
})();
