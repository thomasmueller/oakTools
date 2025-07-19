// XPath to SQL-2 Converter
// Based on Apache Jackrabbit Oak XPathToSQL2Converter logic

function convertXPath() {
    const xpathInput = document.getElementById('xpathInput');
    const sql2Output = document.getElementById('sql2Output');
    const xpathError = document.getElementById('xpathError');
    const xpathSuccess = document.getElementById('xpathSuccess');
    
    xpathError.style.display = 'none';
    xpathSuccess.style.display = 'none';
    
    try {
        const xpath = xpathInput.value.trim();
        if (xpath === '') {
            sql2Output.value = '';
            return;
        }
        
        const sql2 = convertXPathToSQL2(xpath);
        sql2Output.value = sql2;
        xpathSuccess.textContent = 'XPath successfully converted to SQL-2!';
        xpathSuccess.style.display = 'block';
        
    } catch (error) {
        sql2Output.value = '';
        xpathError.textContent = 'Error: ' + error.message;
        xpathError.style.display = 'block';
    }
}

function convertXPathToSQL2(xpath) {
    // Handle special cases and prefixes
    let query = xpath.trim();
    let explain = false;
    let measure = false;
    
    if (query.startsWith('explain ')) {
        explain = true;
        query = query.substring(8).trim();
    }
    
    if (query.startsWith('measure ')) {
        measure = true;
        query = query.substring(8).trim();
    }
    
    if (query === '') {
        query = '//jcr:root';
    }
    
    try {
        // Parse using proper tokenizer and parser
        const parser = new XPathParser(query);
        const result = parser.parse();
        
        // Build SQL-2 query
        let sql2 = buildSQL2Query(result);
        
        if (explain) {
            sql2 = 'explain ' + sql2;
        }
        
        if (measure) {
            sql2 = 'measure ' + sql2;
        }
        
        return sql2;
    } catch (error) {
        throw new Error('XPath parsing error: ' + error.message);
    }
}

// XPath Parser - Based on Apache Jackrabbit Oak XPathToSQL2Converter
class XPathParser {
    constructor(xpath) {
        this.xpath = xpath;
        this.pos = 0;
        this.length = xpath.length;
        this.currentChar = this.pos < this.length ? xpath[this.pos] : null;
    }

    parse() {
        const result = {
            select: ['[jcr:path]', '[jcr:score]', '*'],
            from: '[nt:base]',
            alias: 'a',
            where: [],
            orderBy: [],
            path: '',
            nodeType: 'nt:base',
            isDescendant: false,
            conditions: [],
            specificElement: null,
            startsWithJcrRoot: false
        };

        // Parse path pattern
        this.parsePath(result);
        
        // Parse order by if present
        this.parseOrderBy(result);

        return result;
    }

    parsePath(result) {
        let pathParts = [];
        
        // Handle /jcr:root prefix
        if (this.matchString('/jcr:root')) {
            result.startsWithJcrRoot = true;
            this.advance(9); // length of '/jcr:root'
            if (this.currentChar === '/') {
                this.advance(1);
                if (this.currentChar === '/') {
                    this.advance(1);
                    result.isDescendant = true;
                }
            }
        } else if (this.matchString('//')) {
            this.advance(2);
            result.isDescendant = true;
        } else if (this.currentChar === '/') {
            this.advance(1);
        }

        // Parse path segments
        while (this.pos < this.length && !this.isAtOrderBy()) {
            if (this.currentChar === '/') {
                this.advance(1);
                if (this.currentChar === '/') {
                    this.advance(1);
                    result.isDescendant = true;
                }
                continue;
            }

            const segment = this.parseSegment();
            if (segment) {
                this.processSegment(segment, result, pathParts);
            }
        }

        // Set final path
        if (pathParts.length > 0) {
            result.path = '/' + pathParts.join('/');
        }
    }

