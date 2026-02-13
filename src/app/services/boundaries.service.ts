import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap, tap } from 'rxjs/operators';

type BBox = [number, number, number, number];

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: any[];
  bbox?: BBox;
}

@Injectable({ providedIn: 'root' })
export class BoundariesService {
  private http = inject(HttpClient);

  private readonly BASE = 'assets/data/boundaries';
  private readonly INDEX_URL = `${this.BASE}/index.json`;

  readonly all$: Observable<FeatureCollection> = this.http.get<any>(this.INDEX_URL).pipe(
    catchError(err => {
      console.error('[parcels] index.json not loaded:', this.INDEX_URL, err);
      return of([]);
    }),
    map((idx: any) => {
      let files: string[] = [];
      if (Array.isArray(idx)) files = idx;
      else if (idx && Array.isArray(idx.files)) files = idx.files;
      else if (idx && Array.isArray(idx.items)) files = idx.items;
      return files;
    }),
    tap(files => console.debug('[parcels] index files:', files)),
    switchMap(files => {
      if (!files?.length) {
        return of<FeatureCollection>({ type: 'FeatureCollection', features: [] });
      }

      const reqs = files.map(f => {
        let url = f;
        if (!/^assets\//i.test(f)) {
          url = `${this.BASE}/${f.replace(/^\/+/, '')}`;
        }
        return this.http.get<FeatureCollection>(url).pipe(
          catchError(err => {
            console.error('[parcels] file load error:', url, err);
            return of<FeatureCollection>({ type: 'FeatureCollection', features: [] });
          })
        );
      });

      return forkJoin(reqs).pipe(
        map(fcs => ({
          type: 'FeatureCollection' as const,
          features: fcs.flatMap(fc => fc?.features ?? [])
        }))
      );
    }),
    tap(fc => console.debug('[parcels] total features:', fc.features.length)),
    shareReplay({ bufferSize: 1, refCount: true })
  );
}