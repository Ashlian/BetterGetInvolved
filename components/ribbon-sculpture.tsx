'use client';

import {useMemo} from 'react';
import {motion, useReducedMotion} from 'motion/react';

type Point = [number, number, number];
const TAU = Math.PI * 2;
const STEPS = 28;
const DEFAULT_PALETTE = ['#cc0033', '#f0b8aa', '#b9a2e6'];

function mix(hex: string, light: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  const target = light < 0 ? [34, 9, 29] : [255, 239, 223];
  const rgb = [16, 8, 0].map((shift, index) => {
    const channel = (value >> shift) & 255;
    return Math.round(channel + (target[index] - channel) * Math.abs(light));
  });
  return `rgb(${rgb.join(', ')})`;
}

function mesh(seed: number, complexity: number, palette: string[]) {
  const phase = (seed % 360) * TAU / 360;
  const pitch = .43 + ((seed >>> 8) % 23) / 100;
  const width = 19 + (complexity % 7) * 2;
  const weave = 2 + (seed % 2);

  function position(t: number, band: number, edge: number): Point {
    const angle = t + band * TAU / 3;
    const curl = weave * t + phase + band * 1.3;
    const radius = (band === 0 ? 138 : 118 + band * 5) + 29 * Math.sin(curl) + edge * width * Math.cos(curl);
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle) * .83;
    const z = 57 * Math.sin(2 * t + phase + band) + edge * width * Math.sin(curl) + (band - 1) * 26;
    return [x * .96 - z * .28, y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)];
  }

  function project([x,y,z]: Point) {
    const lens = 610 / (610 - z);
    return `${(245 + x * lens).toFixed(1)} ${(227 + y * lens).toFixed(1)}`;
  }

  return Array.from({length: STEPS * 3}, (_, index) => {
    const band = Math.floor(index / STEPS);
    const step = index % STEPS;
    const start = step * TAU / STEPS;
    const end = (step + 1) * TAU / STEPS + .005;
    const points = [position(start,band,-1), position(end,band,-1), position(end,band,1), position(start,band,1)];
    const depth = points.reduce((sum, point) => sum + point[2], 0) / points.length;
    const illumination = Math.sin(start * 2 + band + phase) * .29 + depth / 420 - .08;
    return {key:index, depth, d:`M ${points.map(project).join(' L ')} Z`, color:mix(palette[band % palette.length], illumination)};
  }).sort((a,b) => a.depth - b.depth);
}

/** Orthographic-style SVG display with perspective projection and depth-sorted ribbon faces. */
export function RibbonFaces({seed, complexity = 3, palette = DEFAULT_PALETTE, morph = false}: {
  seed: number; complexity?: number; palette?: string[]; morph?: boolean;
}) {
  const reduced = useReducedMotion();
  const faces = useMemo(() => mesh(seed, complexity, palette), [seed, complexity, palette]);
  return <>{faces.map(face => <motion.path key={face.key} d={face.d} fill={face.color} stroke={face.color} strokeWidth=".7"
    initial={false} animate={morph && !reduced ? {d:face.d, fill:face.color, stroke:face.color} : undefined}
    transition={{duration:.65,ease:'easeInOut'}}/>)}</>;
}