    parseSegment() {
        if (this.pos >= this.length || this.isAtOrderBy()) {
            return null;
        }

        let segment = '';
        let parenthesesCount = 0;
        let bracketsCount = 0;
        let inQuotes = false;
        let quoteChar = null;
        
        while (this.pos < this.length && !this.isAtOrderBy()) {
            const char = this.currentChar;
            
            // Handle quotes
            if ((char === '"' || char === "'") && !inQuotes) {
                inQuotes = true;
                quoteChar = char;
            } else if (char === quoteChar && inQuotes) {
                inQuotes = false;
                quoteChar = null;
            }
            
            if (!inQuotes) {
                if (char === '(') parenthesesCount++;
                if (char === ')') parenthesesCount--;
                if (char === '[') bracketsCount++;
                if (char === ']') bracketsCount--;
                
                if (char === '/' && parenthesesCount === 0 && bracketsCount === 0) {
                    break;
                }
                
                // Handle 'order by' specially
                if (this.matchString('order by') && parenthesesCount === 0 && bracketsCount === 0) {
                    break;
                }
            }
            
            segment += char;
            this.advance(1);
        }
        
        return segment.trim();
    }

    processSegment(segment, result, pathParts) {
        if (segment === '*') {
            // Wildcard
            return;
        }

        // Handle element() function
        const elementMatch = segment.match(/^element\(([^,]*),\s*([^)]+)\)(.*)$/);
        if (elementMatch) {
            const elementName = elementMatch[1].trim();
            const nodeType = elementMatch[2].trim();
            const remainder = elementMatch[3];

            if (elementName && elementName !== '*') {
                result.specificElement = elementName;
            }
            
            if (nodeType && nodeType !== '*') {
                result.nodeType = nodeType;
                result.from = '[' + nodeType + ']';
            }

            // Process any conditions or selections after element()
            if (remainder && remainder.trim() !== '') {
                this.processRemainder(remainder, result);
            }
            return;
        }

        // Handle conditions [...]
        const bracketIndex = segment.indexOf('[');
        if (bracketIndex !== -1) {
            const beforeCondition = segment.substring(0, bracketIndex);
            
            // Find the matching closing bracket
            let bracketCount = 0;
            let conditionEnd = -1;
            let inQuotes = false;
            let quoteChar = null;
            
            for (let i = bracketIndex; i < segment.length; i++) {
                const char = segment[i];
                
                if ((char === '"' || char === "'") && !inQuotes) {
                    inQuotes = true;
                    quoteChar = char;
                } else if (char === quoteChar && inQuotes) {
                    inQuotes = false;
                    quoteChar = null;
                }
                
                if (!inQuotes) {
                    if (char === '[') bracketCount++;
                    if (char === ']') {
                        bracketCount--;
                        if (bracketCount === 0) {
                            conditionEnd = i;
                            break;
                        }
                    }
                }
            }
            
            if (conditionEnd !== -1) {
                const condition = segment.substring(bracketIndex + 1, conditionEnd);
                const afterCondition = segment.substring(conditionEnd + 1);

                if (beforeCondition && beforeCondition !== '*' && beforeCondition.trim() !== '') {
                    pathParts.push(beforeCondition);
                }

                result.conditions.push(condition);

                if (afterCondition && afterCondition.trim() !== '') {
                    this.processRemainder(afterCondition, result);
                }
                return;
            }
        }

        // Handle rep:excerpt and other functions
        if (segment.includes('rep:excerpt')) {
            this.handleRepExcerpt(segment, result);
            return;
        }

        // Handle property selections
        if (segment.startsWith('@') || segment.includes('|')) {
            this.handlePropertySelection(segment, result);
            return;
        }

