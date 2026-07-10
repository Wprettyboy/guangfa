import React, { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Check, CircleAlert, Info, Loader2, PenLine, Save, Upload, Wand2, X } from "lucide-react";
import StatusPill from "../../../components/StatusPill.jsx";
import {
  canUseMarkedSelectionAsFillTarget,
  fieldCategoryOptions,
  getFieldDisplayText,
  getFieldSetupIssue,
  getFillModeOptions,
  getTemplateFieldSourceText,
  hasInputPoint,
  inferFillMode,
  isReplacementField,
  normalizeFieldCategory,
  normalizeFillMode,
} from "../../../utils/fields.js";
import {
  collectChoiceKeywordsFromText,
  getFieldChoiceValue,
  isDateField,
  normalizeChoiceText,
  padDatePart,
  parseDateParts,
} from "./helpers.js";

function FieldLine({ slot, field, mode, active, brushActive, onClick }) {
  const isAnnotate = mode === "annotate";
  const isMarked = Boolean(field);
  const tag = isAnnotate ? (isMarked ? "已标注" : brushActive ? "点击标注" : "未标注") : field?.status;
  const value = isAnnotate ? (isMarked ? `{{${getTemplateFieldSourceText(field) || field.name || slot.suggestedName}}}` : "") : field?.value ?? "";

  return (
    <button
      className={[
        "field-line",
        "doc-slot",
        active ? "active" : "",
        isMarked ? "marked" : "",
        isAnnotate && brushActive && !isMarked ? "brush-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={!isAnnotate}
      onClick={onClick}
      type="button"
    >
      <span>{slot.label}</span>
      <div className="blank-line">
        <strong>{value}</strong>
      </div>
      {tag ? <em>{tag}</em> : null}
    </button>
  );
}

function PreviewState({ state, onUploadClick }) {
  const meta = {
    empty: {
      icon: Upload,
      title: "请先上传 DOCX 模板",
      desc: "上传后在 OnlyOffice 中选中文字，点击定制组件里的标注字段。",
    },
    loading: {
      icon: Loader2,
      title: "正在加载文档预览",
      desc: "正在解析上传的 DOCX 模板。",
    },
    unsupported: {
      icon: CircleAlert,
      title: "暂不支持该文件格式",
      desc: "浏览器预览阶段请上传 .docx 文件；.doc 文件后续由后端转换后再支持。",
    },
    error: {
      icon: CircleAlert,
      title: "文档预览加载失败",
      desc: "请确认文件没有损坏，或换一个 DOCX 模板重试。",
    },
  };
  const current = meta[state] ?? meta.empty;
  const Icon = current.icon;
  const canUpload = state === "empty" && onUploadClick;

  return (
    <div
      className={`preview-state ${state} ${canUpload ? "clickable" : ""}`}
      onClick={canUpload ? onUploadClick : undefined}
      onKeyDown={
        canUpload
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") onUploadClick();
            }
          : undefined
      }
      role={canUpload ? "button" : undefined}
      tabIndex={canUpload ? 0 : undefined}
    >
      <Icon size={24} className={state === "loading" ? "spin" : ""} />
      <strong>{current.title}</strong>
      <span>{current.desc}</span>
      {canUpload ? (
        <button
          className="mini-button blue"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onUploadClick();
          }}
        >
          <Upload size={15} />
          上传文档
        </button>
      ) : null}
    </div>
  );
}

