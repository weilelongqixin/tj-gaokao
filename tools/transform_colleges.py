#!/usr/bin/env python3
# transform_colleges.py — 把 raw 抓取数据转成 app 使用的 colleges.json
#
# 优先使用全量数据 colleges_full.ndjson（若存在），否则回退到 colleges_raw.json。
# 跨年合并键：院校 + 规范化选科要求（专业组代码每年格式/编号不一致，不可靠）。

import json, os, sys, re

RAW_DIR = "/Users/le/ZCodeProject/tj-gaokao/data/colleges/raw"
OUT = "/Users/le/ZCodeProject/tj-gaokao/data/colleges/colleges.json"

def norm_subj(s):
    if not s:
        return "不限"
    s = str(s).strip()
    if s == "" or "不限" in s:
        return "不限"
    s = s.replace("（", "(").replace("）", ")")
    s = re.sub(r"\s+", "", s)
    s = s.replace("均须", "").replace("均须选考", "")
    return s

def load_raw():
    ndjson = os.path.join(RAW_DIR, "colleges_full.ndjson")
    old = os.path.join(RAW_DIR, "colleges_raw.json")
    if os.path.exists(ndjson):
        print(f"使用全量数据：{ndjson}")
        out = []
        with open(ndjson, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except Exception:
                        pass
        # 只保留在天津有数据的
        return [r for r in out if r.get("has_tj")]
    if os.path.exists(old):
        print(f"使用旧数据：{old}")
        return json.load(open(old, encoding="utf-8"))
    print("raw 数据不存在，先运行 fetch_colleges_full.py")
    sys.exit(1)

def main():
    raw = load_raw()
    out = []
    skip_no_rank = 0
    for sch in raw:
        college = sch["college"]
        location = sch.get("city") or sch.get("province") or ""
        level = sch.get("level") or ""
        hist = sch.get("hist") or {}
        merged = {}
        for y in ["2023", "2024", "2025"]:
            ydata = hist.get(y)
            if not isinstance(ydata, dict):
                continue
            for gc, g in ydata.items():
                minRank = g.get("minRank")
                minScore = g.get("minScore")
                if minRank is None and minScore is None:
                    continue
                subj_raw = g.get("subjectReq") or "不限"
                key = norm_subj(subj_raw)
                slot = merged.setdefault(key, {
                    "subjectReq": subj_raw, "groupName": gc, "hist": {}, "_majors": [],
                })
                exist = slot["hist"].get(y)
                if exist is None or (
                    isinstance(minRank, int) and
                    (exist.get("minRank") is None or minRank < exist["minRank"])
                ):
                    slot["hist"][y] = {"minScore": minScore, "minRank": minRank}
                    slot["groupName"] = gc
                    if g.get("majors"):
                        slot["_majors"] = g["majors"]
                slot["subjectReq"] = subj_raw
        for key, slot in merged.items():
            has_rank = any(v.get("minRank") for v in slot["hist"].values())
            if not has_rank:
                skip_no_rank += 1
                continue
            gname = slot["_majors"][0] if slot["_majors"] else slot["groupName"]
            rec = {
                "college": college, "location": location, "level": level,
                "groupCode": slot["groupName"], "groupName": gname,
                "subjectReq": slot["subjectReq"], "hist": slot["hist"],
            }
            out.append(rec)
    def sort_key(r):
        h = r["hist"].get("2025") or r["hist"].get("2024") or r["hist"].get("2023") or {}
        rk = h.get("minRank")
        return (rk if isinstance(rk, int) else 10**9)
    out.sort(key=lambda r: (r["college"], sort_key(r)))
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    colleges = set(r["college"] for r in out)
    by_year = {}
    multi = 0
    for r in out:
        for y in r["hist"]:
            by_year[y] = by_year.get(y, 0) + 1
        if len(r["hist"]) >= 2:
            multi += 1
    print(f"转换完成：{len(out)} 个专业组，{len(colleges)} 所院校（跳过 {skip_no_rank} 个无位次）")
    print(f"各年有数据专业组：{by_year} | 两年及以上：{multi}")
    # 位次覆盖范围
    ranks = [r["hist"].get("2025",{}).get("minRank") or r["hist"].get("2024",{}).get("minRank") or r["hist"].get("2023",{}).get("minRank") for r in out]
    ranks = [x for x in ranks if isinstance(x,int)]
    if ranks:
        print(f"位次覆盖：最高分(位次最小){min(ranks)}名 ~ 最低分(位次最大){max(ranks)}名")

if __name__ == "__main__":
    main()
