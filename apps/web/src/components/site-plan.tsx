"use client";

import type { MouseEvent, ReactNode } from "react";
import type { PlanImage } from "@/lib/site";

export type PlanShape = { id: string; points: Array<{ x: number; y: number }>; fill: string; stroke: string; label?: string; opacity?: number };

/** SVG поверх изображения плана; координаты — пиксели изображения. */
export function SitePlan({
  image,
  shapes,
  onPick,
  children,
}: {
  image: PlanImage;
  shapes: PlanShape[];
  onPick?: (point: { x: number; y: number }) => void;
  children?: ReactNode;
}) {
  function pick(event: MouseEvent<SVGSVGElement>) {
    if (!onPick) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPick({
      x: Math.round(((event.clientX - rect.left) / rect.width) * image.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * image.height),
    });
  }
  const unit = Math.max(image.width, image.height) / 100;
  return (
    <svg
      viewBox={`0 0 ${image.width} ${image.height}`}
      className={`block w-full rounded-xl border border-stone-200 bg-stone-100 ${onPick ? "cursor-crosshair" : ""}`}
      onClick={pick}
      role="img"
      aria-label="План площадки с зонами"
    >
      <image href={image.src} x="0" y="0" width={image.width} height={image.height} />
      {shapes.map((shape) => {
        if (shape.points.length < 3) return null;
        const middle = shape.points.reduce((acc, p) => ({ x: acc.x + p.x / shape.points.length, y: acc.y + p.y / shape.points.length }), { x: 0, y: 0 });
        return (
          <g key={shape.id}>
            <polygon
              points={shape.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={shape.fill}
              fillOpacity={shape.opacity ?? 0.35}
              stroke={shape.stroke}
              strokeWidth={unit * 0.4}
            />
            {shape.label ? (
              <text x={middle.x} y={middle.y} textAnchor="middle" fontSize={unit * 3} fontWeight={600} fill="#173f31" stroke="#fff" strokeWidth={unit * 0.5} paintOrder="stroke">
                {shape.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {children}
    </svg>
  );
}
