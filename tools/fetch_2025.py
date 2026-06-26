#!/usr/bin/env python3
# fetch_2025.py — 增量补抓 2025 年院校录取数据
# 复用已有的全量院校清单(_school_list_full.json)，只补 2025 年的专业组数据，
# 合并进现有的 colleges_full.ndjson。

import urllib.request, urllib.parse, json, time, os, random

RAW_DIR = "/Users/le/ZCodeProject/tj-gaokao/data/colleges/raw"
NDJSON = os.path.join(RAW_DIR, "colleges_full.ndjson")
LIST_FILE = os.path.join(RAW_DIR, "_school_list_full.json")

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

def http_json(url, timeout=20, retries=5):
    last=None
    for i in range(retries):
        try:
            req=urllib.request.Request(url, headers=HEADERS)
            return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8"))
        except Exception as e:
            last=e; time.sleep(min((2**i)+random.random(), 30))
    raise last

def fetch_all_pages(school, year):
    all_dl=[]; pn=1
    while True:
        base="https://gaokao.baidu.com/gk/gkschool/majorscore"
        qs=urllib.parse.urlencode({"rn":20,"curriculum":"3+3综合","subject":"","sortType":"","version":"2","needFilter":"1","school":school,"province":"天津","year":str(year),"pn":pn})
        r=http_json(base+"?"+qs)
        ms=(r.get("data") or {}).get("major_score",{}) or {}
        dl=ms.get("dataList",[]) or []
        all_dl.extend(dl)
        if not ms.get("pageInfo",{}).get("hasNext"): break
        pn+=1
        if pn>20: break
        time.sleep(0.15)
    return all_dl

def aggregate(datalist):
    groups={}
    for d in datalist:
        batch=d.get("batchName") or ""
        if "本科" not in batch: continue
        grp=d.get("majorGroup") or "专业组"
        ms=d.get("minScore"); mr=d.get("minScoreOrder")
        subj=d.get("specialCourse") or d.get("simplifySpecialCourse") or ""
        try:
            s=int(ms) if ms and str(ms).strip().isdigit() else None
            rk=int(mr) if mr and str(mr).strip().isdigit() else None
        except: s,rk=None,None
        g=groups.setdefault(grp,{"minScore":None,"minRank":None,"subjectReq":subj,"majors":[]})
        if d.get("majorName"): g["majors"].append(d["majorName"])
        if s is not None and (g["minScore"] is None or s<g["minScore"]):
            g["minScore"]=s; g["minRank"]=rk if rk is not None else g["minRank"]; g["subjectReq"]=subj or g["subjectReq"]
        if rk is not None and g["minRank"] is None: g["minRank"]=rk
    for g in groups.values(): g["majors"]=list(dict.fromkeys(g["majors"]))[:8]
    return groups

def main():
    # 读取现有 ndjson 到 dict（按院校名）
    records={}
    if os.path.exists(NDJSON):
        for line in open(NDJSON, encoding="utf-8"):
            line=line.strip()
            if line:
                r=json.loads(line); records[r["college"]]=r
    print(f"现有院校记录: {len(records)}")

    # 读取清单
    targets=json.load(open(LIST_FILE, encoding="utf-8"))
    print(f"清单院校: {len(targets)}，开始补抓 2025...")

    updated=0; new_tj=0
    for idx, sch in enumerate(targets, 1):
        name=sch["college"]
        try:
            dl=fetch_all_pages(name, 2025)
            groups=aggregate(dl)
            rec=records.get(name) or {**sch, "hist":{}, "has_tj":False}
            if groups:
                rec["hist"]["2025"]=groups
                if not rec.get("has_tj"): rec["has_tj"]=True; new_tj+=1
                records[name]=rec; updated+=1
        except Exception as e:
            pass
        time.sleep(0.2)
        if idx%50==0:
            print(f"  进度 {idx}/{len(targets)}，已补2025数据 {updated} 所", flush=True)

    # 写回 ndjson（全量覆盖）
    with open(NDJSON, "w", encoding="utf-8") as f:
        for r in records.values():
            f.write(json.dumps(r, ensure_ascii=False)+"\n")
    print(f"✅ 完成：补充2025数据 {updated} 所，新增有天津数据的 {new_tj} 所")

if __name__=="__main__":
    main()
