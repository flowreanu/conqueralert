import scaleData from "../data/scale.json";

export type Measure = "length" | "height" | "footprint";

/** Factorul de scară pentru un model cu dimensiunile brute `size` (după normalizare: lungimea pe X). */
export function fitScale(size: { x: number; y: number; z: number }, target: number, measure: Measure): number {
  const ref = measure === "height" ? size.y : measure === "length" ? size.x : Math.max(size.x, size.z);
  return ref > 1e-6 ? target / ref : 1;
}

export function unitTarget(scaleClass: string): { size: number; measure: Measure } {
  const s = (scaleData.units as Record<string, { size: number; measure: "length" | "height" }>)[scaleClass];
  if (!s) throw new Error(`Clasă de scară necunoscută: ${scaleClass}`);
  return s;
}

export function buildingTargetMeters(sizeClass: string): number {
  const c = (scaleData.buildings as Record<string, { cells: number }>)[sizeClass].cells;
  return c * scaleData.cellSize * scaleData.buildingFill;
}
