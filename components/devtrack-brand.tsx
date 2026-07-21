import Image from "next/image";
import Link from "next/link";
import React from "react";
import devTrackIcon from "@/images/favicon.png";

export function DevTrackBrand({ href = "/", className = "brand" }: { href?: string; className?: string }) {
  return <Link className={className} href={href} aria-label="DevTrack home">
    <Image className="brand-icon" src={devTrackIcon} alt="" width={40} height={40} priority />
    <span className="brand-copy"><strong>DevTrack</strong><small>Development Analysis</small></span>
  </Link>;
}
