"""Refresh issuer reports mirrored by Eastmoney. Leave unrecognized notices for review."""

from datetime import date, datetime, timedelta
from io import BytesIO
import json
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from pypdf import PdfReader


HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://fundf10.eastmoney.com/"}
CN_DATE = r"(20\d{2})年(\d{1,2})月(\d{1,2})日"
AMOUNT = r"([\d,]+(?:\.\d+)?)(万)?(?:元|人民币)"
HOLIDAY = re.compile(r"(?:节假日|假期|圣诞节|春节|劳动节|国庆节|中秋节|端午节|清明节|非港股通|非交易日|海外休市)")
CAP_TITLE = re.compile(r"(?:申购|定期定额).*(?:业务|金额|调整|上限|限制|公告)|(?:调整|暂停|恢复|限制).*(?:申购|定期定额)")
REPORT_TITLE = re.compile(r"20\d{2}年(?:第[一二三四1234]季度|中期|年度|半年度)报告$")


def download(url):
    with urlopen(Request(url, headers=HEADERS), timeout=25) as response:
        return response.read()


def compact(text):
    return re.sub(r"\s+", "", text).replace("，", ",")


def to_date(groups):
    return date(*map(int, groups)).isoformat()


AGENCY = re.compile(r"代销|非直销|直销(?:渠道|机构|平台)?以外")


def limit_amounts(text, code):
    """限额金额按渠道分组：代销优先，其次未分渠道，最后直销。只针对 E/I 类或美元份额的金额不计入。"""
    amounts = {"agency": set(), "direct": set(), "any": set()}
    for match in re.finditer(r"(?:业务限额为|申购限额为|单日限额为|申购上限为|限制金额为|不超过|不得超过|超过)(?:人民币)?" + AMOUNT, text):
        # 只看金额所在的这一句（上一个；或。之后），避免长句里的渠道、份额类别看不到或看串
        start = max(text.rfind(mark, 0, match.start()) for mark in "；。;") + 1
        sentence = text[max(start, match.start() - 260):match.start()]
        if "美元" in sentence[-30:] or not re.search(r"申购|定期定额|转换转入|限制金额", sentence):
            continue
        if re.search(r"[EI]类", sentence) and not re.search(r"A类|" + code, sentence):
            continue
        channel = "agency" if AGENCY.search(sentence) else "direct" if "直销" in sentence else "any"
        number, unit = match.groups()
        amounts[channel].add(float(number.replace(",", "")) * (10_000 if unit else 1))
    return amounts["agency"] or amounts["any"] or amounts["direct"]


def parse_limit(title, text, code, published):
    if "继续暂停" in title or HOLIDAY.search(title) or "销售机构" in title or "转换业务" in title:
        return None
    # 同时暂停赎回的是境外休市（节假日），不是额度变化
    if "暂停" in title and "赎回" in title:
        return None
    # 只调整基金公司直销渠道的公告：代销限额不变
    if "直销" in title and not re.search(r"代销|非直销", title):
        return None
    if ("美元份额" in title or "美元现汇" in title or re.search(r"[CEI]类(?:基金)?份额", title)) and "人民币" not in title and "A类" not in title:
        return None
    if code not in text:
        raise ValueError("正文未找到对应基金代码")
    found = re.search(r"(?:暂停申购(?:业务)?起始日|恢复申购(?:业务)?(?:起始)?日|(?:限制|暂停|调整)大额申购(?:业务金额限制)?起始日|恢复大额申购(?:起始)?日|自)" + CN_DATE, text)
    if not found:
        raise ValueError("缺少限额生效日")
    effective = to_date(found.groups())
    if effective < published:
        raise ValueError("限额生效日早于公告日")
    details = re.split(r"(?:2[.．、]其他需要提示的事项|其他需要提示的事项)", text, maxsplit=1)[-1]
    # 直销、代销限额不同时取代销（大多数人通过代销平台申购，2026-11-16）
    amounts = limit_amounts(details, code) or limit_amounts(text, code)  # 金额只写在第 1 节「注」里时退回全文
    if "暂停申购" in title and "大额" not in title and "恢复" not in title:
        return effective, 0
    if len(amounts) == 1:
        return effective, amounts.pop()
    if not amounts and re.search(r"(?:取消|解除).{0,30}(?:申购金额限制|大额申购限制|限额)", details):
        return effective, "unlimited"
    raise ValueError("限额规则或金额需核实")


