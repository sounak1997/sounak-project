// src/controllers/productController.js
const productService = require('../services/productService');
const { saveResizedImage } = require('../utils/imageUpload');


// --- 1. Get List of Products Controller ---

/**
 * GET /api/products/list
 * Fetches products, paginated (FR-3.1, NFR-5). Customers only ever see
 * active products; ?includeInactive=true is honored only for an admin
 * caller, for the admin product-management screen.
 *
 * Kept backward compatible: with no query params this still returns
 * { success, count, data } shaped exactly like before (data = active
 * products, up to the default page size) — the existing Angular app reads
 * only those three fields. `pagination` is new and additive.
 */
exports.getProductsList = async (req, res) => {
    try {
        const { page, limit, category, search, includeInactive } = req.query;
        const canSeeInactive = req.user?.role === 'admin' && includeInactive === 'true';

        const { rows, pagination } = await productService.listProducts({
            page,
            limit,
            category,
            search,
            includeInactive: canSeeInactive,
        });

        return res.status(200).json({
            success: true,
            count: rows.length,
            data: rows,
            pagination,
        });

    } catch (error) {
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


// --- 4. Admin: Create Product — FR-2.1 ---
exports.createProduct = async (req, res) => {
    const { name, price, description, category, stock } = req.body;

    if (!name || price === undefined || price === null) {
        return res.status(400).json({ success: false, message: 'name and price are required.' });
    }
    if (Number.isNaN(Number(price)) || Number(price) < 0) {
        return res.status(400).json({ success: false, message: 'price must be a non-negative number.' });
    }

    try {
        const product = await productService.createProduct({ name, description, price, category, stock });
        return res.status(201).json({ success: true, data: product });
    } catch (error) {
        console.error('Controller Error (Create):', error.message);
        return res.status(500).json({
            success: false,
            message: 'Could not create the product.',
            detail: error.message,
        });
    }
};

// --- 5. Admin: Update Product (incl. price/"change product cost") — FR-2.2 ---
exports.updateProduct = async (req, res) => {
    const productId = req.params.id;
    const { name, price, description, category, stock } = req.body;

    if (price !== undefined && (Number.isNaN(Number(price)) || Number(price) < 0)) {
        return res.status(400).json({ success: false, message: 'price must be a non-negative number.' });
    }

    try {
        const product = await productService.updateProduct(productId, { name, price, description, category, stock });
        if (!product) {
            return res.status(404).json({ success: false, message: `Product '${productId}' not found.` });
        }
        return res.status(200).json({ success: true, data: product });
    } catch (error) {
        console.error('Controller Error (Update):', error.message);
        const status = error.status || 500;
        return res.status(status).json({
            success: false,
            message: 'Could not update the product.',
            detail: error.message,
        });
    }
};

// --- 6. Admin: Soft delete / reactivate — FR-2.3 ---
exports.setActive = async (req, res) => {
    const productId = req.params.id;
    const { active } = req.body;

    if (typeof active !== 'boolean') {
        return res.status(400).json({ success: false, message: 'active (boolean) is required.' });
    }

    try {
        const product = await productService.setProductActive(productId, active);
        if (!product) {
            return res.status(404).json({ success: false, message: `Product '${productId}' not found.` });
        }
        return res.status(200).json({ success: true, data: product });
    } catch (error) {
        console.error('Controller Error (SetActive):', error.message);
        return res.status(500).json({ success: false, message: 'Could not update the product.', detail: error.message });
    }
};

// --- 7. Admin: In stock / out of stock — FR-2.4 ---
exports.setInStock = async (req, res) => {
    const productId = req.params.id;
    const { inStock } = req.body;

    if (typeof inStock !== 'boolean') {
        return res.status(400).json({ success: false, message: 'inStock (boolean) is required.' });
    }

    try {
        const product = await productService.setProductInStock(productId, inStock);
        if (!product) {
            return res.status(404).json({ success: false, message: `Product '${productId}' not found.` });
        }
        return res.status(200).json({ success: true, data: product });
    } catch (error) {
        console.error('Controller Error (SetInStock):', error.message);
        return res.status(500).json({ success: false, message: 'Could not update the product.', detail: error.message });
    }
};

// --- 8. Admin: Upload a product image — FR-2.1, NFR-3 ---
// multipart/form-data, field name "image" (see productRoutes.js for the
// multer middleware). Can be called multiple times to add several images.
exports.uploadImage = async (req, res) => {
    const productId = req.params.id;

    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file was uploaded. Attach an image in the "image" field.' });
    }

    try {
        const exists = await productService.productExists(productId);
        if (!exists) {
            return res.status(404).json({ success: false, message: `Product '${productId}' not found.` });
        }

        const imageUrl = await saveResizedImage(req.file.buffer, 'products');
        const product = await productService.addProductImage(productId, imageUrl);
        return res.status(200).json({ success: true, data: product });
    } catch (error) {
        console.error('Controller Error (UploadImage):', error.message);
        return res.status(500).json({ success: false, message: 'Could not save the image.', detail: error.message });
    }
};
