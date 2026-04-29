"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Shield, ShieldCheck } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { MAX_PRIVATE_DELAY_MS } from "@/lib/private-routing";

interface PrivateRoutingControlsProps {
  id: string;
  label: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  summary: string;
  disabledDescription: string;
  minDelayMs: number;
  maxDelayMs: number;
  onDelayRangeChange: (values: number[]) => void;
  split: number;
  onSplitChange: (split: number) => void;
  compact?: boolean;
  children?: ReactNode;
}

export function PrivateRoutingControls({
  id,
  label,
  enabled,
  onEnabledChange,
  summary,
  disabledDescription,
  minDelayMs,
  maxDelayMs,
  onDelayRangeChange,
  split,
  onSplitChange,
  compact = false,
  children,
}: PrivateRoutingControlsProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    const contentNode = contentRef.current;
    if (!contentNode) return;

    const updateContentHeight = () => {
      setContentHeight(contentNode.scrollHeight);
    };

    updateContentHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateContentHeight();
    });

    resizeObserver.observe(contentNode);

    return () => {
      resizeObserver.disconnect();
    };
  }, [children, compact]);

  return (
    <div className="rounded-xl border border-border/30 bg-[var(--surface-inner)] transition-colors group hover:border-border/60">
      <label
        htmlFor={id}
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-3 px-4 select-none",
          compact ? "py-2.5" : "py-3"
        )}
      >
        <div
          className={cn(
            "flex min-w-0 items-center",
            compact ? "gap-2.5" : "gap-3"
          )}
        >
          {enabled ? (
            <ShieldCheck
              className={cn(
                "shrink-0 text-primary",
                compact ? "h-4 w-4" : "h-5 w-5"
              )}
            />
          ) : (
            <Shield
              className={cn(
                "shrink-0 text-muted-foreground transition-colors group-hover:text-foreground",
                compact ? "h-4 w-4" : "h-5 w-5"
              )}
            />
          )}
          <div className="min-w-0 text-left">
            <div className="text-sm font-medium text-foreground">{label}</div>
            <div className="truncate text-xs text-muted-foreground">
              {enabled ? summary : disabledDescription}
            </div>
          </div>
        </div>

        <div className="relative shrink-0">
          <input
            id={id}
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
            className="sr-only peer"
          />
          <div
            className={cn(
              "h-8 w-[52px] rounded-full border-2 transition-all duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
              enabled
                ? "border-primary bg-primary"
                : "border-muted-foreground/50 bg-transparent"
            )}
          />
          <div
            className={cn(
              "absolute rounded-full shadow-md transition-all duration-200 ease-in-out",
              enabled
                ? "left-[24px] top-1 h-6 w-6 bg-primary-foreground"
                : "left-[6px] top-[6px] h-5 w-5 bg-muted-foreground"
            )}
          />
          {enabled && (
            <Check className="pointer-events-none absolute left-[24px] top-1 h-6 w-6 p-1 text-primary" />
          )}
        </div>
      </label>

      <div
        className={cn(
          "overflow-hidden transition-all duration-300 ease-in-out",
          enabled ? "opacity-100" : "opacity-0"
        )}
        style={{ maxHeight: enabled ? `${contentHeight}px` : "0px" }}
      >
        <div ref={contentRef}>
          {children && (
            <div
              className={cn(
                "border-t border-border/20 px-4",
                compact ? "py-2.5" : "py-3"
              )}
            >
              {children}
            </div>
          )}

          <div
            className={cn(
              "flex items-center border-t border-border/20 px-4",
              compact ? "gap-1.5 pb-2 pt-1.5" : "gap-2 pb-2.5 pt-2"
            )}
          >
            <div className="min-w-0 flex-1 px-1">
              <Slider
                aria-label={`${label} delay range`}
                value={[minDelayMs, maxDelayMs]}
                min={0}
                max={MAX_PRIVATE_DELAY_MS}
                step={1000}
                onValueChange={onDelayRangeChange}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {[1, 2, 4].map((preset) => {
                const isActive = split === preset;

                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onSplitChange(preset)}
                    className={cn(
                      "h-6 min-w-6 rounded-full px-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            <input
              type="number"
              aria-label="Custom split count"
              min={1}
              max={10}
              step={1}
              value={split}
              onChange={(event) => {
                const nextValue = Number.parseInt(event.target.value, 10);
                onSplitChange(Number.isNaN(nextValue) ? 1 : nextValue);
              }}
              className="h-6 w-10 shrink-0 rounded-lg border border-border/50 bg-background px-1.5 text-center text-[11px] text-foreground outline-none transition-[color,box-shadow] [appearance:textfield] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
