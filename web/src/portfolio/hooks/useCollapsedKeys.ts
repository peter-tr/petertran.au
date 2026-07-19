import { useState } from "react";

export function useCollapsedKeys() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function isCollapsed(key: string) {
    return collapsed.has(key);
  }

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);

      return next;
    });
  }

  return { isCollapsed, toggle };
}
