import React, { useMemo } from "react";
import { Info } from "lucide-react";
import { getFillFieldDisplayPage } from "../runtime.jsx";
import { FillFieldRow } from "./FieldControls.jsx";
import { useFillWorkspaceActions, useFillWorkspaceState } from "../../fill/FillWorkspaceContext.jsx";

function OtherFieldFillPanel() {
  const { fields, currentPage, fieldPageMap, selectedFieldId, generatingAll: generateDisabled } = useFillWorkspaceState();
  const {
    onSelectField,
    onGenerate,
    onUpdateValue,
    onConfirm,
  } = useFillWorkspaceActions();
  const counts = useMemo(
    () =>
      fields.reduce(
        (acc, field) => {
          acc.all += 1;
          acc[field.status] = (acc[field.status] ?? 0) + 1;
          return acc;
        },
        { all: 0 },
      ),
    [fields],
  );
  const hasDynamicFieldPages = Object.keys(fieldPageMap || {}).length > 0;
  const pageFields = fields.filter((field) => getFillFieldDisplayPage(field, fieldPageMap, hasDynamicFieldPages) === currentPage);

  return (
    <section className="other-fill-panel">
      <div className="status-filters">
        <span className="filter active">当前页 {pageFields.length}</span>
        <span className="filter">全部 {counts.all}</span>
        <span className="filter">未填充 {counts["未填充"] ?? 0}</span>
        <span className="filter">待确认 {counts["待确认"] ?? 0}</span>
        <span className="filter">已确认 {counts["已确认"] ?? 0}</span>
        <span className="filter warning">需补充资料 {counts["需补充资料"] ?? 0}</span>
      </div>
      <div className="field-table">
        {pageFields.length === 0 ? (
          <div className="empty-state compact">
            <Info size={17} />
            <span>当前页暂无填充字段</span>
          </div>
        ) : (
          pageFields.map((field, index) => (
            <FillFieldRow
              field={field}
              index={index}
              selected={field.id === selectedFieldId}
              key={field.id}
              onSelect={() => onSelectField(field.id)}
              onGenerate={() => onGenerate(field.id)}
              generateDisabled={generateDisabled}
              onUpdateValue={(value) => onUpdateValue(field.id, value)}
              onConfirm={() => onConfirm(field.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}

export default OtherFieldFillPanel;
