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
      <p className="section-head">
        <span className="kw">type</span> <span className="name">{typeName}</span> {"{"}
      </p>
      {children}
      <p className="section-foot">{"}"}</p>
    </section>
  );
}
