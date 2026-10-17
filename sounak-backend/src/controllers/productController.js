// src/controllers/productController.js
const productService = require('../services/productService');
const catalogImageService = require('../services/catalogImageService');

const { isValidImageUrl } = catalogImageService;


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


/**
 * GET /api/products/categories
 * Distinct active-product categories with counts, for the customer-facing
 * category filter (FR-3.1).
 */
exports.getCategories = async (req, res) => {
    try {
        const categories = await productService.listCategories();
        return res.status(200).json({ success: true, count: categories.length, data: categories });
    } catch (error) {
        console.error("Controller Error (Categories):", error.message);
        return res.status(500).json({
            success: false,
            message: "An internal server error occurred while fetching categories.",
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


// --- Admin form input -------------------------------------------------------
// One reader for create and update, so both apply the same rules. Returns
// { fields } keyed by column name, or { error } with a message the admin form
// shows as-is. On update (`partial`), a field missing from the body is left
// out (unchanged); an empty string clears an optional field.
const blankToNull = (value) => (value === '' ? null : value);

function readProductFields(body, { partial }) {
    const fields = {};
    const has = (key) => body[key] !== undefined;

    if (has('name') || !partial) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) return { error: 'name is required.' };
        fields.name = name;
    }
    if (has('price') || !partial) {
        const price = Number(body.price);
        if (body.price === '' || body.price === null || body.price === undefined || Number.isNaN(price) || price < 0) {
            return { error: 'price must be a non-negative number.' };
        }
        fields.price = price;
    }
    if (has('mrp')) {
        const mrp = blankToNull(body.mrp);
        if (mrp !== null && (Number.isNaN(Number(mrp)) || Number(mrp) < 0)) {
            return { error: 'MRP must be a non-negative number.' };
        }
        fields.mrp = mrp === null ? null : Number(mrp);
    }
    if (has('stock')) {
        const stock = Number(blankToNull(body.stock) ?? 0);
        if (!Number.isInteger(stock) || stock < 0) return { error: 'stock must be a whole number, 0 or more.' };
        fields.stock = stock;
    }
    if (has('description')) fields.description = blankToNull(String(body.description ?? '').trim());
    if (has('category')) fields.category = blankToNull(String(body.category ?? '').trim());
    if (has('inStock')) {
        if (typeof body.inStock !== 'boolean') return { error: 'inStock must be true or false.' };
        fields.in_stock = body.inStock;
    }
    if (has('active')) {
        if (typeof body.active !== 'boolean') return { error: 'active must be true or false.' };
        fields.active = body.active;
    }
    if (has('imageUrls')) {
        if (!Array.isArray(body.imageUrls) || !body.imageUrls.every(isValidImageUrl)) {
            return { error: 'imageUrls must be a list of uploaded image paths.' };
        }
        fields.image_urls = [...new Set(body.imageUrls)];
    }

    // Compare against the price being saved; on a partial update that leaves
    // price alone, the check is skipped rather than guessed.
    if (fields.mrp != null && fields.price !== undefined && fields.mrp < fields.price) {
        return { error: 'MRP cannot be lower than the selling price.' };
    }
    return { fields };
}


// --- 4. Admin: Create Product — FR-2.1 ---
exports.createProduct = async (req, res) => {
    const { fields, error: invalid } = readProductFields(req.body, { partial: false });
    if (invalid) {
        return res.status(400).json({ success: false, message: invalid });
    }

    try {
        const product = await productService.createProduct({
            name: fields.name,
            description: fields.description,
            price: fields.price,
            mrp: fields.mrp,
            category: fields.category,
            stock: fields.stock,
            imageUrls: fields.image_urls,
            inStock: fields.in_stock,
            active: fields.active,
        });
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
    const { fields, error: invalid } = readProductFields(req.body, { partial: true });
    if (invalid) {
        return res.status(400).json({ success: false, message: invalid });
    }

    try {
        const product = await productService.updateProduct(productId, fields);
        if (!product) {
            return res.status(404).json({ success: false, message: `Product '${productId}' not found.` });
        }
        return res.status(200).json({ success: true, data: product });
    } catch (error) {
        console.error('Controller Error (Update):', error.message);
        const status = error.status || 500;
        return res.status(status).json({
            success: false,
            message: status === 400 ? error.message : 'Could not update the product.',
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

        // Stored in Postgres rather than uploads/ — see catalogImageService.
        const imageUrl = await catalogImageService.saveImage({
            buffer: req.file.buffer,
            createdBy: String(req.user._id),
        });
        const product = await productService.addProductImage(productId, imageUrl);
        return res.status(200).json({ success: true, data: product });
    } catch (error) {
        console.error('Controller Error (UploadImage):', error.message);
        return res.status(500).json({ success: false, message: 'Could not save the image.', detail: error.message });
    }
};
