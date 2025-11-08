import { Component, ComponentRef, OnInit, ViewChild, ViewContainerRef } from '@angular/core';
import { CommonModule, NgIf, NgFor, CurrencyPipe, DecimalPipe } from '@angular/common'; // Added DecimalPipe for clarity
import { MatTableModule } from '@angular/material/table'; 
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'; // Needed for loading spinner

// The ProductDetailComponent is NOT imported here, as it's lazy-loaded via @defer in the template.

import { ApiService } from '../../services/api.service'; 
import { ProductDetailComponent } from '../product-detail/product-detail';
import { ProductInfoComponent } from '../product-info/product-info';
// Assuming the Product model or interface is available globally or imported here
// import { Product } from '../../models/product.model'; 

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatTableModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    CurrencyPipe,
    DecimalPipe,
    ProductDetailComponent,
    ProductInfoComponent
  ],
  templateUrl: './product-list.html',
  styleUrls: ['./product-list.scss']
})
export class ProductListComponent implements OnInit {
  products: any[] = []; // Use any[] if Product interface is not defined
  isLoading = true;
  
  // Property to hold the ID of the product currently selected for details
  selectedProductId: string | null = null; 
  @ViewChild('infoContainer', { read: ViewContainerRef }) infoContainer!: ViewContainerRef;
  private currentInfoComponentRef: ComponentRef<ProductInfoComponent> | null = null;
  
  displayedColumns: string[] = ['id', 'name', 'price', 'category', 'stock', 'actions'];

  constructor(
    private apiService: ApiService,
    private snackBar: MatSnackBar,
  ) { }

  ngOnInit(): void {
    this.fetchProducts();
  }

  fetchProducts(): void {
    this.isLoading = true;
    // Assuming the list route is now /api/products/list after our troubleshooting
    this.apiService.getProductsList().subscribe({ 
      next: (response) => {
        // Assuming your backend returns { data: [...], count: X }
        this.products = response.data;
        this.isLoading = false;
        this.snackBar.open(`Successfully loaded ${response.count} products!`, 'Dismiss', { duration: 3000 });
      },
      error: (err) => {
        console.error('Error fetching products:', err);
        this.isLoading = false;
        this.snackBar.open('Failed to load products. Server error.', 'Dismiss', { duration: 5000 });
      }
    });
  }
  
  /**
   * Sets the selectedProductId, triggering the @defer block in the template.
   * @param productId The ID of the product whose details are requested.
   */
  viewDetails(productId: string): void {
      // Toggle logic: If the same ID is clicked, hide the details area.
      if (this.selectedProductId === productId) {
          this.selectedProductId = null;
      } else {
          this.selectedProductId = productId;
      }
      
      // Optional: Add logic here to scroll to the details area (e.g., this.scrollToDetails())
  }
  
  // TrackBy function for better performance with ngFor (though mat-table handles this well)
  trackById(index: number, product: any): string {
    return product.id; 
  }

  destroyDynamicComponent(): void {
    if (this.currentInfoComponentRef) {
      this.currentInfoComponentRef.destroy(); 
      this.currentInfoComponentRef = null;
    }
    // Ensures the container is cleared if the component reference was lost
    if (this.infoContainer) {
        this.infoContainer.clear();
    }
  }

  /**
   * Handles the product name click, loading ProductInfoComponent dynamically.
   */
  showProductInfo(productId: string): void {
    // 1. Toggle/Destruction Logic
    if (this.currentInfoComponentRef && this.currentInfoComponentRef.instance.productId === productId) {
      this.destroyDynamicComponent();
      return;
    }
    
    // Clear the deferred view if a name is clicked
    this.selectedProductId = null; 
    
    // 2. Cleanup before creation
    this.destroyDynamicComponent();
    
    // 3. Create the component dynamically
    const componentRef = this.infoContainer.createComponent(ProductInfoComponent);
    
    // 4. Pass the ID and trigger the fetch using the new public method
    // This is the CRITICAL change: Call the loadProduct method directly.
    componentRef.instance.loadProduct(productId);
    
    // 5. Store the reference
    this.currentInfoComponentRef = componentRef;
    
    this.snackBar.open(`Quick Info for Product ${productId} loaded dynamically!`, 'Dismiss', { duration: 2000 });
  }

  ngOnDestroy(): void {
    // 3. Cleanup the dynamically created component when the list component is destroyed
    this.destroyDynamicComponent();
  }
}