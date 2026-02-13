import { Directive, EventEmitter, inject, Input, NgZone, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from "@angular/core";
import { YMapComponent, YReadyEvent } from "angular-yandex-maps-v3";
import { Subject, filter, takeUntil } from "rxjs";
import { YMap, YMapDefaultSchemeLayer, YMapDefaultSchemeLayerProps } from '@yandex/ymaps3-types';
@Directive({
  selector: 'y-map-default-scheme-layer',
  standalone: true,
})
export class YMapDefaultSchemeLayerDirective implements OnInit, OnDestroy, OnChanges {
  private readonly ngZone = inject(NgZone);
  private readonly yMapComponent = inject(YMapComponent);

  private readonly destroy$ = new Subject<void>();

  private layer?: YMapDefaultSchemeLayer;

  /**
   * See the API entity documentation for detailed information. Supports ngOnChanges.
   * {@link https://yandex.ru/dev/jsapi30/doc/ru/ref/#YMapDefaultSchemeLayerProps}
   */
  @Input() props: YMapDefaultSchemeLayerProps = {};

  /**
   * See the API entity documentation for detailed information.
   */
  @Input() options?: any;

  /**
   * The entity instance is created. This event runs outside an Angular zone.
   */
  @Output() ready: EventEmitter<YReadyEvent<YMapDefaultSchemeLayer>> = new EventEmitter<
    YReadyEvent<YMapDefaultSchemeLayer>
  >();

  ngOnInit() {
    this.yMapComponent.map$.pipe(filter(Boolean), takeUntil(this.destroy$)).subscribe((map) => {
      this.layer = new ymaps3.YMapDefaultSchemeLayer(this.props, this.options);
      map.addChild(this.layer);
      this.ready.emit({ ymaps3, entity: this.layer });
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    // It must be run outside a zone; otherwise, all async events within this call will cause ticks.
    this.ngZone.runOutsideAngular(() => {
      if (this.layer) {
        this.layer.update(changes['props'].currentValue);
      }
    });
  }

  ngOnDestroy() {
    if (this.layer) {
      this.yMapComponent.map$.value?.removeChild(this.layer);
    }

    this.destroy$.next();
    this.destroy$.complete();
  }
}