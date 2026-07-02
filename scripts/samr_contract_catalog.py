import csv
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IN_PATH = ROOT / "data" / "samr-contracts" / "samr-contract-template-manifest.json"
OUT_DIR = ROOT / "data" / "samr-contracts"


RULES = [
    ("服务", "车辆维修服务", r"汽车维修|车辆维修|维修合同"),
    ("租赁", "融资租赁", r"融资租赁"),
    ("买卖", "商品房买卖", r"商品房|存量房|二手房|房屋买卖"),
    ("买卖", "车辆买卖", r"汽车买卖|机动车买卖|二手车买卖|车辆买卖|旧机动车"),
    ("买卖", "家具买卖", r"家具|家居"),
    ("买卖", "农产品买卖", r"农产品|粮食|棉花|水果|蔬菜|水产品|牲畜|生猪|茶叶"),
    ("买卖", "设备材料买卖", r"设备|材料|建材|钢材|木材|电器|商品购销|购销"),
    ("买卖", "一般买卖", r"买卖|销售|采购|订购|供货|交易"),
    ("租赁", "房屋租赁", r"房屋租赁|住房租赁|租房|商铺租赁|厂房租赁"),
    ("租赁", "车辆租赁", r"汽车租赁|车辆租赁"),
    ("租赁", "设备租赁", r"设备租赁|机械租赁|机具租赁"),
    ("租赁", "柜台场地租赁", r"柜台|场地|摊位|展位"),
    ("建设工程", "施工合同", r"施工合同|工程施工|装饰装修|装修工程|建设工程施工"),
    ("建设工程", "勘察设计监理", r"勘察|设计|监理|造价咨询"),
    ("建设工程", "工程总承包", r"总承包|EPC"),
    ("建设工程", "家庭装修", r"家装|家庭居室|家居装饰"),
    ("服务", "物业服务", r"物业"),
    ("服务", "养老家政服务", r"养老|家政|保姆|护理|托育"),
    ("服务", "教育培训服务", r"培训|教育|校外|研学|学校"),
    ("服务", "旅游服务", r"旅游|旅行|地接|出境|境内游|一日游"),
    ("服务", "餐饮住宿服务", r"餐饮|订餐|饭店|住宿|酒店|民宿|供餐|食堂"),
    ("服务", "健身美容洗染服务", r"健身|美容|美发|洗染|洗衣|摄影|婚庆|婚礼"),
    ("服务", "技术信息服务", r"技术开发|技术转让|技术咨询|技术服务|软件|数据|网络服务|信息系统|平台服务"),
    ("服务", "广告传媒服务", r"广告|传媒|直播|演出|文化艺术"),
    ("服务", "公共事业能源服务", r"能源|节水|节能|供水|供电|供气|供热"),
    ("服务", "委托代理中介", r"委托|代理|中介|经纪|拍卖|居间"),
    ("农业农资", "农资买卖", r"农药|化肥|种子|农膜|饲料|兽药"),
    ("农业农资", "农业生产经营", r"土地承包|土地流转|养殖|种植|农业|林业|渔业"),
    ("运输物流", "运输合同", r"运输|货运|客运|物流|快递|配送"),
    ("金融保管", "保管仓储", r"保管|仓储|寄存"),
    ("金融保管", "担保借款", r"担保|借款|贷款|融资|保理"),
    ("医疗健康", "医疗服务", r"医疗|诊疗|医院|体检"),
]


def classify(title: str):
    for level1, level2, pattern in RULES:
        if re.search(pattern, title, re.I):
            return level1, level2
    return "其他", "其他合同"


def clean(value):
    return "" if value is None else str(value).replace("\r", " ").replace("\n", " ").strip()


def main():
    items = json.loads(IN_PATH.read_text(encoding="utf-8-sig"))
    rows = []
    for item in items:
        level1, level2 = classify(item["title"])
        row = {
            **item,
            "level1": level1,
            "level2": level2,
        }
        rows.append(row)

    rows.sort(key=lambda x: (x["level1"], x["level2"], x.get("sourceScope", ""), x.get("year") or "", x["title"]))

    catalog_json = OUT_DIR / "samr-contract-template-catalog.json"
    catalog_csv = OUT_DIR / "samr-contract-template-catalog.csv"
    catalog_md = OUT_DIR / "samr-contract-template-catalog.md"
    sample_md = OUT_DIR / "samr-contract-template-samples-by-type.md"

    catalog_json.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    with catalog_csv.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["level1", "level2", "sourceScope", "typeName", "year", "region", "department", "title", "detailUrl", "id", "brief"])
        writer.writeheader()
        writer.writerows({k: clean(row.get(k)) for k in writer.fieldnames} for row in rows)

    counts = {}
    for row in rows:
        counts[(row["level1"], row["level2"])] = counts.get((row["level1"], row["level2"]), 0) + 1

    lines = [
        "# SAMR 合同示范文本二级分类目录",
        "",
        f"- 总数：{len(rows)}",
        "- 说明：基于标题关键词自动归类，供下载前审核；不改动原始来源分类。",
        "",
        "## 二级分类汇总",
        "",
        "| 一级 | 二级 | 数量 |",
        "|---|---|---:|",
    ]
    for (level1, level2), count in sorted(counts.items()):
        lines.append(f"| {level1} | {level2} | {count} |")
    lines += ["", "## 全量明细", "", "| 一级 | 二级 | 年份 | 来源 | 地区/部门 | 标题 | 链接 |", "|---|---|---:|---|---|---|---|"]
    for row in rows:
        owner = row.get("region") or row.get("department") or "-"
        title = row["title"].replace("|", "/")
        lines.append(f"| {row['level1']} | {row['level2']} | {row.get('year') or ''} | {row.get('sourceScope')} | {owner} | {title} | [查看]({row['detailUrl']}) |")
    catalog_md.write_text("\n".join(lines), encoding="utf-8")

    samples = []
    for key in sorted(counts):
        candidates = [row for row in rows if (row["level1"], row["level2"]) == key]
        candidates.sort(
            key=lambda row: (
                "合同" not in row["title"],
                row.get("sourceScope") != "National",
                -int(row.get("year") or 0),
                row["title"],
            )
        )
        samples.append(candidates[0])
    sample_lines = [
        "# SAMR 合同示范文本二级类型代表清单",
        "",
        f"- 二级类型数：{len(samples)}",
        "- 每个二级类型暂取 1 个代表模板，供你审核是否要下载。",
        "",
        "| 一级 | 二级 | 数量 | 代表模板 | 链接 |",
        "|---|---|---:|---|---|",
    ]
    for row in samples:
        count = counts[(row["level1"], row["level2"])]
        title = row["title"].replace("|", "/")
        sample_lines.append(f"| {row['level1']} | {row['level2']} | {count} | {title} | [查看]({row['detailUrl']}) |")
    sample_md.write_text("\n".join(sample_lines), encoding="utf-8")

    print(catalog_md)
    print(sample_md)
    print(f"items={len(rows)} level2={len(samples)}")


if __name__ == "__main__":
    main()
