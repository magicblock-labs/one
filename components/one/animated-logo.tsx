"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type AnimationItem = import("lottie-web").AnimationItem;

export function AnimatedLogo({ className }: { className?: string }) {
  const idleRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const hoverAnimationRef = useRef<AnimationItem | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    let isMounted = true;

    void import("lottie-web").then(({ default: lottie }) => {
      if (!isMounted || !idleRef.current || !hoverRef.current) return;

      const idleAnimation = lottie.loadAnimation({
        container: idleRef.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        path: "/animations/magicblock-logo-idle.json",
      });

      const hoverAnimation = lottie.loadAnimation({
        container: hoverRef.current,
        renderer: "svg",
        loop: false,
        autoplay: false,
        path: "/animations/magicblock-logo-hover.json",
      });

      hoverAnimationRef.current = hoverAnimation;
      cleanupRef.current = () => {
        idleAnimation.destroy();
        hoverAnimation.destroy();
      };
    });

    return () => {
      isMounted = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
      hoverAnimationRef.current = null;
    };
  }, []);

  useEffect(() => {
    const hoverAnimation = hoverAnimationRef.current;
    if (!hoverAnimation) return;

    if (isHovered) {
      hoverAnimation.goToAndPlay(0, true);
      return;
    }

    hoverAnimation.stop();
  }, [isHovered]);

  return (
    <div
      className={cn("relative h-6 w-[7.75rem] shrink-0", className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
    >
      <div
        ref={idleRef}
        className={cn(
          "absolute inset-0 transition-opacity duration-200",
          isHovered ? "opacity-0" : "opacity-100"
        )}
      />
      <div
        ref={hoverRef}
        className={cn(
          "absolute inset-0 transition-opacity duration-200",
          isHovered ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
}
