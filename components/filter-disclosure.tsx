"use client";

import React, { useState } from "react";
import { SlidersHorizontal } from "lucide-react";

export function FilterDisclosure({ count, initiallyOpen, children }: { count: number; initiallyOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <div className="projects-more-filters">
    <button className="secondary projects-more-toggle" type="button" aria-expanded={open} aria-controls="projects-advanced-filters" onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }}>
      <SlidersHorizontal aria-hidden="true" size={16} /> More Filters {count > 0 && <span>{count}</span>}
    </button>
    <div id="projects-advanced-filters" hidden={!open}>{children}</div>
  </div>;
}
