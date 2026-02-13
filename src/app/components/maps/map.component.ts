import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, NgZone, PLATFORM_ID, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
    YMapComponent, YMapControlDirective, YMapControlsDirective,
    YMapDefaultFeaturesLayerDirective,
    YMapListenerDirective,
    YMapMarkerDirective,
} from 'angular-yandex-maps-v3';
import { RouterModule } from '@angular/router';
import { MapService } from './services/map-service';
import { BehaviorSubject, debounceTime, distinctUntilChanged, filter, map, Observable, shareReplay, startWith, Subject, take, takeUntil, tap } from 'rxjs';
import { BBox } from 'geojson';
import { MapEventManager } from './services/map-event-manager';
import { YMapFeatureDirective } from './directives/y-map-feature.directive';
import { YMapFeatureDataSourceDirective } from './directives/y-map-feature-data-source.directive';
import { YMapLayerDirective } from './directives/y-map-layer.directive';
import { LayoutService } from '../../services/layout.service';
import { YMapSatelliteLayerDirective } from './directives/ymap-satelite-layer.directive';
import { YMapDefaultSchemeLayerDirective } from './directives/y-map-default-scheme-layer.directive';
import { ParcelsService } from '../../services/parcels.service';
import { OtherService } from '../../services/other.service';
import { ZoomToFsPipe } from '../../pipes/text-zoom.pipe';
import { BoundariesService } from '../../services/boundaries.service';
import { PointsService } from '../../services/points.service';
import { layerId, rasterDataSource } from './constants/canvas-tiles.datasource';
import { YMapTileDataSourceDirective } from './directives/y-map-tile-data-source.directive';
import { CanvasOverlaySource, LngLat } from './constants/canvas-overlay-source';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ZoomToScalePipe } from '../../pipes/zoom-scale.directive';
import { YMapMouseDirective } from './directives/y-map-mouse.directive';
type Bounds = [[number, number], [number, number]];
type ControlsProps = { position: any; orientation: 'vertical' | 'horizontal' };
type Basemap = 'scheme' | 'hybrid';
@Component({
    selector: 'app-map',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        YMapComponent,
        YMapDefaultSchemeLayerDirective,
        YMapDefaultFeaturesLayerDirective,
        YMapFeatureDataSourceDirective,
        YMapFeatureDirective,
        YMapLayerDirective,
        YMapMarkerDirective,
        YMapSatelliteLayerDirective,
        ZoomToFsPipe,
        ZoomToScalePipe,
        YMapListenerDirective,
        YMapControlsDirective,
        YMapControlDirective,
        YMapTileDataSourceDirective,
        YMapMouseDirective
    ],
    templateUrl: './map.component.html',
    styleUrls: ['./map.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})

export class MapComponent {

    private selectedId: string | null = null;
    private originalFill = new Map<string, { fill: any; fillOpacity: number }>();
    public popup: any;
    public legend = [
        // { swatch: '#71975b', text: 'Свободно' },
        // { swatch: '#f6a000', text: 'Забронировано' },
        // { swatch: '#E73626', text: 'Продано' },
        // { icon: 'arrow', text: 'Въезд' },
        // { num: 1, text: 'Гостевая парковка' },
        // { num: 2, text: 'Здание администрации' },
        // { num: 3, text: 'Спорт площадка' },
        // { num: 4, text: 'Детская площадка' },
        // { num: 5, text: 'Площадка для сбора ТБО' },
        // { num: 6, text: 'Пожарный пруд' },
        // { num: 7, text: 'Объекты инженерного обеспечения' },
        // { num: 8, text: 'Лесная тропа' },

    ];
    public center = signal<[number, number]>([35.576870, 55.675067]);
    public mapMode = signal<'vector' | 'raster'>('vector');
    public zoom = signal<number>(19);
    public theme = signal<'light' | 'dark'>('light');
    public bounds = signal<[[number, number], [number, number]]>([[-83.8, -170.8], [83.8, 170.8]]);
    public zoomRange = signal({ min: 5, max: 22 });
    public basemap = signal<any>('scheme');
    public arrowDeg = 0;
    private selected: { ent?: any; id?: string } | null = null;
    public isMapLoad = false;
    public isCityBoundaries = false;
    private map?: any;
    public isVisible = false;
    public isVisibleSidebarBottom = false;
    public routeFeature: any;
    public markerFeatures: any;
    public pontFeatures: any = [];
    public citiesFeatures: any | null = null;
    public parcelsFeatures: any[] = [];
    public otherFeatures: any[] = [];
    public boundariesFeatures: any[] = [];
    public parcelLabels: Array<{
        id: string;
        coords: any;
        name: string;
        area?: number | string;
        statusLabel: any,
        labelKind: string
        isLabel: any
    }> = [];


    public labelMinZoom = 17;
    public currentZoom = 0;
    private _eventManager: MapEventManager = new MapEventManager(inject(NgZone));
    private _bounds = this._eventManager.getLazyEmitter<{ location: { bounds: any } }>('onUpdate');
    private zoom$ = new BehaviorSubject<number>(this.zoom());
    private bounds$ = new BehaviorSubject<BBox | null>(null);
    private _destroy$ = new Subject<boolean>();
    public selectedInfo: { id?: string; name?: string; area?: number; statusLabel?: string } | null = null;
    overlays: CanvasOverlaySource[];
    controlsProps: ControlsProps = { position: 'bottom right', orientation: 'vertical' };
    private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
    private readonly MOBILE_BP = 600;
    constructor(
        public cdr: ChangeDetectorRef,
        public mapService: MapService,
        private parcels: ParcelsService,
        private other: OtherService,
        private pointService: PointsService,
        private boundariesService: BoundariesService,
        public layoutService: LayoutService,
    ) {

    }

    layerProps = {
        source: layerId,
        transparent: true,
        type: layerId,
        zIndex: 2010,
    } as const;

    private bo = inject(BreakpointObserver);

    setBasemap(v: Basemap) { this.basemap.set(v); }

    controlsProps$: Observable<ControlsProps> = this.bo
        .observe(['(max-width: 600px)'])
        .pipe(
            map(state => ({
                position: state.matches ? 'bottom left' : 'bottom right',
                orientation: 'vertical' as const
            })),
            startWith({ position: 'bottom right' as const, orientation: 'vertical' as const }),
            shareReplay({ bufferSize: 1, refCount: true })
        );


    private mercatorXY([lon, lat]: [number, number]) {
        const R = 20037508.34;
        const x = (lon * R) / 180;
        const ydeg = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
        return { x, y: (ydeg * R) / 180 };
    }

    private bearingDegFrom(a: [number, number], b: [number, number]) {
        const A = this.mercatorXY(a), B = this.mercatorXY(b);
        return Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI;
    }

    trackByIdFeature = (_: number, f: any) => `${f.id}::${f.__rev ?? 0}`;

    private patchParcelById(id: string, patch: Partial<any>) {
        const idx = this.parcelsFeatures.findIndex(x => String(x.id) === id);
        if (idx === -1) return;

        const f = this.parcelsFeatures[idx];
        const next = { ...f, ...patch, __rev: (f.__rev ?? 0) + 1 };

        this.parcelsFeatures = [
            ...this.parcelsFeatures.slice(0, idx),
            next,
            ...this.parcelsFeatures.slice(idx + 1),
        ];
        this.cdr.markForCheck();
    }

    private getEntityId(ent: any): string | null {
        const p = ent?._props;
        return (
            p?.properties?.id ??
            p?.id ??
            (typeof ent?.id === 'function' ? ent.id() : ent?.id) ??
            null
        );
    }

    public closePopup() {
        this.unselectCurrent();
        this.popup = null;
    }

    private findParcelByMarkerProps(props: any) {
        if (!props) return null;
        const p = props;

        return (
            this.parcelsFeatures.find(f => String(f.id) === String(p.id)) ||
            this.parcelsFeatures.find(f => String(f.properties?.interactionId) === String(p.id)) ||
            this.parcelsFeatures.find(f => String(f.properties?.externalKey) === String(p.externalKey)) ||
            this.parcelsFeatures.find(f => String(f.properties?.label) === String(p.label)) ||
            null
        );
    }


    private selectById(id: string) {
        const f = this.parcelsFeatures.find(x => String(x.id) === String(id));
        if (!f) return;

        if (this.selected?.id === String(id)) {
            this.unselectCurrent();
            return;
        }

        this.unselectCurrent();

        if (!f.__orig) {
            f.__orig = { fill: f.style?.fill, fillOpacity: f.style?.fillOpacity };
        }

        const sel = f.properties?.selectedFillColor || f.properties?.fillColor;
        this.patchParcelById(id, { style: { ...(f.style ?? {}), fill: sel, fillOpacity: f.properties?.fillOpacity } });

        this.selected = { id: String(id) };
    }

    private unselectCurrent() {
        if (!this.selectedId) return;
        const id = this.selectedId;
        const f = this.parcelsFeatures.find(x => String(x.id) === id);
        const orig = this.originalFill.get(id);
        if (f && orig) {
            this.patchParcelById(id, { style: { ...(f.style ?? {}), fill: orig.fill, fillOpacity: orig.fillOpacity } });
        }
        this.originalFill.delete(id);
        this.selectedId = null;
    }
    private getIdFromMarker(ent: any): string | null {
        const p = ent?._props;
        return (p?.properties?.id ?? p?.id ?? (typeof ent?.id === 'function' ? ent.id() : ent?.id))?.toString() ?? null;
    }

    private getCoordsFromMarker(ent: any): any | null {
        const c = ent?._props?.coordinates ?? ent?.geometry?.coordinates;
        return Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' ? [c[0], c[1]] : null;
    }

    private getIdFromParcel(ent: any): string | null {
        const p = ent?._props;
        return (p?.id ?? (typeof ent?.id === 'function' ? ent.id() : ent?.id))?.toString() ?? null;
    }

    onClickCoord = (target, event) => {
        const [lon, lat] = event.coordinates;
        console.log([lon, lat])
        const [x, y] = event.screenCoordinates;
    }

    public onClickMap = (evt: any) => {
        const ent = evt?.entity;
        const src = evt?.source;

        if (!ent || !src) {
            this.closePopup();
            this.unselectCurrent();
            return;
        }

        if (src === 'marker') {
            const id = this.getIdFromMarker(ent);
            const coords = this.getCoordsFromMarker(ent);
            const data = ent?._props?.properties ?? {};
            if (id && coords) {
                this.popup = { id, coords, data };
                this.toggleSelect(id);
            }
            return;
        }

        if (src === 'parcels') {
            const id = this.getIdFromParcel(ent);
            if (id) {

                this.popup = { id, coords: ent?.properties.center, data: ent?._props?.properties ?? {} };
                console.log(this.popup);
                this.toggleSelect(id);
            }
        }
    };

    private toggleSelect(id: string) {
        if (this.selectedId === id) { this.unselectCurrent(); return; }
        this.unselectCurrent();
        const f = this.parcelsFeatures.find(x => String(x.id) === id);
        if (!f) return;
        if (!this.originalFill.has(id)) {
            this.originalFill.set(id, { fill: f.style?.fill, fillOpacity: f.style?.fillOpacity });
        }
        const sel = f.properties?.selectedFillColor || '#9c27b0';
        this.patchParcelById(id, { style: { ...(f.style ?? {}), fill: sel, fillOpacity: 1 } });
        this.selectedId = id;
    }


    public onClickFeature = (evt: any) => {
        const ent = evt?.entity;
        if (!ent || evt.source !== 'parcels') return;

        const id = this.getEntityId(ent);
        if (!id) return;

        this.selectById(String(id));
    };

    public onClickMarker(evt: any) {
        const ent = evt?.entity;
        if (!ent || evt.source !== 'marker') return;

        const props = ent._props?.properties ?? {};
        let id = this.getEntityId(ent);
        if (!id) id = props?.id;

        if (id) {
            const f = this.parcelsFeatures.find(x => String(x.id) === String(id));
            if (f) { this.selectById(String(id)); return; }
        }

        const byProps = this.findParcelByMarkerProps(props);
        if (byProps) { this.selectById(String(byProps.id)); }
    };

    public setArrowAngleByRoad(p1: [number, number], p2: [number, number]) {
        this.arrowDeg = this.bearingDegFrom(p1, p2);
    }

    public visitPositions(input: any, cb: (lon: number, lat: number) => void): void {
        if (!input) return;

        if (typeof input.type === 'string' && 'coordinates' in input) {
            this.visitPositions((input as any).coordinates, cb);
            return;
        }

        if (input && input.type === 'GeometryCollection' && Array.isArray(input.geometries)) {
            for (const g of input.geometries) this.visitPositions(g, cb);
            return;
        }

        if (Array.isArray(input)) {
            if (typeof input[0] === 'number') {
                const [lon, lat] = input as [number, number, ...number[]];
                if (Number.isFinite(lon) && Number.isFinite(lat)) cb(lon, lat);
            } else {
                for (const part of input) this.visitPositions(part, cb);
            }
        }
    }

    public boundsFromFeatures(features: Array<{ geometry: any }>): Bounds | null {
        let minLon = Infinity, minLat = Infinity;
        let maxLon = -Infinity, maxLat = -Infinity;
        let touched = false;

        for (const f of features) {
            this.visitPositions(f.geometry, (lon, lat) => {
                touched = true;
                if (lon < minLon) minLon = lon;
                if (lon > maxLon) maxLon = lon;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            });
        }

        if (!touched) return null;

        const padLon = (maxLon - minLon) * 0.02 || 0.0002;
        const padLat = (maxLat - minLat) * 0.02 || 0.0002;

        return [[minLon - padLon, minLat - padLat], [maxLon + padLon, maxLat + padLat]];
    }

    public schemeProps: any = {
        source: 'scheme',
        visible: true,
        layers: {
            ground: { zIndex: 1500 },
            labels: { zIndex: 2000 },
            icons: { zIndex: 2050 },
            buildings: { zIndex: 1600 },
        },
        customization: {
            style: [

                {
                    tags: { any: ['land', 'landcover', 'terrain', 'landscape', 'admin', 'transit'] },
                    elements: 'geometry', stylers: [{ opacity: 0 }]
                },

                {
                    tags: { any: ['building'] },
                    elements: 'geometry', stylers: [{ opacity: 0 }]
                },


                { tags: { any: ['water'] }, elements: 'geometry', stylers: [{ opacity: 0 }] },
            ]
        }
    };

    public onMapReady(ev: { entity: any; ymaps3: typeof ymaps3 }) {

        this.map = ev.entity;
        this.isMapLoad = true;
        this.mapService.load$.next(this.map);
        this._eventManager.setTarget(this.map);

        this._eventManager
            .getLazyEmitter<{ location?: { zoom?: number } }>('onUpdate')
            .pipe(takeUntil(this._destroy$))
            .subscribe(e => {
                const z = e?.location?.zoom ?? this.map?.zoom ?? 0;
                if (z !== this.currentZoom) {
                    this.currentZoom = z;
                    this.cdr.detectChanges();
                }
            });


        this._watchFoDarkThemeChanges();
        this._watchForBoundsChanges();
        this._onBoundsChange();
        this._watchFoRemoveChanges();
        this.loadParcels();
        this.loadBoundaries();
        this.cdr.detectChanges();

    }

    private _watchFoDarkThemeChanges(): void {
        this.layoutService.configUpdate$
            .pipe(
                tap(() => this.theme.set(this.layoutService.config().darkTheme ? 'dark' : 'light'))
            )
            .subscribe();
    }

    private loadParcels() {
        this.parcels.all$.pipe(take(1)).subscribe(fc => {
            this.parcelsFeatures = (fc.features ?? []).map((f, i) => {
                const props: any = f.properties ?? {};

                return {
                    id: String(f.id ?? `parcel-${i}`),
                    source: 'parcels',
                    geometry: f.geometry,
                    properties: props,
                    style: {
                        stroke: [{ color: props.strokeColor, width: props.strokeWeight, opacity: props.strokeOpacity }],
                        fill: props.fillColor,
                        fillOpacity: props.fillOpacity,
                    }

                };
            });
            this.parcelLabels = (fc.features ?? [])
                .map((f, i) => {
                    const id = String(f.id ?? `parcel-${i}`);
                    const props = f.properties ?? {};
                    const c = props.center as any | undefined;
                    if (!Array.isArray(c) || c.length !== 2 ||
                        !isFinite(+c[0]) || !isFinite(+c[1])) {
                        return null;
                    }

                    const name =
                        props.name ??
                        props.options?.cad_num ??
                        props.label ??
                        props.descr ??
                        id;

                    const area = props.area ?? props.options?.specified_area;

                    return {
                        source: 'markers',
                        id,
                        coords: [Number(c[0]), Number(c[1])] as any,
                        ...f.properties,
                        name,
                        area
                    };
                })
                .filter(Boolean) as any[]

            this.cdr.detectChanges();
        });
    }

    private loadParcels2() {
        this.other.all$.pipe(take(1)).subscribe(fc => {

            this.otherFeatures = (fc.features ?? []).map((f, i) => {
                const props: any = f.properties ?? {};

                return {
                    id: String(f.id ?? `other-${i}`),
                    geometry: f.geometry,
                    properties: props,
                    style: {
                        stroke: [{ color: props.strokeColor, width: props.strokeWeight, opacity: props.strokeOpacity, dash: props?.dash ? props?.dash : [undefined] }],
                        fill: props.fillColor,
                        fillOpacity: props.fillOpacity,
                    }
                };
            });

            this.cdr.detectChanges();
        });
    }



    private loadBoundaries() {
        this.boundariesService.all$
            .pipe(
                take(1))
            .subscribe(fc => {
                this.boundariesFeatures = (fc.features ?? []).map((f, i) => {
                    const props: any = f.properties ?? {};

                    return {
                        id: String(f.id ?? `boundaries-${i}`),
                        geometry: f.geometry,
                        properties: props,
                        style: {
                            stroke: [{ color: props.strokeColor, width: props.strokeWeight, opacity: props.strokeOpacity }],
                            fill: props.fillColor,
                            fillOpacity: props.fillOpacity,
                        }
                    };
                });

                const bounds = this.boundsFromFeatures(this.boundariesFeatures);
                if (bounds) this.fitBounds(bounds);

                this.cdr.detectChanges();
            });
    }


    private _watchFoRemoveChanges(): void {

        this.mapService.remove$
            .pipe(
                tap((isRemove) => {
                    isRemove && this.removeMarkers();
                    isRemove && this.removeRoute();
                    isRemove && this.removeClusters();
                })
            )
            .subscribe()

    }

    private _watchForBoundsChanges(): void {
        this._bounds.pipe(
            map(e => e?.location?.bounds as [[number, number], [number, number]] | undefined),
            filter((b): b is [[number, number], [number, number]] => Array.isArray(b)),
            map(b => this.toBBox(b).map(x => +x.toFixed(5))),
            map(arr => arr.join('|')),
            distinctUntilChanged(),
            debounceTime(100),
        ).pipe(takeUntil(this._destroy$))
            .subscribe(() => this._onBoundsChange());
    }



    public fitBounds(bounds) {
        this.map.update({ location: { bounds, ...{ easing: 'ease-in-out', duration: 600, } } });
    }

    private _onBoundsChange(): void {
        if (!this.map || !this.isCityBoundaries) return;
        this.bounds$.next(this.toBBox(this.map?.bounds));
        this.zoom$.next(this.map?.zoom);
    }

    public withAlpha = (hex: string, a: number) =>
        hex + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0').toUpperCase();

    private toBBox(b: [[number, number], [number, number]]): [number, number, number, number] {
        const west = b[0][0];
        const north = b[0][1];
        const east = b[1][0];
        const south = b[1][1];
        return [west, south, east, north];
    }

    public remove() {
        this.citiesFeatures = [];
        this.cdr.detectChanges();
        return { type: 'FeatureCollection', features: [] };
    }

    public removeMarkers(): void {
        this.markerFeatures = [];
        this.cdr.markForCheck();
    }

    public removeRoute(): void {
        this.routeFeature = null;
        this.cdr.detectChanges();
    }

    public removeClusters(): void {
        this.pontFeatures = [];
        this.cdr.detectChanges();
    }

    public onVisibleChangeSidebar(event: boolean) {
        this.isVisible = event;
    }

    public onChangeSettings(_: any): void {
        this.isVisible = !this.isVisible;
    }

    public onChangeSidebarBottom(event: boolean) {
        this.isVisibleSidebarBottom = event;
    }


    trackById = (_: number, f: any) => f.id;
    trackByMarkerId(index: number, marker: any): string {
        return marker.id;
    }
}
