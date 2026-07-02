import React from "react";

function SaveStateNotice({ state, fieldCount, invalidCount }) {
  const copy = {
    idle: "待上传模板",
    uploaded: "已上传，待标注",
    dirty: "有未保存修改",
    saving: "正在保存模板",
    saved: "模板已保存",
    incomplete: fieldCount === 0 ? "请先标注字段" : invalidCount > 0 ? `${invalidCount} 项属性未完善` : "有字段待确认",
    "no-file": "请先上传模板",
    unsupported: "仅支持DOCX预览",
    "storage-error": "模板存储失败",
  };
  const tone =
    state === "saved"
      ? "green"
      : state === "incomplete" || state === "no-file" || state === "unsupported" || state === "storage-error"
        ? "amber"
        : "blue";

  return <div className={`save-state ${tone}`}>{copy[state] ?? copy.idle}</div>;
}

export default SaveStateNotice;