function FieldForm({ field, onChange, onAddInputPoint }) {
  if (!field) {
    return (
      <div className="field-form empty-form">
        <Info size={20} />
        <span>在文档中选中文字并点击标注字段，或选择字段编辑</span>
      </div>
    );
  }

  function updateType(type) {
    const category = normalizeFieldCategory(type);
    onChange({ type: category, category, fillMode: inferFillMode({ ...field, category, type: category }) });
  }
  function updateFillMode(fillMode) {
    onChange({ fillMode });
  }
  const sourceText = getTemplateFieldSourceText(field);
  const category = normalizeFieldCategory(field.category || field.type);
  const fillMode = normalizeFillMode(field.fillMode, field);
  const modeOptions = getFillModeOptions({ ...field, category, type: category });
  const modeLabel = category === "单选项" ? "单选细分" : "填空类型";
  const hasInput = hasInputPoint(field);
  const usesMarkedSelectionTarget = !hasInput && canUseMarkedSelectionAsFillTarget(field);
  const setupIssue = getFieldSetupIssue({ ...field, category, type: category, fillMode });

  return (
    <div className="field-form">
      <div className="field-context">
        <span>模板选区原文</span>
        <p>{sourceText || "暂无选区上下文"}</p>
      </div>
      <div className="field-context input-point-context">
        <span>填写输入点</span>
        <p>{hasInput ? `已设置，第 ${field.inputPoint?.page || field.page || 1} 页` : isReplacementField(field) ? "单选项将使用标注选区作为写入范围" : usesMarkedSelectionTarget ? "将使用标注选区作为填写范围" : "未设置，请把光标放到实际填写位置后点击添加输入点"}</p>
      </div>
      {setupIssue ? (
        <div className="field-context field-context-warning">
          <span>写入校验</span>
          <p>{setupIssue}</p>
        </div>
      ) : null}
      <label>
        <span>自动填充类别</span>
        <select value={category} onChange={(event) => updateType(event.target.value)}>
          {fieldCategoryOptions.map((option) => <option key={option}>{option}</option>)}
        </select>
      </label>
      <label>
        <span>{modeLabel}</span>
        <select value={fillMode} onChange={(event) => updateFillMode(event.target.value)}>
          {modeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <div className="field-form-actions">
        <button className={hasInput ? "tool-button is-selected" : "tool-button"} type="button" onClick={onAddInputPoint}>
          <PenLine size={16} />
          {hasInput ? "重设输入点" : "添加输入点"}
        </button>
      </div>
    </div>
  );
}

function FillFieldRow({ field, index, selected, onSelect, onGenerate, generateDisabled, onUpdateValue, onConfirm }) {
  const rowRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(field.value || "");
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const choiceOptions = useMemo(() => getChoiceEditOptions(field), [field]);
  const isChoiceEditing = field.type === "单选项" && choiceOptions.length > 0;
  const isDateEditing = isDateField(field);
  const sourceSnippetText = String(field.sourceSnippetText || "").trim();
  const supplementReason = getFillSupplementReason(field);

  useEffect(() => {
    if (!editing) setDraftValue(field.value || "");
  }, [editing, field.value]);

  useEffect(() => {
    setSourceExpanded(false);
  }, [field.id, field.sourceSnippetText]);

  useGSAP(
    () => {
      if (!selected) return;
      gsap.fromTo(
        rowRef.current,
        { backgroundColor: "#eef5ff" },
        { backgroundColor: "#ffffff", duration: 0.7, ease: "power1.out" },
      );
    },
    { dependencies: [selected], scope: rowRef },
  );

  return (
    <div
      className={selected ? "field-row selected" : "field-row"}
      data-testid={`fill-row-${field.id}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      ref={rowRef}
      role="button"
      tabIndex={0}
    >
      <div className="field-row-toolbar">
        <div className="row-actions" onClick={(event) => event.stopPropagation()}>
          <StatusPill status={field.status} />
          {editing ? (
            <>
              <button
                className="mini-button blue"
                disabled={generateDisabled}
                onClick={() => {
                  onUpdateValue(draftValue);
                  setEditing(false);
                }}
              >
                <Save size={15} />
                保存
              </button>
              <button
                className="mini-button"
                onClick={() => {
                  setDraftValue(field.value || "");
                  setEditing(false);
                }}
              >
                <X size={15} />
                取消
              </button>
            </>
          ) : (
            <>
              <button
                className="mini-button blue"
                data-testid={`generate-${field.id}`}
                onClick={onGenerate}
                disabled={generateDisabled || field.status === "生成中"}
              >
                {field.status === "生成中" ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />}
                AI填充
              </button>
              <button
                className="mini-button"
                onClick={() => {
                  setDraftValue(field.value || "");
                  setEditing(true);
                }}
                disabled={generateDisabled || field.status === "生成中"}
              >
                <PenLine size={15} />
                编辑
              </button>
              <button
                className="mini-button"
                data-testid={`confirm-${field.id}`}
                onClick={onConfirm}
                disabled={field.status === "已确认" || !field.value}
              >
                <Check size={15} />
                确认
              </button>
            </>
          )}
        </div>
      </div>
      <div className="field-card-head">
        <span className="row-index">{index + 1}</span>
        <strong title={getFieldDisplayText(field)}>{getFieldDisplayText(field)}</strong>
      </div>
      {editing ? (
        isChoiceEditing ? (
          <div className="field-choice-editor" onClick={(event) => event.stopPropagation()}>
            {choiceOptions.map((option) => {
              const active = normalizeChoiceText(option) === normalizeChoiceText(draftValue);
              return (
                <button
                  className={active ? "choice-edit-option selected" : "choice-edit-option"}
                  key={option}
                  type="button"
                  onClick={() => setDraftValue(option)}
                >
                  {active ? "☑" : "□"}
                  <span>{option}</span>
                </button>
              );
            })}
            <input
              className="field-value-editor compact"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="选中项文本"
            />
          </div>
        ) : isDateEditing ? (
          <div className="field-date-editor" onClick={(event) => event.stopPropagation()}>
            <input
              className="field-value-editor compact"
              type="date"
              value={toDateInputValue(draftValue)}
              onChange={(event) => setDraftValue(formatChineseDateFromInput(event.target.value))}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <input
              className="field-value-editor compact"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="YYYY年MM月DD日 HH时mm分"
            />
          </div>
        ) : (
          <textarea
            className="field-value-editor"
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="输入填充内容"
            rows={4}
          />
        )
      ) : (
        <div className={field.value ? "field-value rich" : supplementReason ? "field-reason" : "field-value empty"}>
          {field.value || supplementReason || "暂未生成"}
        </div>
      )}
      {(field.source || sourceSnippetText) && field.status !== "未填充" ? (
        <div className="field-evidence" onClick={(event) => event.stopPropagation()}>
          <span>依据原文</span>
          <div className="field-evidence-line">
            <em>{field.source || "未找到依据片段"}</em>
            {sourceSnippetText ? (
              <button
                type="button"
                onClick={() => setSourceExpanded((value) => !value)}
              >
                {sourceExpanded ? "收起" : "展开"}
              </button>
            ) : null}
          </div>
          {sourceExpanded && sourceSnippetText ? <p>{sourceSnippetText}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function getChoiceEditOptions(field) {
  const context = [field.answerFormat, field.question, getFieldChoiceValue(field)]
    .map((item) => String(item || "").replace(/^模板上下文[：:]/, "").trim())
    .filter(Boolean)
    .join("\n");
  const options = [];

  [...context.matchAll(/[□☐○〇▢☑✓✔]\s*([^□☐○〇▢☑✓✔\n\r]{2,80})/g)].forEach((match) => {
    options.push(cleanChoiceOptionText(match[1]));
  });

  if (options.length === 0) {
    const lineOptions = context
      .split(/\n+/)
      .map((line) => cleanChoiceOptionText(line))
      .filter((line) => /^[^\s].{1,80}$/.test(line) && /综合评估法|综合评分法|最低投标价法|含税|不含税/.test(line));
    options.push(...lineOptions);
  }

  if (options.length === 0) {
    collectChoiceKeywordsFromText(normalizeChoiceText(context), options);
  }
  if (getFieldChoiceValue(field)) options.push(getFieldChoiceValue(field));

  return [...new Map(options
    .map((option) => cleanChoiceOptionText(option))
    .filter((option) => normalizeChoiceText(option).length >= 2)
    .map((option) => [normalizeChoiceText(option), option])).values()];
}

function cleanChoiceOptionText(value) {
  return String(value || "")
    .replace(/^模板上下文[：:]/, "")
    .replace(/^[□☐○〇▢☑✓✔]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getFillSupplementReason(field = {}) {
  if (field.status !== "需补充资料" || field.value) return "";
  const reason = String(field.evidence || "")
    .split("可参考相近原文：")[0]
    .split("系统判断：")[0]
    .replace(/\s+/g, " ")
    .trim();
  return reason ? `证据判断：${reason.slice(0, 180)}` : "";
}

function toDateInputValue(value) {
  const parts = parseDateParts(value);
  if (!parts) return "";
  return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)}`;
}

function formatChineseDateFromInput(value) {
  const parts = parseDateParts(value);
  if (!parts) return "";
  return `${parts.year}年${padDatePart(parts.month)}月${padDatePart(parts.day)}日`;
}

function getNextFieldNumber(fields) {
  return (
    fields.reduce((max, field) => {
      const number = Number(field.id.replace(/\D/g, ""));
      return Number.isFinite(number) ? Math.max(max, number) : max;
    }, 0) + 1
  );
}

export {
  FieldForm,
  FieldLine,
  FillFieldRow,
  PreviewState,
  cleanChoiceOptionText,
  getChoiceEditOptions,
  getFillSupplementReason,
  getNextFieldNumber,
  toDateInputValue,
  formatChineseDateFromInput,
};
