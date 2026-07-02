import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

function SidebarItem({ icon: Icon, label, active, expanded, hasChildren, onClick }) {
  return (
    <button className={active ? "sidebar-item active" : "sidebar-item"} onClick={onClick}>
      <Icon size={18} />
      <span>{label}</span>
      {hasChildren ? expanded ? <ChevronDown size={15} className="item-chevron" /> : <ChevronRight size={15} className="item-chevron" /> : null}
    </button>
  );
}

export default SidebarItem;
