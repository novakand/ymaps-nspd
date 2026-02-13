import { Component, signal } from '@angular/core';
import { MapComponent } from './components/maps/map.component';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  imports: [MapComponent, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  // protected readonly title = signal('map-element');
}
