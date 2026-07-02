import React, { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Sparkles, X } from "lucide-react";

function CitationDrawer({ field, onClose }) {
  const drawerRef = useRef(null);

  useGSAP(
    () => {
      gsap.fromTo(
        drawerRef.current,
        { x: 22, autoAlpha: 0 },
        { x: 0, autoAlpha: 1, duration: 0.32, ease: "power3.out" },
      );
    },
    { dependencies: [field.id], scope: drawerRef },
  );

  return (
    <section className="citation-drawer" data-testid="citation-drawer" ref={drawerRef}>
      <div className="drawer-head">
        <div>
          <h2>溯源信息</h2>
          <p>{field.name}</p>
        </div>
        <button className="icon-button quiet" onClick={onClose} aria-label="关闭溯源">
          <X size={18} />
        </button>
      </div>
      <dl className="citation-meta">
        <div>
          <dt>填充内容</dt>
          <dd>{field.value || "暂未生成"}</dd>
        </div>
        <div>
          <dt>来源</dt>
          <dd>{field.source}</dd>
        </div>
        <div>
          <dt>匹配置信度</dt>
          <dd>{field.confidence || 0}%</dd>
        </div>
      </dl>
      <div className="confidence-bar">
        <span style={{ width: `${Math.max(field.confidence, 8)}%` }} />
      </div>
      <div className="evidence-box">
        <strong>引用片段</strong>
        <p>{field.sourceSnippetText || "暂无系统引用片段。"}</p>
      </div>
      <button className="wide-button">
        <Sparkles size={16} />
        查看完整来源
      </button>
    </section>
  );
}

export default CitationDrawer;
