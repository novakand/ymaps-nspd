import {
    Directive,
    EventEmitter,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    SimpleChanges,
    inject,
    NgZone,
} from '@angular/core';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import type { YMap } from '@yandex/ymaps3-types';
import { YMapComponent, YReadyEvent } from 'angular-yandex-maps-v3';

declare const ymaps3: any;

@Directive({
    selector: 'y-map-satellite',
    standalone: true,
})
export class YMapSatelliteLayerDirective implements OnInit, OnDestroy, OnChanges {
    private readonly ngZone = inject(NgZone);
    private readonly yMapComponent = inject<YMapComponent>(YMapComponent);

    private readonly destroy$ = new Subject<void>();

    private source?: any
    private map?: YMap;
    @Input() props!: any;
    @Output() ready: EventEmitter<YReadyEvent<any>> = new EventEmitter();

    public ngOnInit() {
        this.yMapComponent.map$
            .pipe(
                filter((m): m is YMap => !!m),
                takeUntil(this.destroy$)
            )
            .subscribe((map) => {
                this.map = map;
                this.ngZone.runOutsideAngular(() => {
                    this.source = new ymaps3.YMapDefaultSatelliteLayer(this.props);
                    this.map!.addChild(this.source);
                    this.ready.emit({ ymaps3, entity: this.source });
                });
            });
    }

    public ngOnChanges(changes: SimpleChanges) {
    }

    public ngOnDestroy() {
        this.ngZone.runOutsideAngular(() => {
            try {
                if (this.source && this.map) {
                    this.map.removeChild(this.source);
                }
            } catch {

            }
            this.source = undefined;
        });

        this.destroy$.next();
        this.destroy$.complete();
    }
}
