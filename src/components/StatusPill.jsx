import React from "react";
import { Check, CircleAlert, Info, Loader2, PenLine, ShieldCheck } from "lucide-react";

const statusMeta = {
  未填充: { tone: "muted", icon: Info },
  生成中: { tone: "blue", icon: Loader2 },
  待确认: { tone: "amber", icon: CircleAlert },
  已确认: { tone: "green", icon: Check },
  需补充资料: { tone: "red", icon: CircleAlert },
  人工填写: { tone: "purple", icon: PenLine },
  已标注: { tone: "green", icon: ShieldCheck },
};

function StatusPill({ status }) {
  const meta = statusMeta[status] ?? statusMeta["未填充"];
  const Icon = meta.icon;
  return (
    <span className={`status-pill ${meta.tone}`}>
      <Icon size={14} className={status === "生成中" ? "spin" : ""} />
      {status}
    </span>
  );
}

export default StatusPill;
