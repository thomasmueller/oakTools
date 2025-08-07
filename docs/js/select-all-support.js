/**
 * Universal Select All Support for Textarea and Div Elements
 * 
 * This module provides cross-platform Cmd+A (Mac) / Ctrl+A (Windows/Linux) functionality
 * for both textarea elements and div elements with text content.
 */

/**
 * Add Cmd+A (Mac) / Ctrl+A (Windows/Linux) support to an element
 * @param {HTMLElement} element - The element to add select all support to
 */
function addSelectAllSupport(element) {
    if (!element) return;
    
    // Make div elements focusable (textareas are already focusable)
    if (element.tagName.toLowerCase() === 'div') {
        element.setAttribute('tabindex', '0');
        
        // Add click to focus for div elements
        element.addEventListener('click', function() {
            element.focus();
        });
    }
    
    element.addEventListener('keydown', function(event) {
        // Handle both Cmd+A (Mac) and Ctrl+A (Windows/Linux)
        if ((event.metaKey || event.ctrlKey) && event.key === 'a') {
            event.preventDefault();
            
            if (element.tagName.toLowerCase() === 'textarea') {
                // For textarea elements, use standard selection
                element.select();
            } else {
                // For div elements, use range selection
                selectAllTextInDiv(element);
            }
        }
    });
}

/**
 * Select all text content in a div element
 * @param {HTMLElement} element - The div element to select text in
 */
function selectAllTextInDiv(element) {
    if (window.getSelection && document.createRange) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

/**
 * Add select all support to multiple elements by their IDs
 * @param {string[]} elementIds - Array of element IDs to add support to
 */
function addSelectAllSupportToElements(elementIds) {
    elementIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            addSelectAllSupport(element);
        }
    });
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.addSelectAllSupport = addSelectAllSupport;
    window.addSelectAllSupportToElements = addSelectAllSupportToElements;
}