        // Regular path segment
        if (segment && segment !== '*') {
            pathParts.push(segment);
        }
    }

    processRemainder(remainder, result) {
        // Handle conditions first - check for brackets
        const bracketIndex = remainder.indexOf('[');
        if (bracketIndex !== -1) {
            // Extract condition from brackets
            let bracketCount = 0;
            let conditionEnd = -1;
            let inQuotes = false;
            let quoteChar = null;
            
            for (let i = bracketIndex; i < remainder.length; i++) {
                const char = remainder[i];
                
                if ((char === '"' || char === "'") && !inQuotes) {
                    inQuotes = true;
                    quoteChar = char;
                } else if (char === quoteChar && inQuotes) {
                    inQuotes = false;
                    quoteChar = null;
                }
                
                if (!inQuotes) {
                    if (char === '[') bracketCount++;
                    if (char === ']') {
                        bracketCount--;
                        if (bracketCount === 0) {
                            conditionEnd = i;
                            break;
                        }
                    }
                }
            }
            
            if (conditionEnd !== -1) {
                const condition = remainder.substring(bracketIndex + 1, conditionEnd);
                result.conditions.push(condition);
                
                // Process anything after the condition
                const afterCondition = remainder.substring(conditionEnd + 1);
                if (afterCondition && afterCondition.trim() !== '') {
                    this.processRemainder(afterCondition, result);
                }
                return;
            }
        }
        
        // Handle rep:excerpt and property selections in remainder
        if (remainder.includes('rep:excerpt')) {
            this.handleRepExcerpt(remainder, result);
        } else if (remainder.startsWith('@') || remainder.includes('|')) {
            this.handlePropertySelection(remainder, result);
        }
    }

    handleRepExcerpt(segment, result) {
        // Remove * from select if present
        if (result.select.includes('*')) {
            const index = result.select.indexOf('*');
            result.select.splice(index, 1);
        }

        // Handle different rep:excerpt patterns
        if (segment.includes('rep:excerpt()')) {
            result.select.push('[rep:excerpt]');
        } else {
            // Find rep:excerpt with arguments
            const excerptMatches = segment.match(/rep:excerpt\(([^)]+)\)/g);
            if (excerptMatches) {
                for (const match of excerptMatches) {
                    const argMatch = match.match(/rep:excerpt\(([^)]+)\)/);
                    if (argMatch) {
                        let arg = argMatch[1].trim();
                        if (arg === '.') {
                            result.select.push('[rep:excerpt]');
                        } else {
                            // Remove @ prefix if present
                            arg = arg.replace(/^@/, '');
                            result.select.push('[rep:excerpt(' + arg + ')]');
                        }
                    }
                }
            }
        }
    }

    handlePropertySelection(segment, result) {
        // Remove * from select
        if (result.select.includes('*')) {
            const index = result.select.indexOf('*');
            result.select.splice(index, 1);
        }

        // Handle multiple properties with |
        if (segment.includes('|')) {
            const properties = segment.split('|');
            for (const prop of properties) {
                const cleanProp = prop.trim().replace(/[()@]/g, '');
                if (cleanProp) {
                    result.select.push('[' + cleanProp + ']');
                }
            }
        } else {
            // Single property
            const cleanProp = segment.replace(/^@/, '');
            if (cleanProp) {
                result.select.push('[' + cleanProp + ']');
            }
        }
    }

    parseOrderBy(result) {
        if (!this.isAtOrderBy()) {
            return;
        }

        // Skip to 'order by'
        while (this.pos < this.length && !this.matchString('order by')) {
            this.advance(1);
        }

        if (this.matchString('order by')) {
            this.advance(8); // length of 'order by'
            this.skipWhitespace();

            const orderByClause = this.xpath.substring(this.pos);
            const orderItems = orderByClause.split(',');
            
            for (const item of orderItems) {
                const trimmed = item.trim();
                if (trimmed) {
                    result.orderBy.push(this.convertOrderByExpression(trimmed));
                }
            }
        }
    }

    convertExpression(expr) {
        expr = expr.trim();
        
        // Convert XPath functions to SQL-2
        expr = expr.replace(/fn:path\(\)/g, 'path(a)');
        expr = expr.replace(/jcr:first\(@([^)]+)\)/g, 'first([$1])');
        expr = expr.replace(/jcr:like\(@([^,]+),\s*([^)]+)\)/g, '[$1] like $2');
        expr = expr.replace(/jcr:contains\(\.\s*,\s*([^)]+)\)/g, 'contains(*, $1)');
        expr = expr.replace(/not\(@([^)]+)\)/g, '[$1] is null');
        expr = expr.replace(/@([^=<>!\s]+)(?=\s|$)/g, '[$1] is not null');
        expr = expr.replace(/@([^=<>!\s]+)(?=[=<>!])/g, '[$1]');
        expr = expr.replace(/\$(\w+)/g, '@$1');
        
        return expr;
    }

    convertOrderByExpression(expr) {
        expr = expr.trim();
        
        // Convert XPath functions to SQL-2 for order by (no existence checks)
        expr = expr.replace(/fn:path\(\)/g, 'path(a)');
        expr = expr.replace(/jcr:first\(@([^)]+)\)/g, 'first([$1])');
        expr = expr.replace(/jcr:score\(\)/g, 'score(a)');
        
        // For order by, just convert property references directly
        expr = expr.replace(/@([a-zA-Z:][a-zA-Z0-9:._-]*)/g, '[$1]');
        
        // Handle variables
        expr = expr.replace(/\$(\w+)/g, '@$1');
        
        // Handle direction keywords (keep full words for Oak compatibility)
        expr = expr.replace(/\bdescending\b/g, 'desc');
        expr = expr.replace(/\bascending\b/g, 'asc');
        
        return expr;
    }

    // Utility methods
    matchString(str) {
        return this.xpath.substring(this.pos, this.pos + str.length) === str;
    }

    advance(count = 1) {
        this.pos += count;
        this.currentChar = this.pos < this.length ? this.xpath[this.pos] : null;
    }

    skipWhitespace() {
        while (this.currentChar && /\s/.test(this.currentChar)) {
            this.advance(1);
        }
    }

    isAtOrderBy() {
        const remaining = this.xpath.substring(this.pos);
        return remaining.trimStart().startsWith('order by');
    }
}

