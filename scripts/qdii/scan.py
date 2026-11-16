"""一次性扫描（2026-11-16）：场外纳指100 / 标普500 QDII 基金的限额调整频率，用来挑选代表性基金。
只看东方财富公告标题（不下载 PDF），另取最新定期报告的份额。
用法：python scripts/qdii/scan.py out.json [起始日]
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

INDEX = [("ndx", re.compile(r"纳斯达克100|纳指100|纳斯达克一百")), ("spx", re.compile(r"标普500|标准普尔500"))]
EXCLUDE = re.compile(r"等权|增强|美元|现汇|[CEFI]$|[CEFI]类|科技|信息|红利|价值|成长|动量|质量")


def candidates():
    text = rd.download("https://fund.eastmoney.com/js/fundcode_search.js").decode("utf-8")
    rows = json.loads(text[text.index("["):text.rindex("]") + 1])
    found = []
    for code, _, name, kind, *_ in rows:
        index = next((key for key, pattern in INDEX if pattern.search(name)), None)
        if not index or "QDII" not in name + kind:
            continue
        if re.search(r"ETF", name) and not re.search(r"联接", name):
            continue  # 场内 ETF 没有每人每日限额
        if EXCLUDE.search(name):
            continue
        found.append({"code": code, "name": name, "kind": kind, "index": index})
    return found


def classify(title):
    if "继续暂停" in title or rd.HOLIDAY.search(title) or ("暂停" in title and "赎回" in title):
        return "holiday"
    if re.search(r"借记卡|通联支付|直联|费率|销售机构|转换业务", title):
        return None
    if "直销" in title and not re.search(r"代销|非直销", title):
        return "direct"
    if not rd.CAP_TITLE.search(title):
        return None
    if "暂停申购" in title and "大额" not in title and "恢复" not in title:
        return "suspend"
    if "恢复" in title and not re.search(r"限制|大额|调整", title):
        return "resume"
    return "adjust"  # 调整 / 限制 / 暂停大额 / 恢复并限制：限额数字变化


def main():
    out, since = Path(sys.argv[1]), (sys.argv[2] if len(sys.argv) > 2 else "2023-01-01")
    result = []
    for fund in candidates():
        counts = {"adjust": 0, "suspend": 0, "resume": 0, "direct": 0, "holiday": 0}
        latest, report = None, None
        try:
            for page in range(1, 20):
                response = json.loads(rd.download(
                    f"https://api.fund.eastmoney.com/f10/JJGG?fundcode={fund['code']}&pageIndex={page}&pageSize=50&type=0"))
                batch = response["Data"] if isinstance(response.get("Data"), list) else []
                for row in batch:
                    if row["PUBLISHDATEDesc"] < since:
                        continue
                    if report is None and rd.REPORT_TITLE.search(row["TITLE"]):
                        report = row
                    kind = classify(row["TITLE"])
                    if kind:
                        counts[kind] += 1
                        if kind in ("adjust", "suspend", "resume") and latest is None:
                            latest = {"date": row["PUBLISHDATEDesc"], "kind": kind, "title": row["TITLE"]}
                if len(batch) < 50 or batch[-1]["PUBLISHDATEDesc"] < since:
                    break
            shares = None
            if report:
                source = f"https://pdf.dfcfw.com/pdf/H2_{report['ID']}_1.pdf"
                body = rd.compact("".join(p.extract_text() or "" for p in PdfReader(BytesIO(rd.download(source))).pages))
                try:
                    shares = rd.parse_shares(body, report["PUBLISHDATEDesc"], source)["end"]
                except Exception:
                    shares = None
            result.append({**fund, **counts, "latest": latest, "shares": shares})
            print(fund["code"], fund["name"], counts, latest and latest["date"], shares, flush=True)
        except Exception as error:
            print(fund["code"], fund["name"], "失败", error, flush=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
