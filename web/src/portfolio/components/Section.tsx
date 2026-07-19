import { useEffect, useRef, useState, type ReactNode } from "react";

interface SectionProps {
  id: string;
  typeName: string;
  children: ReactNode;
  wide?: boolean;
}

export default function Section({ id, typeName, children, wide }: SectionProps) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return (
    <section id={id} ref={ref} className={`section ${inView ? "in-view" : ""} ${wide ? "wide" : ""}`}>
      <button
        type="button"
        className="section-head"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="section-toggle">{collapsed ? "▸" : "▾"}</span>
        <span className="kw">type</span> <span className="name">{typeName}</span> {collapsed ? "{ … }" : "{"}
      </button>
      {!collapsed && children}
      {!collapsed && <p className="section-foot">{"}"}</p>}
    </section>
  );
}
