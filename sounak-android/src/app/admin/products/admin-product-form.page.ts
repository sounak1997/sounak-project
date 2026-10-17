import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavController } from '@ionic/angular';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon,
  IonSpinner, IonButton, IonList, IonItem, IonInput, IonTextarea, IonToggle,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, trashOutline, starOutline, star, chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';
import { Product } from '../../core/product.service';
import { AdminProductsService, ProductInput } from '../data/admin-products.service';
import { AdminImagesService } from '../data/admin-images.service';
import { AdminFeedbackService, errorMessage } from '../shared/admin-feedback.service';

const blankForm = (category = ''): ProductInput => ({
  name: '',
  description: '',
  category,
  price: '',
  mrp: '',
  stock: '',
  inStock: true,
  active: true,
  imageUrls: [],
});

@Component({
  selector: 'app-admin-product-form',
  templateUrl: './admin-product-form.page.html',
  styleUrls: ['../shared/admin.scss', './admin-product-form.page.scss'],
  imports: [
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon,
    IonSpinner, IonButton, IonList, IonItem, IonInput, IonTextarea, IonToggle,
  ],
})
export class AdminProductFormPage implements OnInit {
  private api = inject(AdminProductsService);
  private feedback = inject(AdminFeedbackService);
  private nav = inject(NavController);
  images = inject(AdminImagesService);

  /** From the route (/admin/products/:id); absent on /admin/products/new. */
  readonly id = input<string>();

  form: ProductInput = blankForm();
  readonly photos = signal<string[]>([]);
  readonly categories = signal<string[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly uploading = signal(0);
  readonly formError = signal<string | null>(null);

  readonly isNew = computed(() => !this.id());
  /** One spinner tile per photo still uploading. */
  readonly pendingTiles = computed(() => Array.from({ length: this.uploading() }));

  constructor() {
    addIcons({ addOutline, trashOutline, starOutline, star, chevronBackOutline, chevronForwardOutline });
  }

  ngOnInit(): void {
    this.api.categories().subscribe({
      next: (res) => this.categories.set(res.data.map((c) => c.category)),
      error: () => {},
    });
    if (!this.isNew()) this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.get(this.id()!).subscribe({
      next: (res) => {
        this.fill(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(errorMessage(err, 'Could not load this item.'));
        this.loading.set(false);
      },
    });
  }

  private fill(p: Product): void {
    this.form = {
      name: p.name,
      description: p.description ?? '',
      category: p.category ?? '',
      price: p.price,
      mrp: p.mrp ?? '',
      stock: p.stock ?? 0,
      inStock: p.in_stock,
      active: p.active,
      imageUrls: [],
    };
    this.photos.set([...(p.image_urls ?? [])]);
  }

  /** "20% off" under the price fields, so a typo in MRP is obvious before saving. */
  discountLabel(): string | null {
    const price = Number(this.form.price);
    const mrp = Number(this.form.mrp);
    if (!this.form.mrp || !this.form.price || Number.isNaN(price) || Number.isNaN(mrp)) return null;
    if (mrp < price) return 'MRP is lower than the selling price.';
    if (mrp === price) return null;
    return `Customers will see ${Math.round(((mrp - price) / mrp) * 100)}% off.`;
  }

  // --- Photos ---------------------------------------------------------------

  onPhotosPicked(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const files = Array.from(inputEl.files ?? []);
    inputEl.value = '';
    for (const file of files) {
      this.uploading.update((n) => n + 1);
      this.images.upload(file, 'product').subscribe({
        next: (url) => {
          this.photos.update((list) => [...list, url]);
          this.uploading.update((n) => n - 1);
        },
        error: (err) => {
          this.uploading.update((n) => n - 1);
          this.feedback.failed(err, `Could not upload ${file.name}.`);
        },
      });
    }
  }

  makeCover(index: number): void {
    this.photos.update((list) => [list[index], ...list.filter((_, i) => i !== index)]);
  }

  move(index: number, by: -1 | 1): void {
    this.photos.update((list) => {
      const next = [...list];
      const target = index + by;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  removePhoto(index: number): void {
    this.photos.update((list) => list.filter((_, i) => i !== index));
  }

  // --- Save -----------------------------------------------------------------

  private validate(): string | null {
    if (!this.form.name.trim()) return 'Give the item a name.';
    const price = Number(this.form.price);
    if (this.form.price === '' || Number.isNaN(price) || price < 0) return 'Enter a selling price.';
    if (this.form.mrp !== '' && Number(this.form.mrp) < price) return 'MRP cannot be lower than the selling price.';
    if (this.form.stock !== '' && !Number.isInteger(Number(this.form.stock))) return 'Stock must be a whole number.';
    if (this.uploading() > 0) return 'Wait for the photos to finish uploading.';
    return null;
  }

  save(addAnother = false): void {
    const problem = this.validate();
    this.formError.set(problem);
    if (problem) return;

    const body: ProductInput = { ...this.form, imageUrls: this.photos() };
    const request = this.isNew() ? this.api.create(body) : this.api.update(this.id()!, body);

    this.saving.set(true);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.feedback.saved(this.isNew() ? `Added “${body.name.trim()}”` : 'Saved');
        if (addAnother) {
          // Keep the category: a batch of new stock is usually one shelf.
          this.form = blankForm(this.form.category);
          this.photos.set([]);
        } else {
          this.nav.navigateBack('/admin/products');
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(errorMessage(err, 'Could not save this item.'));
      },
    });
  }
}
