#!/usr/bin/env python3
# fetch_colleges.py — 批量抓取院校在天津的专业组录取数据
# 数据源：百度高考公开 API（gaokao.baidu.com）
# 策略：拉取院校清单 → 筛选 985/211/双一流 + 天津本地 → 抓 2023/2024 专业组数据

import urllib.request, urllib.parse, json, time, sys, os

OUT = "/Users/le/ZCodeProject/tj-gaokao/data/colleges/raw"
os.makedirs(OUT, exist_ok=True)

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

def http_json(url, timeout=15, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            resp = urllib.request.urlopen(req, timeout=timeout)
            return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(1.5 * (i + 1))

def fetch_schools_page(pn, rn=50):
    base = "https://gaokao.baidu.com/gk/gkschool/list"
    qs = urllib.parse.urlencode({"rn": rn, "pn": pn})
    return http_json(base + "?" + qs)

def fetch_major(school, year, province="天津", pn=1, rn=100):
    base = "https://gaokao.baidu.com/gk/gkschool/majorscore"
    qs = urllib.parse.urlencode({
        "rn": rn, "curriculum": "3+3综合", "subject": "", "sortType": "",
        "version": "2", "needFilter": "1",
        "school": school, "province": province, "year": str(year), "pn": pn
    })
    return http_json(base + "?" + qs)

def is_target(tags, province):
    # 985/211/双一流，或天津本地
    if province == "天津":
        return True
    tagset = set(tags or [])
    if tagset & {"985", "211", "双一流"}:
        return True
    return False

def main():
    # 阶段1：拉取院校清单并筛选
    print("[1] 拉取院校清单...", flush=True)
    targets = []
    seen = set()
    pn = 1
    rn = 10  # API 实际每页返回 10 条
    max_pages = 350  # 10*350=3500，覆盖全部 3052 所
    while pn <= max_pages:
        try:
            r = fetch_schools_page(pn, rn)
            pi = r["data"]["pageInfo"]
            trow = r["data"]["ranking"].get("tRow")
        except Exception as e:
            print(f"    [warn] 院校清单第{pn}页失败: {e}", flush=True)
            break
        if not trow:
            break
        for t in trow:
            name = t["college_name"]
            if name in seen:
                continue
            if is_target(t.get("tag"), t.get("province")):
                seen.add(name)
                targets.append({
                    "college": name,
                    "province": t.get("province"),
                    "city": t.get("city"),
                    "location": t.get("location"),
                    "level": ",".join(t.get("tag", []) or []),
                    "school_type": t.get("school_type"),
                    "nature": t.get("nature"),
                })
        if not pi.get("hasNext"):
            break
        pn += 1
        if pn % 50 == 0:
            print(f"    清单翻页 {pn}，已筛出目标 {len(targets)} 所", flush=True)
    print(f"    筛选出目标院校 {len(targets)} 所", flush=True)
    # 保存清单
    json.dump(targets, open(os.path.join(OUT, "_school_list.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    # 阶段2：逐校抓取 2023/2024 专业组数据
    print("[2] 抓取各校在天津的专业组录取数据...", flush=True)
    all_records = []
    for idx, sch in enumerate(targets, 1):
        name = sch["college"]
        rec = dict(sch)
        rec["hist"] = {}
        got_any = False
        for year in [2024, 2023]:
            try:
                r = fetch_major(name, year)
                ms = r.get("data", {}).get("major_score", {}) or {}
                dl = ms.get("dataList", []) or []
                # 过滤：仅本科批A段普通类（天津本科主要批次）
                groups = {}  # majorGroup -> aggregated
                for d in dl:
                    batch = d.get("batchName") or ""
                    if "本科" not in batch:
                        continue
                    grp = d.get("majorGroup") or "专业组"
                    minScore = d.get("minScore")
                    minRank = d.get("minScoreOrder")
                    subj = d.get("specialCourse") or d.get("simplifySpecialCourse") or ""
                    majors = groups.setdefault(grp, {"minScore": None, "minRank": None, "subj": subj, "majors": []})
                    majors["majors"].append(d.get("majorName"))
                    try:
                        s = int(minScore) if minScore else None
                        rk = int(minRank) if minRank else None
                    except:
                        s, rk = None, None
                    # 取该组最低分/位次作为组录取线
                    if s is not None:
                        if majors["minScore"] is None or s < majors["minScore"]:
                            majors["minScore"] = s
                            majors["minRank"] = rk if rk else majors["minRank"]
                            majors["subj"] = subj or majors["subj"]
                    if rk is not None and majors["minRank"] is None:
                        majors["minRank"] = rk
                if groups:
                    rec["hist"][str(year)] = {
                        g: {"minScore": v["minScore"], "minRank": v["minRank"],
                            "subjectReq": v["subj"], "majors": list(set(v["majors"]))[:8]}
                        for g, v in groups.items()
                    }
                    got_any = True
            except Exception as e:
                print(f"    [warn] {name} {year}: {e}", flush=True)
            time.sleep(0.25)
        if got_any:
            all_records.append(rec)
        if idx % 10 == 0:
            print(f"    进度 {idx}/{len(targets)}，已收录 {len(all_records)} 所", flush=True)

    json.dump(all_records, open(os.path.join(OUT, "colleges_raw.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"[done] 共收录 {len(all_records)} 所有录取数据的院校", flush=True)

if __name__ == "__main__":
    main()
