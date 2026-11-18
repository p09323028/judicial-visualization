"""把「月報」資料夾內各月份的司法統計 Excel 表轉成網站用的 JSON。

用法：python scripts/build_data.py
- 讀取 月報/115MM/表NN.xlsx（只處理 TABLES 內列出的表）
- 依月份由舊到新處理，新一期的數字覆蓋舊一期（以最新修正數為準）
- 輸出到 site/data/tNN.json 與 site/data/meta.json
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "月報"
OUT = ROOT / "site" / "data"

# 網站有用到的表
TABLES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 38, 39,
          41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56]

LABEL_HEADS = {"年(月)別", "機關別", "罪名別", "經過時間", "年(月)別及訴訟程序別"}
STOP_PREFIX = ("說明", "註", "①", "②", "③", "“", "Note")
RE_YEAR = re.compile(r"^民國(\d{2,3})年$")
RE_MONTH = re.compile(r"^(\d{1,2})月$")
RE_PERIOD = re.compile(r"^\d{2,3}年[\d\-－~～至]+月")
RE_RANGE_ROW = re.compile(r"^\d{1,2}[\-－~～至]\d{1,2}月$")  # 半年報的「1-6月」累計列，略過

warnings: list[str] = []
notes: list[str] = []


def zh(v) -> str:
    """取儲存格的中文部分（遇到第一個英文字母就截斷），去空白與註記符號。"""
    if v is None or not isinstance(v, str):
        return ""
    s = v.replace("\n", " ").strip()
    m = re.match(r"^[^A-Za-z]*", s)
    s = m.group(0) if m else ""
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[①②③④⑤（(]*$", "", s) if s.endswith(("(", "（")) else s
    s = re.sub(r"[①②③④⑤]", "", s)
    return s.strip("_")


def clean_label(v) -> str:
    s = zh(v)
    s = re.sub(r"[\d_]+$", "", s) if not RE_MONTH.match(s) and not RE_YEAR.match(s) else s
    return s


def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def grid(ws):
    g = [[c.value for c in row] for row in ws.iter_rows()]
    for rng in ws.merged_cells.ranges:
        v = g[rng.min_row - 1][rng.min_col - 1]
        for r in range(rng.min_row, rng.max_row + 1):
            for c in range(rng.min_col, rng.max_col + 1):
                g[r - 1][c - 1] = v
    return g


def row_label(row) -> str:
    for c in row[:2]:
        s = clean_label(c)
        if s:
            return s
    return ""


def has_numbers(row) -> bool:
    return any(is_num(v) for v in row[1:])


def parse_sheet(ws):
    """回傳 (title, period, columns, rows)；rows 為 [(label, {col: value}), ...]。"""
    g = grid(ws)
    if not g:
        return None
    title = ""
    for v in g[0]:
        if zh(v):
            title = zh(v)
            break
    period = ""
    for r in g[1:5]:
        for v in r:
            s = zh(v) if isinstance(v, str) else ""
            if RE_PERIOD.match(s):
                period = s
                break

    # 第一列資料：有標籤且有數字（第 1 列以後）
    first = None
    for i, r in enumerate(g):
        if i < 2:
            continue
        lab = row_label(r)
        if lab and lab not in LABEL_HEADS and has_numbers(r):
            first = i
            break
    if first is None:
        return None
    # 往回找無數字的分段標題列（如表54「最高法院」）
    start = first
    while start - 1 > 2:
        r = g[start - 1]
        lab = row_label(r)
        if lab and lab not in LABEL_HEADS and not has_numbers(r) and not any(
            zh(v) in LABEL_HEADS for v in r
        ):
            start -= 1
        else:
            break

    ncol = max(len(r) for r in g)
    header_rows = []
    for r in g[1:start]:
        texts = [zh(v) for v in r if isinstance(v, str) and zh(v)]
        if not texts:
            continue
        if all(t.startswith("單位") or RE_PERIOD.match(t) or t == title for t in texts):
            continue
        header_rows.append(r)

    columns: dict[int, str] = {}
    seen: dict[str, int] = {}
    for c in range(1, ncol):
        parts: list[str] = []
        for r in header_rows:
            v = r[c] if c < len(r) else None
            s = zh(v)
            if not s or s in LABEL_HEADS or s.startswith(("單位", "§")) or RE_PERIOD.match(s):
                continue
            if re.fullmatch(r"[\d\W_]+", s):  # 表頭上的註腳數字
                continue
            if parts and parts[-1] == s:
                continue
            if s in parts:
                continue
            parts.append(s)
        if not parts:
            continue
        name = "/".join(parts)
        if name in seen:
            seen[name] += 1
            name = f"{name}#{seen[name]}"
        else:
            seen[name] = 1
        columns[c] = name

    rows = []
    section = ""
    for r in g[start:]:
        lab = row_label(r)
        if not lab:
            continue
        if lab.startswith(STOP_PREFIX) or lab in LABEL_HEADS:
            if lab.startswith(STOP_PREFIX):
                break
            continue
        if not has_numbers(r):
            # 分段標題（若後面整列都是 '-' 也會被當成分段，影響不大）
            if not any(isinstance(r[c], str) and r[c].strip() == "-" for c in columns if c < len(r)):
                section = lab
                continue
        vals = {}
        for c, name in columns.items():
            v = r[c] if c < len(r) else None
            if is_num(v):
                vals[name] = round(v, 4) if isinstance(v, float) else v
            elif v is None or (isinstance(v, str) and v.strip() == ""):
                vals[name] = 0
            else:
                vals[name] = None  # '-' 等無法計算
        rows.append((lab, section, vals))
    return title, period, list(columns.values()), rows


def is_series(rows) -> bool:
    return any(RE_YEAR.match(lab) for lab, _, _ in rows)


def series_keys(rows):
    """把年別表的列轉成 key：Y115、115-09、MoM、YoY、X:標籤。"""
    year = None
    out = []
    for lab, _sec, vals in rows:
        m = RE_YEAR.match(lab)
        if m:
            year = int(m.group(1))
            out.append((f"Y:{year}", vals))
            continue
        m = RE_MONTH.match(lab)
        if m and year is not None:
            out.append((f"{year}-{int(m.group(1)):02d}", vals))
            continue
        if RE_RANGE_ROW.match(lab):
            continue
        if lab.startswith("本月與上月比較"):
            out.append(("MoM", vals))
        elif lab.startswith("本年累計與上年同期比較"):
            out.append(("YoY", vals))
        else:
            out.append((f"X:{lab}", vals))
    return out


def merge_dict(dst: dict, key: str, vals: dict):
    dst.setdefault(key, {}).update(vals)


def month_folders():
    fs = sorted(p for p in SRC.iterdir() if p.is_dir() and re.fullmatch(r"\d{5}", p.name))
    # 測試用：python scripts/build_data.py --until 11508 只處理到該月份
    if "--until" in sys.argv:
        until = sys.argv[sys.argv.index("--until") + 1]
        fs = [f for f in fs if f.name <= until]
    return fs


def period_of(folder: Path) -> str:
    return f"{int(folder.name[:3])}-{int(folder.name[3:]):02d}"


def build():
    folders = month_folders()
    if not folders:
        sys.exit("找不到 月報/YYYMM 資料夾")
    latest_period = period_of(folders[-1])
    tables: dict[int, dict] = {}

    for folder in folders:
        per = period_of(folder)
        for t in TABLES:
            f = folder / f"表{t:02d}.xlsx"
            if not f.exists():
                continue
            wb = openpyxl.load_workbook(f, data_only=True)
            parsed = [p for p in (parse_sheet(ws) for ws in wb.worksheets) if p]
            if not parsed:
                warnings.append(f"{f.relative_to(ROOT)} 無法解析")
                continue
            title = re.sub(r"[（(]續.*[)）]$", "", parsed[0][0])
            title = re.sub(r"^表[一二三四五六七八九十]+、", "", title)
            tbl = tables.setdefault(t, {"id": t, "title": title, "columns": []})
            tbl["title"] = title
            for _, _, cols, _ in parsed:
                for c in cols:
                    if c not in tbl["columns"]:
                        tbl["columns"].append(c)

            if is_series(parsed[0][3]):
                tbl["kind"] = "series"
                annual = tbl.setdefault("_annual", {})
                monthly = tbl.setdefault("monthly", {})
                file_rows: dict[str, dict] = {}
                for _, _, _, rows in parsed:
                    for key, vals in series_keys(rows):
                        merge_dict(file_rows, key, vals)
                years = [int(k[2:]) for k in file_rows if k.startswith("Y:")]
                cur_year = max(years)
                for key, vals in file_rows.items():
                    if key.startswith("Y:"):
                        y = int(key[2:])
                        if y < cur_year:
                            annual[str(y)] = vals
                        else:
                            tbl["ytd"] = {"year": y, "values": vals}
                    elif re.fullmatch(r"\d+-\d\d", key):
                        monthly[key] = vals
                    elif key in ("MoM", "YoY"):
                        tbl[key] = vals
                    else:
                        tbl.setdefault("extra", {})[key[2:]] = vals
                tbl["asOf"] = per
            else:
                tbl["kind"] = "snapshot"
                label = parsed[0][1] or ""
                y, mth = per.split("-")
                expect = f"{y}年{int(mth)}月"
                snap: dict[str, dict] = {}
                for _, _, _, rows in parsed:
                    for lab, sec, vals in rows:
                        key = f"{sec}/{lab}" if sec else lab
                        merge_dict(snap, key, vals)
                if label and not label.startswith(expect):
                    if re.match(rf"^{y}年1[\-－~～至]{int(mth)}月", label):
                        # 半年報等「1–N月累計」：先存起來，最後用「累計 − 前幾個月單月」推算 N 月
                        tbl.setdefault("_cum", {})[per] = snap
                        tbl.setdefault("cumulative", {})[per] = label
                    else:
                        warnings.append(f"{folder.name}/表{t:02d} 標示期別為「{label}」，與資料夾月份 {expect} 不符，已略過")
                    continue
                tbl.setdefault("months", {})[per] = snap
                tbl["asOf"] = per
                tbl.setdefault("periods", {})[per] = parsed[0][1] or ""

    # 整理輸出
    OUT.mkdir(parents=True, exist_ok=True)
    meta_tables = {}
    for t, tbl in sorted(tables.items()):
        if tbl.get("kind") == "series":
            tbl["annual"] = dict(sorted(tbl.pop("_annual").items(), key=lambda kv: int(kv[0])))
            tbl["monthly"] = dict(sorted(tbl["monthly"].items(), key=lambda kv: tuple(map(int, kv[0].split("-")))))
            validate_series(tbl)
        else:
            derive_from_cumulative(tbl)
            tbl["months"] = dict(sorted(tbl["months"].items()))
            validate_snapshot(tbl)
        (OUT / f"t{t:02d}.json").write_text(json.dumps(tbl, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        meta_tables[t] = {"title": tbl["title"], "kind": tbl["kind"], "asOf": tbl["asOf"]}

    y, m = latest_period.split("-")
    meta = {
        "latest": latest_period,
        "latestLabel": f"{y}年{int(m)}月",
        "built": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "months": [period_of(f) for f in folders],
        "tables": meta_tables,
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    # 同時輸出成 JS，讓網站直接用檔案開啟（file://）也能運作
    bundle = {"meta": meta, "tables": {f"t{t:02d}": tbl for t, tbl in tables.items()}}
    (OUT / "data.js").write_text("window.JUDICIAL_DATA=" + json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + ";", encoding="utf-8")

    print(f"完成：{len(tables)} 張表，最新期別 {meta['latestLabel']}，輸出至 {OUT.relative_to(ROOT)}")
    if notes:
        print(f"\n說明 {len(notes)} 則：")
        for n in notes:
            print("  -", n)
    if warnings:
        print(f"\n⚠ 驗證警告 {len(warnings)} 則：")
        for w in warnings:
            print("  -", w)
    else:
        print("驗證通過，沒有警告。")


FLOW_HINT = ("新收",)


def validate_series(tbl):
    """本年累計（新收）應等於各月加總。"""
    ytd = tbl.get("ytd")
    if not ytd:
        return
    y = ytd["year"]
    months = [v for k, v in tbl["monthly"].items() if k.startswith(f"{y}-")]
    for col, total in ytd["values"].items():
        if not col.endswith(FLOW_HINT) or not is_num(total):
            continue
        s = sum((mv.get(col) or 0) for mv in months)
        if abs(s - total) > 0.5:
            warnings.append(f"表{tbl['id']:02d}「{col}」{y}年累計 {total} ≠ 各月加總 {s}")


def column_kind(col: str) -> str:
    """判斷欄位能不能用「累計 − 前幾月加總」推算單月。

    flow   期間流量（新收、終結、核發、人數…）：可以相減
    stock  期末存量（未結、未結案件經過時間）：累計表的期末值就是該月底的值
    open   期初存量（舊受）與受理合計：用 舊受 = 未結 + 終結 − 新收 推回
    rate   比率、平均日數、每法官辦結件數：無法由累計還原（少數可重算者另外處理）
    """
    if "未結" in col:
        return "stock"
    if col.endswith(("舊受", "受理件數/合計", "受理人數/合計")):
        return "open"
    if any(k in col for k in ("率", "百分比", "日數", "平均", "占")):
        return "rate"
    return "flow"


# 可以用推算後的件數重算的比率：欄名 → (分子欄, 分母欄們)
RECOMPUTE_RATES = {
    "合計/緩刑率": ("合計/宣告緩刑人數", ["合計/宣告刑符合緩刑條件之被告人數"]),
    "少年被告/緩刑率": ("少年被告/宣告緩刑人數", ["少年被告/宣告刑符合緩刑條件之被告人數"]),
    "一般被告/緩刑率": ("一般被告/宣告緩刑人數", ["一般被告/宣告刑符合緩刑條件之被告人數"]),
    "核發件數占核發與駁回件數": ("終結件數/核發", ["終結件數/核發", "終結件數/駁回"]),
}


def derive_from_cumulative(tbl):
    """用「1–N月累計」減去 1～N−1 月單月，推算 N 月單月資料。"""
    cum = tbl.pop("_cum", None)
    if not cum:
        return
    months = tbl.setdefault("months", {})
    for per, snap in cum.items():
        y, m = map(int, per.split("-"))
        prev = [f"{y}-{k:02d}" for k in range(1, m)]
        missing = [p for p in prev if p not in months]
        if missing:
            warnings.append(f"表{tbl['id']:02d} {per} 為累計資料，但缺少 {', '.join(missing)} 單月，無法推算")
            continue
        out: dict[str, dict] = {}
        negatives = 0
        for row, vals in snap.items():
            r = {}
            for col, v in vals.items():
                kind = column_kind(col)
                if v is None:
                    r[col] = None
                elif kind == "flow":
                    before = [months[p].get(row, {}).get(col) for p in prev]
                    if any(b is None for b in before):
                        r[col] = None
                        continue
                    d = v - sum(before)
                    d = round(d, 4) if isinstance(d, float) else d
                    if d < 0:
                        negatives += 1
                        d = None
                    r[col] = d
                elif kind == "stock":
                    r[col] = v
                else:
                    r[col] = None  # open / rate 之後處理
            # 舊受 = 未結 + 終結 − 新收；受理合計 = 舊受 + 新收
            # 欄名可能帶前綴（如表44「少年法庭案件/受理件數/新收」），依前綴分組套用
            for new in [c for c in r if c.endswith(("受理件數/新收", "受理人數/新收"))]:
                base = new[: -len("/新收")]               # …/受理件數
                pre = base[: -len("受理件數")] if base.endswith("受理件數") else base[: -len("受理人數")]
                unit = "件數" if base.endswith("件數") else "人數"
                old, tot = f"{base}/舊受", f"{base}/合計"
                closed = next((c for c in (f"{pre}終結{unit}", f"{pre}終結{unit}/計", f"{pre}終結{unit}/合計") if c in r), None)
                pend = f"{pre}未結{unit}" if f"{pre}未結{unit}" in r else None
                if old in r and closed and pend and None not in (r[new], r[closed], r[pend]):
                    r[old] = r[pend] + r[closed] - r[new]
                    if tot in r:
                        r[tot] = r[old] + r[new]
            for col, (num, dens) in RECOMPUTE_RATES.items():
                if col in r:
                    nv, dv = r.get(num), [r.get(d) for d in dens]
                    r[col] = round(nv / sum(dv) * 100, 2) if nv is not None and None not in dv and sum(dv) else None
            out[row] = r
        months[per] = out
        tbl.setdefault("periods", {})[per] = f"{y}年{m}月 推算值"
        tbl.setdefault("derived", []).append(per)
        notes.append(f"表{tbl['id']:02d} {per} 由「{tbl['cumulative'][per]}」減去前 {m - 1} 個月推算" + (f"；{negatives} 個值為負數已留空" if negatives else ""))


def validate_snapshot(tbl):
    """機關別：各地方法院加總應等於「臺灣各地方法院計」。"""
    for per, snap in tbl["months"].items():
        total = snap.get("臺灣各地方法院計")
        if not total:
            continue
        courts = [v for k, v in snap.items() if k.startswith("臺灣") and k.endswith(("地方法院", "少家法院"))]
        for col, tv in total.items():
            if not is_num(tv) or not any(x in col for x in ("新收", "終結件數")) or "日數" in col:
                continue
            s = sum((c.get(col) or 0) for c in courts)
            if abs(s - tv) > 0.5:
                warnings.append(f"表{tbl['id']:02d} {per}「{col}」各院加總 {s} ≠ 臺灣各地方法院計 {tv}")


if __name__ == "__main__":
    build()
