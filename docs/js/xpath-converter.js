// XPath to SQL-2 Converter
// Based on Apache Jackrabbit Oak XPathToSQL2Converter logic

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
            startsWithJcrRoot: false,
            options: null
        };

        // Parse path pattern
        this.parsePath(result);
        
        // Parse order by if present
        this.parseOrderBy(result);
        
        // Parse options if present
        this.parseOptions(result);

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
        while (this.pos < this.length && !this.isAtOrderBy() && !this.isAtOption()) {
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
        if (this.pos >= this.length || this.isAtOrderBy() || this.isAtOption()) {
            return null;
        }

        let segment = '';
        let parenthesesCount = 0;
        let bracketsCount = 0;
        let inQuotes = false;
        let quoteChar = null;
        
        while (this.pos < this.length && !this.isAtOrderBy() && !this.isAtOption()) {
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

            // Find the end of the order by clause (before any option clause)
            let orderByEnd = this.length;
            const remainingQuery = this.xpath.substring(this.pos);
            const optionIndex = remainingQuery.search(/\s+option\s*\(/);
            if (optionIndex !== -1) {
                orderByEnd = this.pos + optionIndex;
            }

            const orderByClause = this.xpath.substring(this.pos, orderByEnd);
            const orderItems = orderByClause.split(',');
            
            for (const item of orderItems) {
                const trimmed = item.trim();
                if (trimmed) {
                    result.orderBy.push(this.convertOrderByExpression(trimmed));
                }
            }
            
            // Advance position to the end of the order by clause
            this.pos = orderByEnd;
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

    isAtOption() {
        const remaining = this.xpath.substring(this.pos);
        return remaining.trimStart().startsWith('option(');
    }

    parseOptions(result) {
        if (!this.isAtOption()) {
            return;
        }

        // Skip to 'option('
        while (this.pos < this.length && !this.matchString('option(')) {
            this.advance(1);
        }

        if (this.matchString('option(')) {
            this.advance(7); // length of 'option('
            this.skipWhitespace();

            // Parse options content until closing parenthesis
            const optionsStart = this.pos;
            let parenthesesCount = 1;
            
            while (this.pos < this.length && parenthesesCount > 0) {
                if (this.currentChar === '(') {
                    parenthesesCount++;
                } else if (this.currentChar === ')') {
                    parenthesesCount--;
                }
                
                if (parenthesesCount > 0) {
                    this.advance(1);
                }
            }

            const optionsContent = this.xpath.substring(optionsStart, this.pos).trim();
            
            // Parse options content
            result.options = this.parseOptionContent(optionsContent);
            
            if (this.currentChar === ')') {
                this.advance(1); // consume closing parenthesis
            }
        }
    }

    parseOptionContent(content) {
        const options = {
            orderedOptions: [] // Preserve original order
        };
        
        // Split by commas to handle multiple options
        const optionParts = content.split(',').map(part => part.trim());
        
        for (const part of optionParts) {
            // Handle "index tag [tagName]" or "index tag tagName"
            const indexTagMatch = part.match(/index\s+tag\s+\[([^\]]+)\]/) || 
                                  part.match(/index\s+tag\s+([^\s,)]+)/);
            
            if (indexTagMatch) {
                options.indexTag = indexTagMatch[1];
                options.orderedOptions.push({ type: 'indexTag', value: indexTagMatch[1] });
                continue;
            }
            
            // Handle "index name [name]" or "index name name"
            const indexNameMatch = part.match(/index\s+name\s+\[([^\]]+)\]/) || 
                                   part.match(/index\s+name\s+([^\s,)]+)/);
            
            if (indexNameMatch) {
                options.indexName = indexNameMatch[1];
                options.orderedOptions.push({ type: 'indexName', value: indexNameMatch[1] });
                continue;
            }
            
            // Handle "limit number"
            const limitMatch = part.match(/limit\s+(\d+)/);
            if (limitMatch) {
                options.limit = parseInt(limitMatch[1]);
                options.orderedOptions.push({ type: 'limit', value: parseInt(limitMatch[1]) });
                continue;
            }
            
            // Handle other numeric options like "offset number"
            const offsetMatch = part.match(/offset\s+(\d+)/);
            if (offsetMatch) {
                options.offset = parseInt(offsetMatch[1]);
                options.orderedOptions.push({ type: 'offset', value: parseInt(offsetMatch[1]) });
                continue;
            }
            
            // Handle other string options that need bracketing
            const generalOptionMatch = part.match(/(\w+)\s+([^\s,)]+)/);
            if (generalOptionMatch) {
                const [, optionName, optionValue] = generalOptionMatch;
                options.orderedOptions.push({ type: 'general', name: optionName, value: optionValue });
            }
        }
        
        return options;
    }
}

function buildSQL2Query(result) {
    let sql2 = 'select ';
    
    // SELECT clause - add alias prefix to each select item
    const selectItems = result.select.map(item => {
        if (item === '*') {
            return result.alias + '.*';
        } else if (item.startsWith('[') && item.endsWith(']')) {
            return result.alias + '.' + item;
        } else {
            return item; // Already has alias prefix or other format
        }
    });
    sql2 += selectItems.join(', ');
    
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
    
    // OPTION clause
    if (result.options && result.options.orderedOptions && result.options.orderedOptions.length > 0) {
        const optionParts = [];
        
        for (const option of result.options.orderedOptions) {
            switch (option.type) {
                case 'indexTag':
                    optionParts.push('index tag [' + option.value + ']');
                    break;
                case 'indexName':
                    optionParts.push('index name [' + option.value + ']');
                    break;
                case 'limit':
                case 'offset':
                    optionParts.push(option.type + ' ' + option.value);
                    break;
                case 'general':
                    // Check if the value is likely numeric
                    if (/^\d+$/.test(option.value)) {
                        optionParts.push(option.name + ' ' + option.value);
                    } else {
                        // Non-numeric values get brackets
                        optionParts.push(option.name + ' [' + option.value + ']');
                    }
                    break;
            }
        }
        
        if (optionParts.length > 0) {
            sql2 += '\n  option (' + optionParts.join(', ') + ')';
        }
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

// Export functions for testing (if in Node.js environment)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        convertXPathToSQL2,
        XPathParser,
        convertCondition,
        buildSQL2Query
    };
} 