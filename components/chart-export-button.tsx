"use client";

import React, { RefObject } from "react";
import { ChartExportIcon } from "@/components/chart-export-icon";
import { exportChartAsImage } from "@/lib/reporting/chart-export";

export function ChartExportButton({ containerRef, filename, title, description, filterSections }: {
  containerRef: RefObject<HTMLElement | null>;
  filename: string;
  title?: string;
  description?: string;
  filterSections?: { label: string; lines: string[] }[];
}) {
  return <button
    type="button"
    className="chart-icon-button"
    title="Export chart as image"
    aria-label="Export chart as image"
    onClick={() => exportChartAsImage(containerRef.current, filename, { title, description, filterSections })}
  ><ChartExportIcon /></button>;
}
