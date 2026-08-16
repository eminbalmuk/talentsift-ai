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
  const width = Math.round(size * (229 / 214));
  return (
    <Image
      src="/logo-mark.png"
      alt="TalentSift AI"
      width={width}
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
  const width = Math.round(height * (846 / 468));
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