function buildSQL2Query(result) {
    let sql2 = 'select ';
    
    // SELECT clause
    sql2 += result.select.join(', ');
    
    // FROM clause
    sql2 += '\n  from ' + result.from + ' as ' + result.alias;
    
    // WHERE clause
    const whereConditions = [];
    
    // Add parsed conditions
    for (const condition of result.conditions) {
        const convertedCondition = convertCondition(condition);
        whereConditions.push(convertedCondition);
    }
    
    // Add path restrictions
    if (result.specificElement) {
        // Use issamenode for specific element names
        let fullPath;
        if (result.path && result.path !== '/') {
            fullPath = result.path + '/' + result.specificElement;
        } else {
            fullPath = '/' + result.specificElement;
        }
        whereConditions.push(`issamenode(${result.alias}, '${fullPath}')`);
    } else if (result.path && result.path !== '/' && result.path !== '') {
        if (result.isDescendant) {
            whereConditions.push(`isdescendantnode(${result.alias}, '${result.path}')`);
        } else {
            whereConditions.push(`ischildnode(${result.alias}, '${result.path}')`);
        }
    } else if (result.isDescendant) {
        // Add descendant condition for descendant queries
        if (result.path && result.path !== '' && result.path !== '/') {
            whereConditions.push(`isdescendantnode(${result.alias}, '${result.path}')`);
        } else if (result.startsWithJcrRoot) {
            // Only for /jcr:root// queries, add root descendant condition
            whereConditions.push(`isdescendantnode(${result.alias}, '/')`);
        }
        // For plain // queries without jcr:root, don't add descendant condition
    }
    
    if (whereConditions.length > 0) {
        sql2 += '\n  where ' + whereConditions.join('\n  and ');
    }
    
    // ORDER BY clause
    if (result.orderBy.length > 0) {
        sql2 += '\n  order by ' + result.orderBy.join(', ');
    }
    
    return sql2;
}

