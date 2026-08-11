import { cn } from "@/lib/utils";

const PARTICLES = [
  { left: "6%", size: 10, duration: "9s", delay: "0s" },
  { left: "16%", size: 6, duration: "7s", delay: "1.2s" },
  { left: "27%", size: 14, duration: "11s", delay: "0.4s" },
  { left: "38%", size: 8, duration: "8s", delay: "2.1s" },
  { left: "49%", size: 5, duration: "6.5s", delay: "0.8s" },
  { left: "58%", size: 12, duration: "10s", delay: "1.6s" },
  { left: "69%", size: 7, duration: "7.5s", delay: "0.2s" },
  { left: "78%", size: 16, duration: "12s", delay: "2.6s" },
  { left: "87%", size: 9, duration: "9.5s", delay: "1s" },
  { left: "94%", size: 6, duration: "8.5s", delay: "1.9s" },
];

export function AuroraBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}
    >
      <div
        className="animate-aurora-spin absolute left-1/2 top-[-30%] h-[900px] w-[900px] -translate-x-1/2 opacity-40"
        style={{
          backgroundImage:
            "conic-gradient(from 0deg, transparent 0%, oklch(0.85 0.08 235 / 0.5) 20%, transparent 40%, transparent 60%, oklch(0.8 0.09 245 / 0.45) 80%, transparent 100%)",
        }}
      />

      <div className="animate-aurora-1 absolute -left-[8%] -top-[22%] h-[600px] w-[600px] rounded-full bg-gradient-to-br from-sky-400/65 via-blue-300/50 to-transparent blur-[80px]" />
      <div className="animate-aurora-2 absolute -right-[10%] top-[-5%] h-[560px] w-[560px] rounded-full bg-gradient-to-br from-blue-400/60 via-cyan-300/45 to-transparent blur-[80px]" />
      <div className="animate-aurora-3 absolute bottom-[-22%] left-[16%] h-[520px] w-[520px] rounded-full bg-gradient-to-br from-cyan-300/55 via-sky-200/45 to-transparent blur-[80px]" />
      <div className="animate-aurora-4 absolute bottom-[-10%] right-[8%] h-[420px] w-[420px] rounded-full bg-gradient-to-br from-sky-300/50 via-white/40 to-transparent blur-[70px]" />

      {PARTICLES.map((particle, index) => (
        <span
          key={index}
          className="animate-float-particle absolute bottom-0 rounded-full bg-gradient-to-b from-sky-300/70 to-blue-400/40 shadow-[0_0_12px_rgba(125,180,255,0.7)]"
          style={{
            left: particle.left,
            width: particle.size,
            height: particle.size,
            animationDuration: particle.duration,
            animationDelay: particle.delay,
          }}
        />
      ))}

      <div
        className="absolute inset-0 opacity-[0.45] [mask-image:radial-gradient(ellipse_65%_55%_at_50%_0%,#000_35%,transparent_100%)]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
    </div>
  );
}
