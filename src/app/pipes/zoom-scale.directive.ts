import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'zoomToScale', standalone: true })
export class ZoomToScalePipe implements PipeTransform {
  // z ∈ [zMin..zMax] → s ∈ [sMin..sMax]
  transform(z: number, zMin = 17, sMin = 1, sMax = 2, zMax = 22): number {
    const t = Math.max(0, Math.min(1, (z - zMin) / (zMax - zMin)));
    return +(sMin + t * (sMax - sMin)).toFixed(3);
  }
}