function convertCondition(condition) {
    // Parse and convert individual conditions more carefully
    condition = condition.trim();
    
    // Handle fn:path() function
    condition = condition.replace(/fn:path\(\)/g, 'path(a)');
    
    // Handle jcr:first function
    condition = condition.replace(/jcr:first\(@([^)]+)\)/g, 'first([$1])');
    
    // Handle jcr:like function
    condition = condition.replace(/jcr:like\(@([^,]+),\s*([^)]+)\)/g, '[$1] like $2');
    
    // Handle jcr:contains function
    condition = condition.replace(/jcr:contains\(\.\s*,\s*([^)]+)\)/g, 'contains(*, $1)');
    condition = condition.replace(/jcr:contains\(@([^,]+),\s*([^)]+)\)/g, 'contains([$1], $2)');
    
    // Handle not() function - must come before general property handling
    condition = condition.replace(/not\(@([^)]+)\)/g, '[$1] is null');
    
    // Handle property references more carefully
    // Special handling for properties followed by 'and', 'or', closing paren, or end of string
    condition = condition.replace(/@([a-zA-Z:][a-zA-Z0-9:._-]*)\s*(?=\s+and\s+|\s+or\s+|\)|$)/g, (match, prop) => {
        // Check if this property is part of a comparison
        const beforeMatch = condition.substring(0, condition.indexOf(match));
        if (beforeMatch.match(/[=<>!]\s*$/)) {
            // This is part of a comparison, just use brackets
            return '[' + prop + ']';
        } else {
            // This is a standalone property (existence check)
            return '[' + prop + '] is not null';
        }
    });
    
    // Handle remaining property references in comparisons
    condition = condition.replace(/@([a-zA-Z:][a-zA-Z0-9:._-]*)/g, '[$1]');
    
    // Handle variables
    condition = condition.replace(/\$(\w+)/g, '@$1');
    
    // Handle boolean operators
    condition = condition.replace(/\band\b/g, 'and');
    condition = condition.replace(/\bor\b/g, 'or');
    
    // Fix spacing around operators (only if not already spaced)
    condition = condition.replace(/([^=!<>\s])(=)([^=\s])/g, '$1 $2 $3');
    condition = condition.replace(/([^!<>\s])(<>)([^=\s])/g, '$1 $2 $3');
    condition = condition.replace(/([^<\s])(<=)([^=\s])/g, '$1 $2 $3');
    condition = condition.replace(/([^>\s])(>=)([^=\s])/g, '$1 $2 $3');
    condition = condition.replace(/([^!\s])(!=)([^=\s])/g, '$1 $2 $3');
    condition = condition.replace(/([^<\s])(<)([^=>\s])/g, '$1 $2 $3');
    condition = condition.replace(/([^>\s])(>)([^=>\s])/g, '$1 $2 $3');
    
    // Remove unnecessary outer parentheses
    condition = condition.replace(/^\((.*)\)$/, '$1');
    
    return condition;
}



// Initialize page functionality
function initializeXPathConverter() {
    // Auto-convert on input change
    const xpathInput = document.getElementById('xpathInput');
    if (xpathInput) {
        xpathInput.addEventListener('input', function() {
            if (this.value.trim() === '') {
                document.getElementById('sql2Output').value = '';
                document.getElementById('xpathError').style.display = 'none';
                document.getElementById('xpathSuccess').style.display = 'none';
            } else {
                convertXPath();
            }
        });

        // Initialize with default conversion
        convertXPath();
    }
}



// Initialize converter when DOM is ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeXPathConverter);
    } else {
        initializeXPathConverter();
    }
}

// Export functions for testing (if in Node.js environment)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        convertXPathToSQL2,
        XPathParser,
        convertCondition,
        buildSQL2Query
    };
} 