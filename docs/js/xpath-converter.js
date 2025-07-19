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
    
    // Parse the main structure
    const result = parseXPath(query);
    
    // Build SQL-2 query
    let sql2 = buildSQL2Query(result);
    
    if (explain) {
        sql2 = 'explain ' + sql2;
    }
    
    if (measure) {
        sql2 = 'measure ' + sql2;
    }
    
    return sql2;
}

function parseXPath(xpath) {
    const result = {
        select: ['[jcr:path]', '[jcr:score]', '*'],
        from: '[nt:base]',
        alias: 'a',
        where: [],
        orderBy: [],
        path: '',
        nodeType: 'nt:base',
        isDescendant: false,
        conditions: []
    };
    
    let query = xpath;
    
    // Handle /jcr:root prefix
    if (query.startsWith('/jcr:root')) {
        query = query.substring(9);
        if (query.startsWith('/')) {
            query = query.substring(1);
            if (query.startsWith('/')) {
                // //
                query = query.substring(1);
                result.isDescendant = true;
            }
        }
    } else if (query.startsWith('//')) {
        query = query.substring(2);
        result.isDescendant = true;
    } else if (query.startsWith('/')) {
        query = query.substring(1);
    }
    
    // Parse path segments
    const segments = query.split('/');
    let pathParts = [];
    let currentSegment = '';
    
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        
        if (segment === '') {
            if (i > 0) {
                result.isDescendant = true;
            }
            continue;
        }
        
        // Handle element() function
        if (segment.startsWith('element(')) {
            const elementMatch = segment.match(/element\(([^,]*),\s*([^)]+)\)/);
            if (elementMatch) {
                const elementName = elementMatch[1].trim();
                const nodeType = elementMatch[2].trim();
                if (elementName !== '*' && elementName !== '') {
                    result.specificElement = elementName;
                    // Don't add to pathParts - handle in issamenode logic
                } else if (elementName === '*') {
                    // For wildcards, this is just a type constraint
                }
                if (nodeType && nodeType !== '*') {
                    result.nodeType = nodeType;
                    result.from = '[' + nodeType + ']';
                }
            }
        } else if (segment.includes('[')) {
            // Handle conditions
            const conditionMatch = segment.match(/^([^[]*)\[(.+)\](.*)$/);
            if (conditionMatch) {
                const beforeCondition = conditionMatch[1];
                const condition = conditionMatch[2];
                const afterCondition = conditionMatch[3];
                
                if (beforeCondition && beforeCondition !== '*') {
                    pathParts.push(beforeCondition);
                }
                
                // Parse condition
                result.conditions.push(condition);
                
                // Handle order by in the same segment
                if (afterCondition.includes('order by')) {
                    const orderByMatch = afterCondition.match(/order by (.+)$/);
                    if (orderByMatch) {
                        parseOrderBy(orderByMatch[1], result);
                    }
                }
            }
        } else if (segment.includes('order by')) {
            // Handle order by
            const orderByMatch = segment.match(/order by (.+)$/);
            if (orderByMatch) {
                parseOrderBy(orderByMatch[1], result);
            }
        } else if (segment === '*') {
            // Wildcard - don't add to path
        } else if (segment.includes('(')) {
            // Handle functions like rep:excerpt
            handleSelectFunction(segment, result);
        } else {
            pathParts.push(segment);
        }
    }
    
    // Handle order by at the end
    const orderByMatch = xpath.match(/order by (.+)$/);
    if (orderByMatch) {
        parseOrderBy(orderByMatch[1], result);
    }
    
    result.path = pathParts.join('/');
    if (result.path && result.path !== '') {
        result.path = '/' + result.path;
    }
    
    return result;
}

function parseOrderBy(orderByClause, result) {
    const orderItems = orderByClause.split(',');
    for (let item of orderItems) {
        item = item.trim();
        if (item) {
            result.orderBy.push(convertXPathExpression(item));
        }
    }
}

