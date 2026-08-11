import Image from "next/image";
import { cn } from "@/lib/utils";

export function LogoMark({
  size = 32,
  invert = false,
  className,
}: {
  size?: number;
  invert?: boolean;
  className?: string;
}) {
  return (
    <Image
      src="/logo-mark.png"
      alt="TalentSift AI"
      width={size}
      height={size}
      priority
      className={cn(invert && "brightness-0 invert", className)}
    />
  );
}

export function LogoFull({
  height = 40,
  invert = false,
  className,
}: {
  height?: number;
  invert?: boolean;
  className?: string;
}) {
  const width = Math.round(height * (1774 / 887));
  return (
    <Image
      src="/logo-full.png"
      alt="TalentSift AI"
      width={width}
      height={height}
      priority
      className={cn(invert && "brightness-0 invert", className)}
    />
  );
}
