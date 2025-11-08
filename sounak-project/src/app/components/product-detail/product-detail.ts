import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common'; 
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../services/api.service';

// Define a simple interface for clarity (use your actual Product model if you have one)
interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
  description: string;
}

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [
    CommonModule, 
    MatCardModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    CurrencyPipe
  ],
  // Note: No more dialog styling, using standard template/styles
  templateUrl: './product-detail.html',
  styleUrls: ['./product-detail.scss']
})
// Implement OnChanges to react to new product IDs being selected
export class ProductDetailComponent implements OnChanges { 
  
  // 1. INPUT: Receives the ID of the product to display
  @Input() productId: string | null = null;
  
  product: Product | null = null;
  isLoading = false; // We start loading when the input changes

  constructor(
    private apiService: ApiService,
    private snackBar: MatSnackBar
  ) {}

  // 2. LIFECYCLE HOOK: Called when the @Input() (productId) changes
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['productId'] && this.productId) {
      this.fetchProductDetails(this.productId);
    } else if (changes['productId'] && !this.productId) {
      this.product = null;
    }
  }

  fetchProductDetails(id: string): void {
    this.isLoading = true;
    this.apiService.getProductDetails(id).subscribe({
      next: (response) => {
        this.product = response.data;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error fetching product details:', err);
        this.isLoading = false;
        this.snackBar.open('Failed to load product details.', 'Dismiss', { duration: 5000 });
        this.product = null;
      }
    });
  }
}