function handleSelectFunction(segment, result) {
    // Handle rep:excerpt and other select functions
    if (segment.includes('rep:excerpt')) {
        // Replace * in select
        if (result.select.includes('*')) {
            const index = result.select.indexOf('*');
            result.select.splice(index, 1);
        }
        
        // Handle rep:excerpt() without arguments
        if (segment.includes('rep:excerpt()')) {
            result.select.push('[rep:excerpt]');
        } else {
            // Handle rep:excerpt with arguments
            const excerptMatches = segment.match(/rep:excerpt\(([^)]+)\)/g);
            if (excerptMatches) {
                for (let match of excerptMatches) {
                    const propMatch = match.match(/rep:excerpt\(([^)]+)\)/);
                    if (propMatch) {
                        const prop = propMatch[1].replace('@', '');
                        result.select.push('[rep:excerpt(' + prop + ')]');
                    }
                }
            }
        }
    }
    
    // Handle property selection like /@property or /(@prop1 | @prop2)
    if (segment.startsWith('@')) {
        // Single property selection
        const prop = segment.substring(1);
        if (result.select.includes('*')) {
            const index = result.select.indexOf('*');
            result.select.splice(index, 1);
        }
        result.select.push('[' + prop + ']');
    } else if (segment.includes('|') && segment.includes('@')) {
        // Multiple property selection
        if (result.select.includes('*')) {
            const index = result.select.indexOf('*');
            result.select.splice(index, 1);
        }
        
        const propMatches = segment.match(/@([\w:]+)/g);
        if (propMatches) {
            for (let prop of propMatches) {
                result.select.push('[' + prop.substring(1) + ']');
            }
        }
    }
}

function convertXPathExpression(expr) {
    expr = expr.trim();
    
    // Convert XPath functions and syntax to SQL-2
    
    // fn:path() -> path(a)
    expr = expr.replace(/fn:path\(\)/g, 'path(a)');
    
    // jcr:first(@property) -> first([property])
    expr = expr.replace(/jcr:first\((@[\w:]+)\)/g, (match, prop) => {
        return 'first([' + prop.substring(1) + '])';
    });
    
    // jcr:like(@property, 'pattern') -> [property] like 'pattern'
    expr = expr.replace(/jcr:like\((@[\w:]+),\s*([^)]+)\)/g, (match, prop, pattern) => {
        return '[' + prop.substring(1) + '] like ' + pattern;
    });
    
    // jcr:contains(., 'text') -> contains(*, 'text')
    expr = expr.replace(/jcr:contains\(\.\s*,\s*([^)]+)\)/g, (match, text) => {
        return 'contains(*, ' + text + ')';
    });
    
    // Handle property existence checks and not() function
    // not(@property) -> [property] is null
    expr = expr.replace(/not\((@[\w:]+)\)/g, (match, prop) => {
        return '[' + prop.substring(1) + '] is null';
    });
    
    // @property (standalone in condition) -> [property] is not null
    // Only apply this when the property is in a condition context (between [ ])
    expr = expr.replace(/(@[\w:]+)(?!\s*[=<>!~]|\s*like\s|\s*is\s)/g, (match, prop) => {
        // Check if this property reference is in a condition context
        return '[' + prop.substring(1) + '] is not null';
    });
    
    // Handle boolean operators
    expr = expr.replace(/\band\b/g, 'and');
    expr = expr.replace(/\bor\b/g, 'or');
    
    // @property -> [property] (for remaining cases)
    expr = expr.replace(/@([\w:]+)/g, '[$1]');
    
    // $variable -> @variable
    expr = expr.replace(/\$(\w+)/g, '@$1');
    
    // Handle order by direction keywords
    expr = expr.replace(/\bdescending\b/g, 'descending');
    expr = expr.replace(/\bascending\b/g, 'ascending');
    
    return expr;
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
    for (let condition of result.conditions) {
        const convertedCondition = convertXPathExpression(condition);
        whereConditions.push(convertedCondition);
    }
    
    // Add path restrictions
    if (result.path && result.path !== '/' && result.path !== '') {
        if (result.specificElement) {
            // Use issamenode for specific element names
            const fullPath = result.path === '/' ? '/' + result.specificElement : result.path + '/' + result.specificElement;
            whereConditions.push(`issamenode(${result.alias}, '${fullPath}')`);
        } else if (result.isDescendant) {
            whereConditions.push(`isdescendantnode(${result.alias}, '${result.path}')`);
        } else {
            whereConditions.push(`ischildnode(${result.alias}, '${result.path}')`);
        }
    } else if (result.isDescendant && result.path === '') {
        // Handle // at root
        whereConditions.push(`isdescendantnode(${result.alias}, '/')`);
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
        parseXPath,
        convertXPathExpression,
        buildSQL2Query
    };
} 