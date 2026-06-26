#!/usr/bin/env python3
# fetch_colleges_full.py — 全量抓取所有院校在天津的专业组录取数据
#
# 与 fetch_colleges.py 区别：
#   1. 不筛选院校，抓取清单中全部 3052 所（实际只在天津有数据的会被收录）
#   2. 支持分页：每页 20 条，多专业组院校翻页取全
#   3. 断点续传：每抓完一所即增量追加到 ndjson，重跑自动跳过已抓院校
#   4. 限流容错：429/超时自动退避重试
#
# 用法：python3 fetch_colleges_full.py
# 中途可 Ctrl+C，再运行会从断点继续。

import urllib.request, urllib.parse, json, time, os, sys, random

OUT_DIR = "/Users/le/ZCodeProject/tj-gaokao/data/colleges/raw"
NDJSON = os.path.join(OUT_DIR, "colleges_full.ndjson")  # 增量断点文件
LIST_FILE = os.path.join(OUT_DIR, "_school_list_full.json")
PROGRESS_FILE = os.path.join(OUT_DIR, "_progress.json")
os.makedirs(OUT_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

def http_json(url, timeout=20, retries=5):
    last_err = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            resp = urllib.request.urlopen(req, timeout=timeout)
            return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            last_err = e
            # 退避：逐次加长 + 随机抖动，避免被限流
            backoff = (2 ** i) + random.random()
            time.sleep(min(backoff, 30))
    raise last_err

def fetch_schools_page(pn, rn=10):
    base = "https://gaokao.baidu.com/gk/gkschool/list"
    qs = urllib.parse.urlencode({"rn": rn, "pn": pn})
    return http_json(base + "?" + qs)

def fetch_major_page(school, year, pn, rn=20):
    base = "https://gaokao.baidu.com/gk/gkschool/majorscore"
    qs = urllib.parse.urlencode({
        "rn": rn, "curriculum": "3+3综合", "subject": "", "sortType": "",
        "version": "2", "needFilter": "1",
        "school": school, "province": "天津", "year": str(year), "pn": pn
    })
    return http_json(base + "?" + qs)

def fetch_all_major_pages(school, year):
    """抓取某校某年在天津的全部专业组数据（自动翻页）"""
    all_dl = []
    pn = 1
    while True:
        r = fetch_major_page(school, year, pn)
        ms = (r.get("data") or {}).get("major_score", {}) or {}
        dl = ms.get("dataList", []) or []
        all_dl.extend(dl)
        pi = ms.get("pageInfo", {}) or {}
        if not pi.get("hasNext"):
            break
        pn += 1
        if pn > 20:  # 安全阀，单校单年最多 400 条，足够
            break
        time.sleep(0.15)
    return all_dl

def aggregate_groups(datalist):
    """把专业级数据聚合成专业组级（按 majorGroup 取每组最低分/位次）"""
    groups = {}
    for d in datalist:
        batch = d.get("batchName") or ""
        if "本科" not in batch:  # 只保留本科批次
            continue
        grp = d.get("majorGroup") or "专业组"
        minScore = d.get("minScore")
        minRank = d.get("minScoreOrder")
        subj = d.get("specialCourse") or d.get("simplifySpecialCourse") or ""
        try:
            s = int(minScore) if minScore and str(minScore).strip().isdigit() else None
            rk = int(minRank) if minRank and str(minRank).strip().isdigit() else None
        except Exception:
            s, rk = None, None
        g = groups.setdefault(grp, {"minScore": None, "minRank": None, "subjectReq": subj, "majors": []})
        if d.get("majorName"):
            g["majors"].append(d["majorName"])
        if s is not None:
            if g["minScore"] is None or s < g["minScore"]:
                g["minScore"] = s
                g["minRank"] = rk if rk is not None else g["minRank"]
                g["subjectReq"] = subj or g["subjectReq"]
        if rk is not None and g["minRank"] is None:
            g["minRank"] = rk
    # 去重专业名
    for g in groups.values():
        g["majors"] = list(dict.fromkeys(g["majors"]))[:8]
    return groups

def load_done_set():
    """读取已抓取的院校名集合（断点续传）"""
    done = set()
    if os.path.exists(NDJSON):
        with open(NDJSON, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        done.add(json.loads(line)["college"])
                    except Exception:
                        pass
    return done

def main():
    # 阶段1：拉取全量院校清单
    if os.path.exists(LIST_FILE):
        targets = json.load(open(LIST_FILE, encoding="utf-8"))
        print(f"[1] 已有院校清单 {len(targets)} 所，跳过拉取", flush=True)
    else:
        print("[1] 拉取全量院校清单（3052所，约需2分钟）...", flush=True)
        targets = []
        seen = set()
        pn = 1
        while pn <= 400:
            try:
                r = fetch_schools_page(pn)
                pi = r["data"]["pageInfo"]
                trow = r["data"]["ranking"].get("tRow")
            except Exception as e:
                print(f"    [warn] 清单第{pn}页失败: {e}", flush=True)
                time.sleep(2)
                pn += 1
                continue
            if not trow:
                break
            for t in trow:
                name = t["college_name"]
                if name in seen:
                    continue
                seen.add(name)
                targets.append({
                    "college": name,
                    "province": t.get("province"),
                    "city": t.get("city"),
                    "location": t.get("location"),
                    "level": ",".join(t.get("tag", []) or []),
                    "school_type": t.get("school_type"),
                    "nature": t.get("nature"),
                    "education": t.get("education"),
                })
            if not pi.get("hasNext"):
                break
            pn += 1
            if pn % 50 == 0:
                print(f"    清单翻页 {pn}，累计 {len(targets)} 所", flush=True)
        json.dump(targets, open(LIST_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"    清单完成：{len(targets)} 所", flush=True)

    # 阶段2：逐校抓取（断点续传）
    done = load_done_set()
    print(f"[2] 开始抓取专业组数据。已完成 {len(done)} 所，待抓 {len(targets)-len(done)} 所", flush=True)
    # 以追加模式打开 ndjson
    out_f = open(NDJSON, "a", encoding="utf-8")
    total = len(targets)
    collected = len(done)
    t0 = time.time()
    for idx, sch in enumerate(targets, 1):
        name = sch["college"]
        if name in done:
            continue
        rec = dict(sch)
        rec["hist"] = {}
        got_any = False
        for year in [2024, 2023]:
            try:
                dl = fetch_all_major_pages(name, year)
                groups = aggregate_groups(dl)
                if groups:
                    rec["hist"][str(year)] = groups
                    got_any = True
            except Exception as e:
                # 单校失败不影响整体，记录后继续
                pass
            time.sleep(0.2)
        # 即使无天津数据也记录（标记 notj=True），避免重跑时反复请求
        rec["has_tj"] = got_any
        out_f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        out_f.flush()
        collected += 1
        if collected % 20 == 0:
            elapsed = time.time() - t0
            rate = (collected - len(done)) / max(elapsed, 1)
            remain = (total - collected) / max(rate, 0.01)
            tj_count = sum(1 for _ in [1])  # placeholder
            print(f"    进度 {collected}/{total} ({collected*100//total}%) | "
                  f"速率 {rate:.1f}所/秒 | 预计剩余 {remain/60:.0f}分钟", flush=True)
    out_f.close()
    print(f"[done] 抓取完成，共 {collected} 所（含无天津数据的）", flush=True)
    print(f"原始数据：{NDJSON}", flush=True)

if __name__ == "__main__":
    main()
