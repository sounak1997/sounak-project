import { Component, Input } from '@angular/core'; 
import { CommonModule, CurrencyPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../services/api.service';

// --- UPDATED INTERFACE TO MATCH NEW DATA STRUCTURE ---
interface TechnicalSpecs {
  connectivity?: string[]; // Make it optional since it might not exist (like in the headphone data)
  layout?: string;
  drivers?: string;
  
  // Keep the index signature for all other dynamic properties
  [key: string]: any;
}

interface ProductDetailData {
  id: string; // PD001
  product_id: string; // PROD001
  technical_specs: TechnicalSpecs;
  vendor_sku: string;
  internal_rating: string;
  created_at: string;
  updated_at: string;
  // NOTE: Assuming basic product fields (name, price, etc.) are still available,
  // or that a separate call/merge is done to get the full product context.
  // For now, we only use the fields provided in the JSON snippet.
}
// ----------------------------------------------------

@Component({
  selector: 'app-product-info',
  standalone: true,
  imports: [
    CommonModule, 
    MatCardModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    CurrencyPipe
  ],
  templateUrl: './product-info.html',
  styleUrls: ['./product-info.scss']
})
export class ProductInfoComponent { 
  
  // This input is used in the loadProduct method
  @Input() productId!: string;
  
  // Change the type to the new data structure
  productData: ProductDetailData | null = null; 
  isLoading = false;

  constructor(
    private apiService: ApiService,
    private snackBar: MatSnackBar
  ) {}

  /**
   * Public method to be called by the parent immediately after component creation.
   */
  loadProduct(id: string): void {
    if (!id) return;
    
    this.productId = id; 
    this.fetchProductDetails(id);
  }

  fetchProductDetails(id: string): void {
    this.isLoading = true;
    this.productData = null; // Clear previous data
    
    // NOTE: Assuming your API service endpoint is set up to return the detailed structure
    // We are still calling it using the PROD ID for context, but the returned ID is PD001.
    this.apiService.getProductInfo(id).subscribe({ 
      next: (response) => {
        // Assuming response.data is the ProductDetailData object
        this.productData = response.data;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error fetching quick product info:', err);
        this.isLoading = false;
        this.snackBar.open('Failed to load quick product info.', 'Dismiss', { duration: 3000 });
        this.productData = null;
      }
    });
  }
}