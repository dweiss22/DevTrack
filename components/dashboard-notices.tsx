"use client";

import Link from "next/link";
import { Pin } from "lucide-react";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  dashboardNoticesFromSources,
  removeDashboardNoticeSource,
  replaceDashboardNoticeSource,
  type DashboardNotice,
  type DashboardNoticeSources,
} from "@/lib/reporting/dashboard-notices";

type DashboardNoticeContextValue = {
  notices: DashboardNotice[];
  replaceSource: (source: string, notices: DashboardNotice[]) => void;
  removeSource: (source: string) => void;
};

const DashboardNoticeContext = createContext<DashboardNoticeContextValue | null>(null);

export function DashboardNoticeProvider({ children }: { children: React.ReactNode }) {
  const [sources, setSources] = useState<DashboardNoticeSources>({});
  const replaceSource = useCallback((source: string, notices: DashboardNotice[]) => {
    setSources((current) => replaceDashboardNoticeSource(current, source, notices));
  }, []);
  const removeSource = useCallback((source: string) => {
    setSources((current) => removeDashboardNoticeSource(current, source));
  }, []);
  const notices = useMemo(() => dashboardNoticesFromSources(sources), [sources]);
  const value = useMemo(() => ({ notices, replaceSource, removeSource }), [notices, removeSource, replaceSource]);

  return <DashboardNoticeContext.Provider value={value}>{children}</DashboardNoticeContext.Provider>;
}

export function DashboardNoticeRegistration({ source, notices }: { source: string; notices: DashboardNotice[] }) {
  const { replaceSource, removeSource } = useDashboardNoticeContext();

  useEffect(() => {
    replaceSource(source, notices);
    return () => removeSource(source);
  }, [notices, removeSource, replaceSource, source]);

  return null;
}

export function DashboardNoticePin({ notices: suppliedNotices }: { notices?: DashboardNotice[] } = {}) {
  const context = useContext(DashboardNoticeContext);
  const notices = suppliedNotices ?? context?.notices ?? [];
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!notices.length) setOpen(false);
  }, [notices.length]);

  if (!notices.length) return null;
  const label = `${notices.length} Dashboard notice${notices.length === 1 ? "" : "s"}`;

  return <div className="dashboard-notice-hub" ref={containerRef}>
    <button
      ref={buttonRef}
      className="dashboard-notice-button"
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="true"
      aria-controls="dashboard-notice-popover"
      onClick={() => setOpen((current) => !current)}
    >
      <Pin size={18} aria-hidden="true" />
      <span className="dashboard-notice-count" aria-hidden="true">{notices.length}</span>
    </button>
    {open && <section id="dashboard-notice-popover" className="dashboard-notice-popover" role="region" aria-labelledby="dashboard-notice-heading">
      <div className="dashboard-notice-popover-header">
        <h2 id="dashboard-notice-heading">Dashboard notices</h2>
        <span>{notices.length}</span>
      </div>
      <ul className="dashboard-notice-list">
        {notices.map((notice) => <li key={notice.id}>
          <strong>{notice.title}</strong>
          <p>{notice.message}</p>
          {notice.href && notice.actionLabel && <Link href={notice.href} onClick={() => setOpen(false)}>{notice.actionLabel}</Link>}
        </li>)}
      </ul>
    </section>}
  </div>;
}

function useDashboardNoticeContext() {
  const context = useContext(DashboardNoticeContext);
  if (!context) throw new Error("DashboardNoticeRegistration must be used inside DashboardNoticeProvider.");
  return context;
}
