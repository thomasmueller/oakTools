function sortObjectKeys(obj) {
    if (Array.isArray(obj)) {
        // Preserve array order, but process each element
        return obj.map(item => sortObjectKeys(item));
    } else if (obj !== null && typeof obj === 'object') {
        // Separate properties from child objects
        const properties = {};
        const children = {};
        const propertyKeys = [];
        const childKeys = [];
        
        Object.keys(obj).forEach(key => {
            const value = obj[key];
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                // This is a child object
                children[key] = value;
                childKeys.push(key);
            } else {
                // This is a property (primitive, array, or null)
                properties[key] = value;
                propertyKeys.push(key);
            }
        });
        
        // Sort property keys alphabetically
        propertyKeys.sort();
        // Keep child keys in original order (childKeys already in original order)
        
        // Build result object: properties first (sorted), then children (original order)
        const result = {};
        
        // Add sorted properties first
        propertyKeys.forEach(key => {
            result[key] = sortObjectKeys(properties[key]);
        });
        
        // Add children in original order
        childKeys.forEach(key => {
            result[key] = sortObjectKeys(children[key]);
        });
        
        return result;
    } else {
        // Primitive values remain unchanged
        return obj;
    }
}

function formatJSONCustom(obj, indentLevel) {
    const indent = '    '.repeat(indentLevel);
    const nextIndent = '    '.repeat(indentLevel + 1);
    
    if (obj === null) {
        return 'null';
    }
    
    if (typeof obj === 'string') {
        return JSON.stringify(obj);
    }
    
    if (typeof obj === 'number' || typeof obj === 'boolean') {
        return String(obj);
    }
    
    if (Array.isArray(obj)) {
        // Format arrays on a single line
        const items = obj.map(item => formatJSONCustom(item, indentLevel));
        return '[ ' + items.join(', ') + ' ]';
    }
    
    if (typeof obj === 'object') {
        const keys = Object.keys(obj);
        
        if (keys.length === 0) {
            return '{}';
        }
        
        const lines = keys.map(key => {
            const value = formatJSONCustom(obj[key], indentLevel + 1);
            return nextIndent + JSON.stringify(key) + ': ' + value;
        });
        
        return '{\n' + lines.join(',\n') + '\n' + indent + '}';
    }
    
    return JSON.stringify(obj);
}

function formatJSON() {
    const rawInput = document.getElementById('rawInput');
    const formattedOutput = document.getElementById('formattedOutput');
    const errorMessage = document.getElementById('errorMessage');
    const successMessage = document.getElementById('successMessage');
    
    // Clear previous messages
    errorMessage.style.display = 'none';
    successMessage.style.display = 'none';
    
    try {
        const rawJSON = rawInput.value.trim();
        
        if (rawJSON === '') {
            formattedOutput.value = '';
            return;
        }
        
        // Parse JSON to validate it
        const parsedJSON = JSON.parse(rawJSON);
        
        // Sort object keys alphabetically while preserving array order
        const sortedJSON = sortObjectKeys(parsedJSON);
        
        // Format with 4 spaces indentation, arrays on single lines
        const formattedJSON = formatJSONCustom(sortedJSON, 0);
        
        formattedOutput.value = formattedJSON;
        successMessage.textContent = 'JSON successfully formatted and validated!';
        successMessage.style.display = 'block';
        
    } catch (error) {
        formattedOutput.value = '';
        
        let errorText = 'Invalid JSON: ';
        if (error.message.includes('Unexpected token')) {
            errorText += 'Syntax error in JSON structure';
        } else if (error.message.includes('Unexpected end')) {
            errorText += 'Incomplete JSON structure';
        } else {
            errorText += error.message;
        }
        
        errorMessage.textContent = errorText;
        errorMessage.style.display = 'block';
    }
}

function minifyJSON() {
    const rawInput = document.getElementById('rawInput');
    const formattedOutput = document.getElementById('formattedOutput');
    const errorMessage = document.getElementById('errorMessage');
    const successMessage = document.getElementById('successMessage');
    
    // Clear previous messages
    errorMessage.style.display = 'none';
    successMessage.style.display = 'none';
    
    try {
        const formattedJSON = formattedOutput.value.trim();
        
        if (formattedJSON === '') {
            rawInput.value = '';
            return;
        }
        
        // Parse JSON to validate it
        const parsedJSON = JSON.parse(formattedJSON);
        
        // Minify by stringifying without spaces
        const minifiedJSON = JSON.stringify(parsedJSON);
        
        rawInput.value = minifiedJSON;
        successMessage.textContent = 'JSON successfully minified!';
        successMessage.style.display = 'block';
        
    } catch (error) {
        rawInput.value = '';
        
        let errorText = 'Invalid JSON: ';
        if (error.message.includes('Unexpected token')) {
            errorText += 'Syntax error in JSON structure';
        } else if (error.message.includes('Unexpected end')) {
            errorText += 'Incomplete JSON structure';
        } else {
            errorText += error.message;
        }
        
        errorMessage.textContent = errorText;
        errorMessage.style.display = 'block';
    }
}

// Initialize event listeners when DOM is loaded (browser only)
if (typeof document !== 'undefined') {
    var rawInput = document.getElementById('rawInput');
    var formattedOutput = document.getElementById('formattedOutput');
    var errorMessage = document.getElementById('errorMessage');
    var successMessage = document.getElementById('successMessage');
    if (rawInput != null && formattedOutput != null && errorMessage != null && successMessage != null) {
        document.addEventListener('DOMContentLoaded', function() {
            // Allow Enter key to trigger conversion
            rawInput.addEventListener('keydown', function(event) {
                if (event.ctrlKey && event.key === 'Enter') {
                    formatJSON();
                }
            });

            // Clear formatted output when raw input is cleared
            rawInput.addEventListener('input', function() {
                if (this.value.trim() === '') {
                    formattedOutput.value = '';
                    errorMessage.style.display = 'none';
                    successMessage.style.display = 'none';
                }
            });

            // Clear raw input when formatted output is cleared
            formattedOutput.addEventListener('input', function() {
                if (this.value.trim() === '') {
                    rawInput.value = '';
                    errorMessage.style.display = 'none';
                    successMessage.style.display = 'none';
                }
            });
        });
    }
}

// Export functions for use in other modules (Node.js compatibility)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        sortObjectKeys,
        formatJSONCustom
    };
}