import { Pipe } from "@angular/core";

@Pipe({ name: 'zoomToFs', standalone: true, pure: true })
export class ZoomToFsPipe {
    transform(z: number, minZ = 12, maxZ = 20, minPx = 10, maxPx = 22): number {
        const t = Math.min(1, Math.max(0, (z - minZ) / (maxZ - minZ)));
        return Math.round(minPx + t * (maxPx - minPx));
    }
}