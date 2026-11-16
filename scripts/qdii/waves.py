"""一次性回填（2026-11-16）：场外纳指100 / 标普500 QDII 全部基金的限额历史，用来研究「限额温度计」。
每个基金家族（A/C/I/D、人民币/美元合并）取一个代表份额，逐份解析限额公告。
用法：python scripts/qdii/waves.py out.json [起始日]
"""

import importlib.util
from io import BytesIO
import json
from pathlib import Path
import re
import sys
import time

from pypdf import PdfReader

spec = importlib.util.spec_from_file_location("disclosures", Path(__file__).with_name("refresh-disclosures.py"))
rd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rd)

INDEX = [("ndx", re.compile(r"纳斯达克100|纳指100|纳斯达克一百")), ("spx", re.compile(r"标普500|标准普尔500"))]
EXCLUDE = re.compile(r"等权|增强|科技|信息|红利|价值|成长|动量|质量|做多|杠杆")
CLASS_TAIL = re.compile(r"(?:[ACDEFIH]类?)?(?:\(?(?:人民币|美元|美钞|美汇|现汇)(?:份额)?\)?)?$")


def get(url):
    for attempt in range(4):
        try:
            return rd.download(url)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))


def families():
    text = get("https://fund.eastmoney.com/js/fundcode_search.js").decode("utf-8")
    rows = json.loads(text[text.index("["):text.rindex("]") + 1])
    groups = {}
    for code, _, name, kind, *_ in rows:
        index = next((key for key, pattern in INDEX if pattern.search(name)), None)
        if not index or "QDII" not in name + kind or EXCLUDE.search(name):
            continue
        if re.search(r"ETF", name) and not re.search(r"联接", name):
            continue  # 场内 ETF 没有每人每日限额
        key = name
        for _ in range(3):
            key = CLASS_TAIL.sub("", key)
        groups.setdefault((index, key), []).append((code, name))
    out = []
    for (index, key), members in sorted(groups.items()):
        rank = lambda m: (bool(re.search(r"美元|美钞|美汇|现汇", m[1])), not re.search(r"A|\)$|指数$|联接$", m[1][-6:]), m[0])
        code, name = sorted(members, key=rank)[0]
        out.append({"index": index, "family": key, "code": code, "name": name, "members": [m[0] for m in members]})
    return out


def notices(code, since):
    rows = []
    for page in range(1, 60):
        response = json.loads(get(f"https://api.fund.eastmoney.com/f10/JJGG?fundcode={code}&pageIndex={page}&pageSize=50&type=0"))
        batch = response["Data"] if isinstance(response.get("Data"), list) else []
        rows.extend(batch)
        if len(batch) < 50 or batch[-1]["PUBLISHDATEDesc"] < since:
            break
    return sorted(rows, key=lambda row: (row["PUBLISHDATEDesc"], row["ID"]))


def main():
    out, since = Path(sys.argv[1]), (sys.argv[2] if len(sys.argv) > 2 else "2018-01-01")
    result = []
    for fam in families():
        code, opened, entries = fam["code"], None, []
        try:
            rows = notices(code, since)
        except Exception as error:
            print(code, "公告列表失败", error, flush=True)
            fam["error"] = str(error)
            result.append(fam)
            continue
        first = rows[0]["PUBLISHDATEDesc"] if rows else None
        for row in rows:
            title, published, identifier = row["TITLE"], row["PUBLISHDATEDesc"], row["ID"]
            if opened is None and re.search(r"开放日常申购|开放申购|基金合同生效", title):
                opened = published
            if published < since or not re.fullmatch(r"AN\d+", identifier) or not rd.CAP_TITLE.search(title):
                continue
            if rd.REPORT_TITLE.search(title):
                continue
            entry = {"date": published, "title": title}
            try:
                body = rd.compact("".join(p.extract_text() or "" for p in PdfReader(BytesIO(get(f"https://pdf.dfcfw.com/pdf/H2_{identifier}_1.pdf"))).pages))
                parsed = rd.parse_limit(title, body, code, published)
                if parsed is None:
                    continue
                entry["effective"], entry["cap"] = parsed
            except Exception as error:
                entry["error"] = str(error)[:80]
                if "body" in locals():
                    spots = [m.start() for m in re.finditer(r"不超过|限额为|上限为|暂停申购|取消", body)]
                    entry["snippet"] = " … ".join(body[max(0, s - 50):s + 40] for s in spots[:3])[:300]
            body = ""
            entries.append(entry)
            print(code, published, entry.get("cap", entry.get("error")), title[:60], flush=True)
        result.append({**fam, "opened": opened or first, "firstNotice": first, "notices": entries})
        out.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n")
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
