import JSZip from "jszip";



function formatFileSize(size) {
  if (!Number.isFinite(size)) return "未知大小";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function readMaterialFile(file) {
  const isDocx = /\.docx$/i.test(file.name);
  const text = isDocx ? await readDocxText(file) : await file.text();
  return {
    id: `MAT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    size: formatFileSize(file.size),
    storage: "temporary",
    text: text.replace(/\s+/g, " ").trim().slice(0, 16000),
  };
}

async function readKnowledgeDocumentFile(file) {
  const isDocx = /\.docx$/i.test(file.name);
  const text = isDocx ? await readDocxText(file) : await file.text();
  return {
    id: `KDOC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    size: formatFileSize(file.size),
    text: text.replace(/\s+/g, " ").trim().slice(0, 250000),
  };
}

async function readDocxText(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) return "";
  return documentXml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadDocxBuffer(buffer, fileName) {
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), fileName);
}

function buildExportFileName(fileName = "招标文件模板.docx") {
  return fileName.replace(/\.(docx)$/i, "") + "-已填充.docx";
}

function buildFormatRevisionFileName(fileName = "待审文档.docx") {
  return fileName.replace(/-格式修订版(?=\.docx$)/i, "").replace(/\.(docx)$/i, "") + "-格式修订版.docx";
}

function getExportStatusText(state) {
  if (state === "exporting") return "正在生成文件";
  if (state === "done") return "已生成下载";
  if (state === "no-file") return "未加载模板";
  if (state === "error") return "导出失败";
  return "";
}



export {
  formatFileSize,
  readMaterialFile,
  readKnowledgeDocumentFile,
  readDocxText,
  downloadBlob,
  downloadDocxBuffer,
  buildExportFileName,
  buildFormatRevisionFileName,
  getExportStatusText,
};

