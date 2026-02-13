import {
  Directive, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output,
  SimpleChanges, inject, NgZone,
} from '@angular/core';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import type { YMap } from '@yandex/ymaps3-types';
import { YMapComponent, YReadyEvent } from 'angular-yandex-maps-v3';

declare const ymaps3: any;

@Directive({
  selector: 'y-map-hybrid',
  standalone: true,
})
export class YMapHybridLayerDirective implements OnInit, OnDestroy, OnChanges {
  private readonly ngZone = inject(NgZone);
  private readonly yMapComponent = inject<YMapComponent>(YMapComponent);
  private readonly destroy$ = new Subject<void>();

  private map?: YMap;
  private satellite?: any; // YMapDefaultSatelliteLayer
  private schemeLabels?: any; // YMapDefaultSchemeLayer (labels/icons-only)

  @Input() visible = true;

  // Порядок: спутник ниже, подписи/иконки выше
  @Input() zIndexSatellite = 1000;
  @Input() zIndexLabels = 2100; // labels
  @Input() zIndexIcons = 2050;  // icons (по желанию)

  /** Опционально — прозрачность подписей (0..1) */
  @Input() labelsOpacity?: number;

  @Output() ready =
    new EventEmitter<YReadyEvent<{ satellite: any; labels: any }>>();

  ngOnInit() {
    this.yMapComponent.map$
      .pipe(filter((m): m is YMap => !!m), takeUntil(this.destroy$))
      .subscribe((map) => {
        this.map = map;
        this.mount();
      });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!this.map) return;

    if ('visible' in changes && !changes['visible'].firstChange) {
      this.applyVisibility();
    }
    if ('zIndexSatellite' in changes && this.satellite?.setProps) {
      this.satellite.setProps({ zIndex: this.zIndexSatellite });
    }
    if (('zIndexLabels' in changes || 'zIndexIcons' in changes) && this.schemeLabels?.update) {
      this.schemeLabels.update({
        layers: {
          // указываем только нужные под-слои
          icons: { zIndex: this.zIndexIcons },
          labels: { zIndex: this.zIndexLabels },
        },
      });
    }
    if ('labelsOpacity' in changes && this.schemeLabels?.update && this.labelsOpacity != null) {
      // прозрачность подписей через кастомизацию схемы
      this.schemeLabels.update({
        customization: [{
          // применяем ко всем подписям
          elements: 'label.text',
          stylers: [{ opacity: this.labelsOpacity }]
        }]
      });
    }
  }

  ngOnDestroy() {
    this.ngZone.runOutsideAngular(() => {
      try {
        if (this.schemeLabels && this.map) this.map.removeChild(this.schemeLabels);
        if (this.satellite && this.map) this.map.removeChild(this.satellite);
      } catch {}
      this.schemeLabels = undefined;
      this.satellite = undefined;
    });
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ---- private ----

  private async mount() {
    if (!this.map) return;
    await (ymaps3?.ready ?? Promise.resolve());

    this.ngZone.runOutsideAngular(() => {
      // 1) Спутник — базовый слой
    //   this.satellite = new ymaps3.YMapDefaultSatelliteLayer({
    //     zIndex: this.zIndexSatellite,
    //   });

      // 2) Подписи/иконки из схемы — БЕЗ ground/buildings
      this.schemeLabels = new ymaps3.YMapDefaultSchemeLayer({
        layers: {
          icons:  { zIndex: this.zIndexIcons },
          labels: { zIndex: this.zIndexLabels },
        }
      });

      if (this.visible) {
       // this.map!.addChild(this.satellite);
        this.map!.addChild(this.schemeLabels);
      }

      //this.ready.emit({ ymaps3, entity: { satellite: this.satellite, labels: this.schemeLabels } as any });
    });
  }

  private applyVisibility() {
    if (!this.map) return;
    const add = (l: any) => { try { this.map!.addChild(l); } catch {} };
    const rm  = (l: any) => { try { this.map!.removeChild(l); } catch {} };

    if (this.visible) {
      if (this.satellite) add(this.satellite);
      if (this.schemeLabels) add(this.schemeLabels);
    } else {
      if (this.schemeLabels) rm(this.schemeLabels);
      if (this.satellite) rm(this.satellite);
    }
  }
}