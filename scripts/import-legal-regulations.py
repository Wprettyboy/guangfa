import gzip
import html
import json
import re
import ssl
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "legal-resources"
KB_FILE = ROOT / "data" / "knowledge" / "library.json"
PROJECT_ID = "default-project"
CHUNK_SIZE = 900
CHUNK_OVERLAP = 120


RESOURCES = [
    ("01 合同与民商事基础", "最高人民法院关于适用《中华人民共和国民法典》合同编通则若干问题的解释", "https://www.court.gov.cn/fabu/xiangqing/419382.html"),
    ("01 合同与民商事基础", "中华人民共和国公司法", "https://www.gov.cn/yaowen/liebiao/202312/content_6923395.htm"),
    ("01 合同与民商事基础", "最高人民法院关于适用《中华人民共和国民法典》有关担保制度的解释", "https://www.court.gov.cn/fabu/xiangqing/282721.html"),
    ("02 招采与采购合同", "中华人民共和国政府采购法", "https://www.gov.cn/guoqing/2021-10/29/content_5647634.htm"),
    ("02 招采与采购合同", "中华人民共和国政府采购法实施条例", "https://www.gov.cn/zhengce/2015-02/27/content_2822395.htm"),
    ("02 招采与采购合同", "中华人民共和国招标投标法", "https://www.ndrc.gov.cn/xxgk/zcfb/qt/200507/t20050706_967929.html"),
    ("03 电子合同与数据合规", "中华人民共和国个人信息保护法", "https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm"),
    ("03 电子合同与数据合规", "中华人民共和国数据安全法", "https://www.cac.gov.cn/2021-06/11/c_1624994566919140.htm"),
    ("03 电子合同与数据合规", "中华人民共和国网络安全法", "https://www.cac.gov.cn/2025-12/29/c_1768735112911946.htm"),
    ("04 建设工程合同", "房屋建筑工程质量保修办法", "https://big5.www.gov.cn/gate/big5/www.gov.cn/gongbao/content/2001/content_60677.htm"),
    ("05 知识产权与技术合同", "中华人民共和国专利法", "https://www.cnipa.gov.cn/art/2020/11/23/art_97_155167.html"),
    ("05 知识产权与技术合同", "中华人民共和国著作权法", "http://www.npc.gov.cn/npc/c30834/202011/272b72cdb7594585890c5c5c3fbd2910.shtml"),
    ("06 交易秩序与付款", "保障中小企业款项支付条例", "https://www.gov.cn/zhengce/content/2020-07/14/content_5526768.htm"),
    ("07 劳动用工合同", "中华人民共和国劳动合同法", "https://www.gjxfj.gov.cn/gjxfj/xxgk/fgwj/flfg/webinfo/2016/03/1460585589931971.htm"),
]


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript"}:
            self.skip += 1
        if tag in {"p", "br", "div", "h1", "h2", "h3", "li", "tr"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript"} and self.skip:
            self.skip -= 1
        if tag in {"p", "div", "h1", "h2", "h3", "li", "tr"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

    def text(self):
        raw = html.unescape("".join(self.parts))
        lines = [re.sub(r"\s+", " ", line).strip() for line in raw.splitlines()]
        keep = [line for line in lines if len(line) > 1 and not re.search(r"ICP备|公网安备|版权所有|分享|字号|打印|关闭", line)]
        return "\n".join(keep)


def safe_name(value):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip()[:110]


def fetch_text(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept-Encoding": "gzip",
        },
    )
    context = ssl._create_unverified_context()
    with urllib.request.urlopen(request, timeout=40, context=context) as response:
        data = response.read()
        if response.headers.get("Content-Encoding") == "gzip" or data[:2] == b"\x1f\x8b":
            data = gzip.decompress(data)
        charset = response.headers.get_content_charset() or "utf-8"
    try:
        source = data.decode(charset, "ignore")
    except LookupError:
        source = data.decode("utf-8", "ignore")
    parser = TextExtractor()
    parser.feed(source)
    return parser.text()


def normalize_text(text):
    return re.sub(r"[ \t]+", " ", str(text or "")).strip()


def chunk_text(text):
    clean = normalize_text(text)
    if len(clean) <= CHUNK_SIZE:
        return [clean]
    chunks = []
    step = CHUNK_SIZE - CHUNK_OVERLAP
    for index in range(0, len(clean), step):
        chunk = clean[index : index + CHUNK_SIZE].strip()
        if chunk:
            chunks.append(chunk)
    return chunks


def read_metadata():
    if KB_FILE.exists():
        return json.loads(KB_FILE.read_text(encoding="utf-8-sig"))
    return {"knowledgeBases": [], "documents": [], "chunks": []}


def write_metadata(metadata):
    KB_FILE.parent.mkdir(parents=True, exist_ok=True)
    KB_FILE.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")


def get_or_create_kb(metadata, name):
    existing = next((kb for kb in metadata["knowledgeBases"] if kb.get("scope") == "project" and kb.get("name") == name), None)
    if existing:
        return existing
    now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    kb = {
        "id": f"KB-LEGAL-{re.sub(r'[^0-9A-Za-z]+', '-', name).strip('-')}-{int(time.time() * 1000)}",
        "name": name,
        "scope": "project",
        "projectId": PROJECT_ID,
        "createdAt": now,
        "updatedAt": now,
    }
    metadata["knowledgeBases"].insert(0, kb)
    return kb


def upsert_document(metadata, kb, title, text):
    document_name = f"{title}.txt"
    existing_docs = [doc for doc in metadata["documents"] if doc.get("kbId") == kb["id"] and doc.get("name") == document_name]
    for doc in existing_docs:
        metadata["documents"].remove(doc)
    metadata["chunks"] = [chunk for chunk in metadata["chunks"] if not any(chunk.get("documentId") == doc["id"] for doc in existing_docs)]

    now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    doc_id = f"DOC-LEGAL-{abs(hash(kb['id'] + title))}-{int(time.time() * 1000)}"
    chunks = chunk_text(text)
    metadata["documents"].insert(
        0,
        {
            "id": doc_id,
            "kbId": kb["id"],
            "name": document_name,
            "size": f"{len(text.encode('utf-8')) // 1024 + 1} KB",
            "status": "关键词可用",
            "indexMode": "keyword",
            "chunkCount": len(chunks),
            "createdAt": now,
            "updatedAt": now,
            "error": "批量导入法规资料，未写入向量索引；关键词检索可用。",
        },
    )
    metadata["chunks"].extend(
        {
            "id": f"{doc_id}-C{index + 1:04d}",
            "kbId": kb["id"],
            "scope": kb["scope"],
            "projectId": kb.get("projectId") or PROJECT_ID,
            "documentId": doc_id,
            "documentName": document_name,
            "chunkIndex": index + 1,
            "text": chunk,
            "page": "",
            "createdAt": now,
        }
        for index, chunk in enumerate(chunks)
    )
    kb["updatedAt"] = now
    return len(chunks)


def main():
    metadata = read_metadata()
    report = []
    for category, title, url in RESOURCES:
        text = fetch_text(url)
        if len(text) < 500:
            raise RuntimeError(f"{title} 抓取正文过短：{len(text)}")
        content = f"来源：{url}\n分类：{category}\n标题：{title}\n\n{text}"
        target_dir = OUT_DIR / safe_name(category)
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / f"{safe_name(title)}.txt").write_text(content, encoding="utf-8")
        kb = get_or_create_kb(metadata, category)
        chunk_count = upsert_document(metadata, kb, title, content)
        report.append({"category": category, "title": title, "url": url, "chunks": chunk_count})
        time.sleep(0.2)
    write_metadata(metadata)
    (OUT_DIR / "import-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"imported={len(report)} categories={len(set(item['category'] for item in report))}")
    for item in report:
        print(f"{item['category']} | {item['title']} | {item['chunks']} chunks")


if __name__ == "__main__":
    main()
