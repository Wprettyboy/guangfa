import base64
import json
import re
import time
import urllib.request
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data" / "samr-contracts" / "samr-contract-template-catalog.json"
FILES_DIR = ROOT / "data" / "samr-contracts" / "files"
REPORT_PATH = ROOT / "data" / "samr-contracts" / "samr-contract-template-download-report.json"
TEMPLATE_LIBRARY_PATH = ROOT / "data" / "templates" / "library.json"
SAMR_DOWNLOAD_URL = "https://htsfwb.samr.gov.cn/api/File/DownTemplate?id={id}&type=1"


def safe_name(value):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip()
    value = re.sub(r"\s+", " ", value)
    return value[:120] or "未命名合同范本"


def format_size(size):
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{round(size / 1024)} KB"
    return f"{size / 1024 / 1024:.1f} MB"


def group_samples(rows):
    groups = {}
    for row in rows:
        groups.setdefault((row["level1"], row["level2"]), []).append(row)

    grouped = []
    for key in sorted(groups):
        candidates = groups[key]
        candidates.sort(
            key=lambda row: (
                "合同" not in row["title"],
                row.get("sourceScope") != "National",
                -int(row.get("year") or 0),
                row["title"],
            )
        )
        grouped.append((key, candidates))
    return grouped


def fetch_template(item):
    url = SAMR_DOWNLOAD_URL.format(id=item["id"])
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": item["detailUrl"],
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read()
        content_type = response.headers.get("Content-Type", "")

    if data.startswith(b"PK"):
        return data, ".docx", True, content_type
    if data.startswith(b"\xd0\xcf\x11\xe0"):
        if "wpsoffice" in content_type.lower():
            return data, ".wps", False, content_type
        return data, ".doc", False, content_type
    raise RuntimeError(f"下载结果不是 Word/WPS 文件：{content_type or 'unknown'}")


def choose_download(candidates):
    fallback = None
    errors = []
    for item in candidates:
        try:
            data, extension, supported, content_type = fetch_template(item)
            if supported:
                return item, data, extension, supported, content_type, "downloaded"
            if fallback is None:
                fallback = (item, data, extension, supported, content_type)
        except Exception as error:
            errors.append(f"{item['title']}: {error}")
        time.sleep(0.15)

    if fallback:
        return (*fallback, "downloaded-legacy")
    raise RuntimeError("; ".join(errors[:3]) or "没有可下载文件")


def write_download(target, data):
    if target.exists() and target.stat().st_size > 0:
        return target.read_bytes(), "exists"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return data, "downloaded"


def read_library():
    if not TEMPLATE_LIBRARY_PATH.exists():
        return []
    raw = TEMPLATE_LIBRARY_PATH.read_text(encoding="utf-8-sig")
    templates = json.loads(raw) if raw.strip() else []
    return templates if isinstance(templates, list) else []


def write_library(templates):
    TEMPLATE_LIBRARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    TEMPLATE_LIBRARY_PATH.write_text(json.dumps(templates, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    rows = json.loads(CATALOG_PATH.read_text(encoding="utf-8-sig"))
    grouped_samples = group_samples(rows)
    templates = read_library()
    existing_ids = {item.get("id") for item in templates}
    existing_folders = {
        (item.get("level1"), item.get("level2"))
        for item in templates
        if item.get("category") == "合同类" and item.get("level1") and item.get("level2")
    }
    report = []
    new_templates = []
    now_ms = int(time.time() * 1000)
    saved_at = datetime.now().strftime("%Y/%m/%d %H:%M:%S")

    for index, ((level1, level2), candidates) in enumerate(grouped_samples):
        try:
            item, data, extension, supported, content_type, download_status = choose_download(candidates)
            title = item["title"]
            file_name = f"{safe_name(title)}{extension}"
            file_path = FILES_DIR / safe_name(level1) / safe_name(level2) / file_name
            data, write_status = write_download(file_path, data)
            status = "exists" if write_status == "exists" else download_status
            template_id = f"SAMR-{item['id']}"
            folder_exists = (level1, level2) in existing_folders
            if template_id not in existing_ids:
                new_templates.append(
                    {
                        "id": template_id,
                        "name": title,
                        "category": "合同类",
                        "level1": level1,
                        "level2": level2,
                        "folder": f"{level1}/{level2}",
                        "source": "国家市场监督管理总局合同示范文本库",
                        "sourceUrl": item["detailUrl"],
                        "sourceTemplateId": item["id"],
                        "fileName": file_name,
                        "fileSize": format_size(len(data)),
                        "savedAt": saved_at,
                        "savedAtMs": now_ms + index,
                        "uploadedAt": saved_at,
                        "supported": supported,
                        "fieldCount": 0,
                        "confirmedCount": 0,
                        "typeSummary": [],
                        "fields": [],
                        "fileBase64": base64.b64encode(data).decode("ascii"),
                    }
                )
                existing_ids.add(template_id)
                existing_folders.add((level1, level2))
            report.append(
                {
                    "id": item["id"],
                    "title": title,
                    "level1": level1,
                    "level2": level2,
                    "status": status,
                    "supported": supported,
                    "contentType": content_type,
                    "file": str(file_path.relative_to(ROOT)),
                    "imported": not folder_exists,
                }
            )
        except Exception as error:
            report.append(
                {
                    "id": item["id"],
                    "title": title,
                    "level1": level1,
                    "level2": level2,
                    "status": "failed",
                    "error": str(error),
                }
            )

    if new_templates:
        templates = new_templates + templates
        templates.sort(key=lambda item: item.get("savedAtMs", 0), reverse=True)
        write_library(templates)

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    failures = [item for item in report if item["status"] == "failed"]
    legacy = [item for item in report if item.get("supported") is False]
    print(f"samples={len(grouped_samples)} imported={len(new_templates)} totalTemplates={len(templates)} legacy={len(legacy)} failed={len(failures)}")
    print(REPORT_PATH)
    if failures:
        for item in failures[:5]:
            print(f"FAILED {item['level1']}/{item['level2']} {item['title']}: {item['error']}")


if __name__ == "__main__":
    main()
