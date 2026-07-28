"use client";
import { useRouter } from "next/navigation";

export function SmeProjectModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return <div className="modal-backdrop sme-project-modal-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.currentTarget === event.target) router.back();
  }}><section className="sme-project-modal" role="dialog" aria-modal="true" aria-label="SME project detail">
    <button className="sme-project-modal-close" type="button" aria-label="Close project detail" onClick={() => router.back()}>×</button>
    {children}</section></div>;
}
