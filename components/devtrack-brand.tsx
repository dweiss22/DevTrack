import Image from "next/image";
import Link from "next/link";
import devTrackIcon from "@/images/favicon.png";

export function DevTrackBrand({ href = "/", className = "brand" }: { href?: string; className?: string }) {
  return <Link className={className} href={href} aria-label="DevTrack home">
    <Image className="brand-icon" src={devTrackIcon} alt="" width={40} height={40} priority />
    <span className="brand-copy"><strong>DevTrack</strong><small>Wrike reporting</small></span>
  </Link>;
}