def parse_shares(text, published, source):
    period = re.search(CN_DATE + r"起?至" + CN_DATE, text[:7500])
    if not period:
        raise ValueError("缺少报告期")
    start_date = (date.fromisoformat(to_date(period.groups()[:3])) - timedelta(days=1)).isoformat()
    end_date = to_date(period.groups()[3:6])
    totals = {}
    for label in ("初", "末"):
        match = re.search(r"报告期期" + label + r"基金份额总额(?:\(份\)|（份）)?([\d,.]+)", text)
        if not match:
            raise ValueError("缺少份额汇总行")
        row = match[1].rstrip(".")
        numbers = re.findall(r"(?:[\d]{1,3}(?:,[\d]{3})+|\d+)\.\d{2}", row)
        if not numbers or "".join(numbers) != row:
            raise ValueError("无法区分份额列")
        totals[label] = sum(float(number.replace(",", "")) for number in numbers)
    return {"scope": "全基金", "startDate": start_date, "endDate": end_date, "publishedOn": published,
            "start": round(totals["初"], 2), "end": round(totals["末"], 2), "source": source}


def refresh_fund(fund, verified, today):
    code = fund["code"]
    fund["review"] = []
    processed = fund.get("processedNotices", {})
    notices = []
    for page in range(1, 11):
        response = json.loads(download(
            f"https://api.fund.eastmoney.com/f10/JJGG?fundcode={code}&pageIndex={page}&pageSize=50&type=0"
        ))
        rows = response["Data"]
        if not isinstance(rows, list) or (page == 1 and not rows):
            raise ValueError("公告源未返回有效列表")
        notices.extend(row for row in rows if verified <= row["PUBLISHDATEDesc"] <= today and row["ID"] not in processed)
        if len(rows) < 50 or rows[-1]["PUBLISHDATEDesc"] < verified:
            break
    else:
        raise ValueError("公告源翻页未覆盖上次核实日")

    cap_review = False
    for notice in sorted(notices, key=lambda row: (row["PUBLISHDATEDesc"], row["ID"])):
        title, published, identifier = notice["TITLE"], notice["PUBLISHDATEDesc"], notice["ID"]
        cap_notice = CAP_TITLE.search(title)
        report = REPORT_TITLE.search(title)
        if (not cap_notice and not report) or not re.fullmatch(r"AN\d+", identifier):
            continue
        if cap_notice and ("继续暂停" in title or HOLIDAY.search(title) or "销售机构" in title or "转换业务" in title):
            continue
        source = f"https://pdf.dfcfw.com/pdf/H2_{identifier}_1.pdf"
        try:
            doc = PdfReader(BytesIO(download(source)))
            body = compact("".join(page.extract_text() or "" for page in doc.pages))
            if report:
                shares = parse_shares(body, published, source)
                if shares["endDate"] > fund["shares"]["endDate"]:
                    fund["shares"] = shares
            elif cap_review:
                continue
            else:
                parsed = parse_limit(title, body, code, published)
                if parsed is not None:
                    effective, cap = parsed
                    previous = fund["events"][-1]
                    if effective < previous[1] or (effective == previous[1] and cap != previous[2]):
                        raise ValueError("新旧公告生效日冲突")
                    if cap != previous[2]:
                        fund["events"].append([published, effective, cap, source])
            processed[identifier] = published
        except Exception as error:
            fund["review"].append({"date": published, "title": title, "source": source, "type": "shares" if report else "limit"})
            print(f"{code} {published} 待核对：{error}", flush=True)
            cap_review = cap_review or bool(cap_notice)

    unresolved = [item["date"] for item in fund["review"]]
    fund["checkedThrough"] = today if not unresolved else (date.fromisoformat(min(unresolved)) - timedelta(days=1)).isoformat()
    fund["processedNotices"] = {identifier: published for identifier, published in processed.items()
                                if published >= fund["checkedThrough"]}


def main():
    seed, state = map(Path, sys.argv[1:3])
    curated = json.loads(seed.read_text())
    if state.exists():
        previous = json.loads(state.read_text())
        old = {fund["code"]: fund for fund in previous["funds"]}
        for i, fund in enumerate(curated["funds"]):
            current = old.get(fund["code"], {})
            if current.get("checkedThrough", "") >= curated["verifiedOn"]:
                # 沿用已核实的公告进度；名称、份额类别、所属指数以种子为准
                curated["funds"][i] = {**current, **{key: fund[key] for key in ("name", "scope", "index") if key in fund}}
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()
    for fund in curated["funds"]:
        verified = fund.get("checkedThrough", curated["verifiedOn"])
        refresh_fund(fund, verified, today)
    curated["verifiedOn"] = today
    state.write_text(json.dumps(curated, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
