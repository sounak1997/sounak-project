// src/services/productService.js
const pgPool = require('../config/pg.config'); 

// --- 1. Get List of Products ---

/**
 * Fetches a list of all products from PostgreSQL.
 * @returns {Array<object>} An array of product objects, or an empty array if none are found.
 */
exports.getAllProducts = async () => {
    // Query selects key fields for a list view
    const sqlQuery = `
        SELECT id, name, price, category, stock 
        FROM products 
        ORDER BY name ASC
    `;
    
    try {
        const result = await pgPool.query(sqlQuery);
        
        // Return the array of all rows found (PostgreSQL result format)
        return result.rows; 
    } catch (error) {
        console.error('Database Error fetching product list (Postgres):', error.message);
        // Throw a specific error for the controller to handle gracefully
        throw new Error("POSTGRES_ERROR: Could not retrieve the list of products.");
    }
};


// --- 2. Get Single Product Details ---

/**
 * Fetches product details from PostgreSQL by product ID.
 * @param {string} productId - The ID of the product to fetch.
 * @returns {object | null} The product data or null if not found.
 */
exports.getProductDetails = async (productId) => {
    // Basic validation
    if (!productId || typeof productId !== 'string') {
        // Throw an error that the controller can translate to a 400 Bad Request
        throw new Error("Invalid product ID format.");
    }
    
    // Parameterized query using $1 for security
    const sqlQuery = `SELECT * FROM products WHERE id = $1`;
    
    try {
        const result = await pgPool.query(sqlQuery, [productId]); 

        if (result.rows.length === 0) {
            return null; // Product not found
        }
        
        return result.rows[0]; // Return the single product row
    } catch (error) {
        console.error('Database Error fetching product details (Postgres):', error.message);
        throw new Error("POSTGRES_ERROR: Could not retrieve product details.");
    }
};

exports.getProductInfo = async (productId) => {
    const sqlQuery = `SELECT * FROM product_details WHERE product_id = $1`;
    
    try {
       console.log('sounak')
        const result = await pgPool.query(sqlQuery, [productId]);

        
        return result.rows[0];

    } catch (error) {
        
        console.error(`Database error fetching product details for ID ${productId}:`, error.message);
        throw new Error('Failed to retrieve product information due to a database issue.');
    }
};