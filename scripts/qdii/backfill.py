"""一次性回填新基金的限额历史（2026-11-16）：列出东方财富公告列表里的限额公告，逐份解析，输出供人工核对。

用法：python scripts/qdii/backfill.py out.json 016532:2022-09-01 018064:2023-05-01 ...
每份限额公告给出解析结果或错误，并附正文里与金额相关的片段；另附最新一份定期报告的份额。
"""

import importlib.util
from io import BytesIO
import json
from pathlib import Path
import re
import sys

from pypdf import PdfReader

spec = importlib.util.spec_from_file_location("disclosures", Path(__file__).with_name("refresh-disclosures.py"))
rd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rd)


def notices(code, since):
    rows = []
    for page in range(1, 40):
        response = json.loads(rd.download(
            f"https://api.fund.eastmoney.com/f10/JJGG?fundcode={code}&pageIndex={page}&pageSize=50&type=0"))
        batch = response["Data"] if isinstance(response.get("Data"), list) else []
        rows.extend(row for row in batch if row["PUBLISHDATEDesc"] >= since)
        if len(batch) < 50 or batch[-1]["PUBLISHDATEDesc"] < since:
            break
    return sorted(rows, key=lambda row: (row["PUBLISHDATEDesc"], row["ID"]))


def snippet(body):
    spots = [m.start() for m in re.finditer(r"限制申购金额|不超过|不得超过|不应超过|限额为|上限为|暂停申购|恢复", body)]
    return " … ".join(body[max(0, s - 60):s + 90] for s in spots[:6])[:900]


def main():
    out = Path(sys.argv[1])
    result = {}
    for item in sys.argv[2:]:
        code, since = item.split(":")
        entries, reports, opened = [], [], None
        for notice in notices(code, since):
            title, published, identifier = notice["TITLE"], notice["PUBLISHDATEDesc"], notice["ID"]
            if not re.fullmatch(r"AN\d+", identifier):
                continue
            source = f"https://pdf.dfcfw.com/pdf/H2_{identifier}_1.pdf"
            if opened is None and re.search(r"开放日常申购|开放申购|基金合同生效", title):
                opened = {"date": published, "title": title, "source": source}
            if rd.REPORT_TITLE.search(title):
                reports.append((published, title, source))
                continue
            if not rd.CAP_TITLE.search(title):
                continue
            entry = {"date": published, "title": title, "source": source}
            if "继续暂停" in title or rd.HOLIDAY.search(title) or "销售机构" in title or "转换业务" in title:
                entry["skipped"] = "节假日或非限额公告"
                entries.append(entry)
                continue
            try:
                body = rd.compact("".join(page.extract_text() or "" for page in PdfReader(BytesIO(rd.download(source))).pages))
                entry["snippet"] = snippet(body)
                parsed = rd.parse_limit(title, body, code, published)
                entry["parsed"] = list(parsed) if parsed else None
            except Exception as error:
                entry["error"] = str(error)
            entries.append(entry)
            print(code, published, entry.get("parsed", entry.get("error")), title, flush=True)
        shares = None
        for published, title, source in reversed(reports):
            try:
                body = rd.compact("".join(page.extract_text() or "" for page in PdfReader(BytesIO(rd.download(source))).pages))
                shares = rd.parse_shares(body, published, source)
                break
            except Exception as error:
                print(code, "份额报告解析失败", published, title, error, flush=True)
        result[code] = {"opened": opened, "shares": shares, "notices": entries}
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
