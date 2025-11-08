// src/controllers/productController.js
const productService = require('../services/productService');


// --- 1. Get List of Products Controller ---

/**
 * GET /api/products
 * Fetches the entire list of products.
 */
exports.getProductsList = async (req, res) => {
    try {
        // Call the service to get the array
        const products = await productService.getAllProducts();

        // Success -> HTTP 200 OK. Always returns an array.
        return res.status(200).json({
            success: true,
            count: products.length,
            data: products,
        });

    } catch (error) {
        // Handle database errors thrown by the service layer
        console.error("Controller Error (List):", error.message);
        
        return res.status(500).json({
            success: false,
            message: "An internal server error occurred while fetching the product list.",
            detail: error.message,
        });
    }
};


// --- 2. Get Single Product Details Controller ---

/**
 * GET /api/products/:id
 * Fetches product details and sends the response.
 */
exports.getProductDetails = async (req, res) => {
    const productId = req.params.id;

    try {
        const product = await productService.getProductDetails(productId);

        if (!product) {
            // Product not found -> HTTP 404
            return res.status(404).json({
                success: false,
                message: `Product with ID '${productId}' not found.`,
            });
        }

        // Success -> HTTP 200 OK
        return res.status(200).json({
            success: true,
            data: product,
        });

    } catch (error) {
        console.error("Controller Error (Details):", error.message);
        
        // Check for specific validation error thrown by service
        const status = error.message.includes("Invalid product ID") ? 400 : 500;
        
        return res.status(status).json({
            success: false,
            message: "An error occurred while fetching product details.",
            detail: error.message,
        });
    }
};

exports.getProductInfo = async (req, res) => {
    const productId = req.params.id;
    console.log('calling')
    try {
        const product = await productService.getProductInfo(productId);

        if (!product) {
            // Product not found -> HTTP 404
            return res.status(404).json({
                success: false,
                message: `Product with ID '${productId}' not found.`,
            });
        }

        // Success -> HTTP 200 OK
        return res.status(200).json({
            success: true,
            data: product,
        });

    } catch (error) {
        console.error("Controller Error (Details):", error.message);
        
        // Check for specific validation error thrown by service
        const status = error.message.includes("Invalid product ID") ? 400 : 500;
        
        return res.status(status).json({
            success: false,
            message: "An error occurred while fetching product details.",
            detail: error.message,
        });
    }
};