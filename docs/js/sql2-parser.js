// SQL-2 Lexer - converts input string into tokens
class SQL2Lexer {
    constructor(input) {
        this.input = input;
        this.position = 0;
        this.tokens = [];
        this.tokenize();
    }

    isAlpha(ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
    }

    isAlphaNumeric(ch) {
        return this.isAlpha(ch) || (ch >= '0' && ch <= '9');
    }

    isWhitespace(ch) {
        return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
    }

    peek(offset = 0) {
        const pos = this.position + offset;
        return pos < this.input.length ? this.input[pos] : null;
    }

    advance() {
        return this.position < this.input.length ? this.input[this.position++] : null;
    }

    readString(quote) {
        let value = '';
        this.advance(); // consume opening quote
        
        while (this.peek() && this.peek() !== quote) {
            if (this.peek() === '\\') {
                this.advance(); // consume backslash
                const escaped = this.advance();
                if (escaped === 'n') value += '\n';
                else if (escaped === 't') value += '\t';
                else if (escaped === 'r') value += '\r';
                else value += escaped;
            } else {
                value += this.advance();
            }
        }
        
        if (this.peek() === quote) {
            this.advance(); // consume closing quote
        }
        
        return { type: 'STRING', value };
    }

    readNumber() {
        let value = '';
        
        while (this.peek() && (this.peek() >= '0' && this.peek() <= '9' || this.peek() === '.')) {
            value += this.advance();
        }
        
        return { type: 'NUMBER', value: parseFloat(value) };
    }

    readIdentifier() {
        let value = '';
        
        while (this.peek() && this.isAlphaNumeric(this.peek())) {
            value += this.advance();
        }
        
        const upperValue = value.toUpperCase();
        
        // Oak SQL-2 Keywords (only core SQL keywords, not function names)
        const keywords = {
            'SELECT': 'SELECT',
            'FROM': 'FROM', 
            'WHERE': 'WHERE',
            'ORDER': 'ORDER',
            'BY': 'BY',
            'ASC': 'ASC',
            'DESC': 'DESC',
            'AND': 'AND',
            'OR': 'OR',
            'NOT': 'NOT',
            'LIKE': 'LIKE',
            'IS': 'IS',
            'NULL': 'NULL',
            'IN': 'IN',
            'AS': 'AS',
            'CAST': 'CAST',
            'CONTAINS': 'CONTAINS'
        };
        
        return {
            type: keywords[upperValue] || 'IDENTIFIER',
            value: value
        };
    }

    readBracketedName() {
        let value = '';
        this.advance(); // consume opening bracket
        
        while (this.peek() && this.peek() !== ']') {
            value += this.advance();
        }
        
        if (this.peek() === ']') {
            this.advance(); // consume closing bracket
        }
        
        return { type: 'BRACKETED_NAME', value };
    }

    tokenize() {
        while (this.position < this.input.length) {
            const ch = this.peek();
            
            if (this.isWhitespace(ch)) {
                this.advance();
                continue;
            }
            
            if (ch === "'" || ch === '"') {
                this.tokens.push(this.readString(ch));
            } else if (ch >= '0' && ch <= '9') {
                this.tokens.push(this.readNumber());
            } else if (this.isAlpha(ch)) {
                this.tokens.push(this.readIdentifier());
            } else if (ch === '[') {
                this.tokens.push(this.readBracketedName());
            } else if (ch === '(') {
                this.tokens.push({ type: 'LPAREN', value: '(' });
                this.advance();
            } else if (ch === ')') {
                this.tokens.push({ type: 'RPAREN', value: ')' });
                this.advance();
            } else if (ch === ',') {
                this.tokens.push({ type: 'COMMA', value: ',' });
                this.advance();
            } else if (ch === '.') {
                this.tokens.push({ type: 'DOT', value: '.' });
                this.advance();
            } else if (ch === '*') {
                this.tokens.push({ type: 'STAR', value: '*' });
                this.advance();
            } else if (ch === '=') {
                this.tokens.push({ type: 'EQUALS', value: '=' });
                this.advance();
            } else if (ch === '<') {
                if (this.peek(1) === '=') {
                    this.tokens.push({ type: 'LTE', value: '<=' });
                    this.advance();
                    this.advance();
                } else if (this.peek(1) === '>') {
                    this.tokens.push({ type: 'NOT_EQUALS', value: '<>' });
                    this.advance();
                    this.advance();
                } else {
                    this.tokens.push({ type: 'LT', value: '<' });
                    this.advance();
                }
            } else if (ch === '>') {
                if (this.peek(1) === '=') {
                    this.tokens.push({ type: 'GTE', value: '>=' });
                    this.advance();
                    this.advance();
                } else {
                    this.tokens.push({ type: 'GT', value: '>' });
                    this.advance();
                }
            } else {
                // Skip unknown characters
                this.advance();
            }
        }
        
        this.tokens.push({ type: 'EOF', value: null });
    }
}

// SQL-2 Parser - recursive descent parser
class SQL2Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.position = 0;
    }

    peek(offset = 0) {
        const pos = this.position + offset;
        return pos < this.tokens.length ? this.tokens[pos] : { type: 'EOF', value: null };
    }

    advance() {
        if (this.position < this.tokens.length) {
            return this.tokens[this.position++];
        }
        return { type: 'EOF', value: null };
    }

    match(...types) {
        return types.includes(this.peek().type);
    }

    consume(type) {
        if (this.peek().type === type) {
            return this.advance();
        }
        throw new Error(`Expected ${type}, got ${this.peek().type}`);
    }

    // Main parsing method
    parseQuery() {
        return this.parseSelectStatement();
    }

    parseSelectStatement() {
        const node = {
            type: 'SelectStatement',
            columns: [],
            from: null,
            where: null,
            orderBy: []
        };

        this.consume('SELECT');
        node.columns = this.parseSelectList();

        if (this.match('FROM')) {
            this.advance();
            node.from = this.parseFromClause();
        }

        if (this.match('WHERE')) {
            this.advance();
            node.where = this.parseExpression();
        }

        if (this.match('ORDER')) {
            this.advance();
            this.consume('BY');
            node.orderBy = this.parseOrderByList();
        }

        return node;
    }

    parseSelectList() {
        const columns = [];

        do {
            if (this.match('STAR')) {
                columns.push({
                    type: 'AllColumns',
                    value: '*'
                });
                this.advance();
            } else {
                const expr = this.parseExpression();
                columns.push({
                    type: 'Column',
                    expression: expr
                });
            }

            if (this.match('COMMA')) {
                this.advance();
            } else {
                break;
            }
        } while (!this.match('FROM', 'WHERE', 'ORDER', 'EOF'));

        return columns;
    }

    parseFromClause() {
        return this.parseTableReference();
    }

    parseTableReference() {
        if (this.match('BRACKETED_NAME')) {
            const nodeName = this.advance().value;
            return {
                type: 'NodeType',
                value: nodeName
            };
        } else if (this.match('IDENTIFIER')) {
            const tableName = this.advance().value;
            return {
                type: 'Table',
                name: tableName
            };
        }
        throw new Error('Expected table reference');
    }

    parseExpression() {
        return this.parseOrExpression();
    }

    parseOrExpression() {
        let left = this.parseAndExpression();

        while (this.match('OR')) {
            const operator = this.advance();
            const right = this.parseAndExpression();
            left = {
                type: 'BinaryOperation',
                operator: operator.value,
                left: left,
                right: right
            };
        }

        return left;
    }

    parseAndExpression() {
        let left = this.parseNotExpression();

        while (this.match('AND')) {
            const operator = this.advance();
            const right = this.parseNotExpression();
            left = {
                type: 'BinaryOperation',
                operator: operator.value,
                left: left,
                right: right
            };
        }

        return left;
    }

    parseNotExpression() {
        if (this.match('NOT')) {
            this.advance();
            const expression = this.parseComparisonExpression();
            return {
                type: 'UnaryOperation',
                operator: 'NOT',
                expression: expression
            };
        }

        return this.parseComparisonExpression();
    }

                parseComparisonExpression() {
                let left = this.parsePrimaryExpression();

                if (this.match('EQUALS', 'NOT_EQUALS', 'LT', 'LTE', 'GT', 'GTE')) {
                    const operator = this.advance();
                    const right = this.parsePrimaryExpression();
                    return {
                        type: 'BinaryOperation',
                        operator: operator.value,
                        left: left,
                        right: right
                    };
                } else if (this.match('LIKE')) {
                    this.advance();
                    const right = this.parsePrimaryExpression();
                    return {
                        type: 'BinaryOperation',
                        operator: 'LIKE',
                        left: left,
                        right: right
                    };
                } else if (this.match('IN')) {
                    this.advance();
                    this.consume('LPAREN');
                    const values = [];
                    
                    if (!this.match('RPAREN')) {
                        do {
                            values.push(this.parseExpression());
                            if (this.match('COMMA')) {
                                this.advance();
                            } else {
                                break;
                            }
                        } while (!this.match('RPAREN'));
                    }
                    
                    this.consume('RPAREN');
                    return {
                        type: 'InComparison',
                        expression: left,
                        values: values
                    };
                } else if (this.match('IS')) {
                    this.advance();
                    let notNull = false;
                    if (this.match('NOT')) {
                        notNull = true;
                        this.advance();
                    }
                    this.consume('NULL');
                    return {
                        type: 'IsNull',
                        expression: left,
                        not: notNull
                    };
                }

                return left;
            }

                parsePrimaryExpression() {
                if (this.match('LPAREN')) {
                    this.advance();
                    const expr = this.parseExpression();
                    this.consume('RPAREN');
                    return expr;
                } else if (this.match('BRACKETED_NAME')) {
                    const property = this.advance().value;
                    return {
                        type: 'Property',
                        name: property
                    };
                } else if (this.match('CAST')) {
                    this.advance();
                    this.consume('LPAREN');
                    const expression = this.parseExpression();
                    this.consume('AS');
                    const dataType = this.consume('IDENTIFIER').value;
                    this.consume('RPAREN');
                    return {
                        type: 'Cast',
                        expression: expression,
                        dataType: dataType
                    };
                } else if (this.match('CONTAINS')) {
                    this.advance();
                    this.consume('LPAREN');
                    const args = [];
                    
                    if (!this.match('RPAREN')) {
                        do {
                            args.push(this.parseExpression());
                            if (this.match('COMMA')) {
                                this.advance();
                            } else {
                                break;
                            }
                        } while (!this.match('RPAREN'));
                    }
                    
                    this.consume('RPAREN');
                    return {
                        type: 'Function',
                        name: 'CONTAINS',
                        arguments: args
                    };
                } else if (this.match('IDENTIFIER')) {
                    const identifier = this.advance().value;
                    
                    if (this.match('LPAREN')) {
                        // Function call
                        this.advance(); // consume (
                        const args = [];
                        
                        if (!this.match('RPAREN')) {
                            do {
                                args.push(this.parseExpression());
                                if (this.match('COMMA')) {
                                    this.advance();
                                } else {
                                    break;
                                }
                            } while (!this.match('RPAREN'));
                        }
                        
                        this.consume('RPAREN');
                        
                        return {
                            type: 'Function',
                            name: identifier,
                            arguments: args
                        };
                    } else {
                        return {
                            type: 'Identifier',
                            name: identifier
                        };
                    }
                } else if (this.match('STRING')) {
                    const value = this.advance().value;
                    return {
                        type: 'Literal',
                        dataType: 'string',
                        value: value
                    };
                } else if (this.match('NUMBER')) {
                    const value = this.advance().value;
                    return {
                        type: 'Literal',
                        dataType: 'number',
                        value: value
                    };
                } else if (this.match('NULL')) {
                    this.advance();
                    return {
                        type: 'Literal',
                        dataType: 'null',
                        value: null
                    };
                }

                throw new Error(`Unexpected token: ${this.peek().type}`);
            }

    parseOrderByList() {
        const orderBy = [];

        do {
            const expr = this.parseExpression();
            let direction = 'ASC';

            if (this.match('ASC', 'DESC')) {
                direction = this.advance().value;
            }

            orderBy.push({
                type: 'OrderBy',
                expression: expr,
                direction: direction
            });

            if (this.match('COMMA')) {
                this.advance();
            } else {
                break;
            }
        } while (!this.match('EOF'));

        return orderBy;
    }
}

// Convert AST to Oak Filter representation
function convertASTToFilter(ast) {
    const filter = {
        type: 'Filter',
        selector: 'default',
        nodeType: null,
        pathRestrictions: [],
        propertyRestrictions: [],
        sortOrder: [],
        isFulltextSearchable: false,
        properties: new Set(),
        pathPrefix: null,
        pathGlob: null
    };

    if (ast.type === 'SelectStatement') {
        // Extract node type from FROM clause
        if (ast.from) {
            if (ast.from.type === 'NodeType') {
                filter.nodeType = ast.from.value;
            } else if (ast.from.type === 'Table') {
                filter.selector = ast.from.name;
            }
        }

        // Extract constraints from WHERE clause
        if (ast.where) {
            extractConstraints(ast.where, filter);
        }

        // Extract sort order from ORDER BY
        if (ast.orderBy && ast.orderBy.length > 0) {
            ast.orderBy.forEach(orderItem => {
                const sortField = {
                    property: extractPropertyName(orderItem.expression),
                    direction: orderItem.direction || 'ASC'
                };
                filter.sortOrder.push(sortField);
            });
        }

        // Extract properties from SELECT columns
        if (ast.columns) {
            ast.columns.forEach(column => {
                if (column.type === 'Column' && column.expression) {
                    const propName = extractPropertyName(column.expression);
                    if (propName) {
                        filter.properties.add(propName);
                    }
                }
            });
        }
    }

    return filter;
}

function extractConstraints(node, filter) {
    if (!node) return;

                switch (node.type) {
                case 'BinaryOperation':
                    if (node.operator === 'AND') {
                        extractConstraints(node.left, filter);
                        extractConstraints(node.right, filter);
                    } else if (node.operator === 'OR') {
                        // OR constraints are more complex in Oak, simplified here
                        extractConstraints(node.left, filter);
                        extractConstraints(node.right, filter);
                    } else {
                        // Comparison operations
                        const leftProp = extractPropertyName(node.left);
                        const rightValue = extractLiteralValue(node.right);
                        
                        if (leftProp && rightValue !== undefined) {
                            if (leftProp === 'jcr:path' && node.operator === 'LIKE') {
                                extractPathConstraint(rightValue, filter);
                            } else {
                                const constraint = {
                                    propertyName: leftProp,
                                    operator: node.operator,
                                    value: rightValue,
                                    propertyType: typeof rightValue
                                };
                                filter.propertyRestrictions.push(constraint);
                                filter.properties.add(leftProp);
                            }
                        }
                    }
                    break;
                    
                case 'InComparison':
                    const propName = extractPropertyName(node.expression);
                    if (propName) {
                        const values = node.values.map(v => extractLiteralValue(v)).filter(v => v !== undefined);
                        if (values.length > 0) {
                            const constraint = {
                                propertyName: propName,
                                operator: 'IN',
                                value: values,
                                propertyType: 'array'
                            };
                            filter.propertyRestrictions.push(constraint);
                            filter.properties.add(propName);
                        }
                    }
                    break;
                    
                case 'IsNull':
                    const nullPropName = extractPropertyName(node.expression);
                    if (nullPropName) {
                        const constraint = {
                            propertyName: nullPropName,
                            operator: node.not ? 'IS NOT NULL' : 'IS NULL',
                            value: null,
                            propertyType: 'null'
                        };
                        filter.propertyRestrictions.push(constraint);
                        filter.properties.add(nullPropName);
                    }
                    break;
                    
                case 'Function':
                    // Handle function constraints like CONTAINS
                    if (node.name === 'CONTAINS' && node.arguments.length >= 2) {
                        const containsProp = extractPropertyName(node.arguments[0]);
                        const searchValue = extractLiteralValue(node.arguments[1]);
                        if (containsProp && searchValue) {
                            filter.isFulltextSearchable = true;
                            filter.properties.add(containsProp);
                        }
                    }
                    break;
                    
                case 'UnaryOperation':
                    if (node.operator === 'NOT') {
                        // Handle NOT operations - simplified
                        extractConstraints(node.expression, filter);
                    }
                    break;
            }
}

function extractPathConstraint(pathPattern, filter) {
    if (pathPattern.endsWith('/%')) {
        // Path prefix constraint
        const prefix = pathPattern.slice(0, -2);
        filter.pathPrefix = prefix;
        filter.pathRestrictions.push({
            type: 'PATH_PREFIX',
            path: prefix
        });
    } else if (pathPattern.includes('%') || pathPattern.includes('_')) {
        // Path glob constraint
        filter.pathGlob = pathPattern;
        filter.pathRestrictions.push({
            type: 'PATH_GLOB',
            pattern: pathPattern
        });
    } else {
        // Exact path constraint
        filter.pathRestrictions.push({
            type: 'PATH_EXACT',
            path: pathPattern
        });
    }
}

        function extractPropertyName(node) {
            if (!node) return null;
            
            switch (node.type) {
                case 'Property':
                    return node.name;
                case 'Identifier':
                    return node.name;
                case 'Function':
                    // For functions like UPPER([jcr:title]), extract the property from first argument
                    if (node.arguments && node.arguments.length > 0) {
                        return extractPropertyName(node.arguments[0]);
                    }
                    // For functions like NAME(), LOCALNAME(), PATH(), SCORE() without arguments
                    if (node.name === 'NAME' || node.name === 'LOCALNAME' || node.name === 'PATH' || node.name === 'SCORE') {
                        return `:${node.name.toLowerCase()}`;
                    }
                    return null;
                case 'Cast':
                    // For CAST expressions, extract from the inner expression
                    return extractPropertyName(node.expression);
                default:
                    return null;
            }
        }

        function extractLiteralValue(node) {
            if (!node) return undefined;
            
            switch (node.type) {
                case 'Literal':
                    return node.value;
                case 'Identifier':
                    return node.name;
                case 'Cast':
                    // For CAST expressions, extract the value from the inner expression
                    return extractLiteralValue(node.expression);
                case 'Function':
                    // For simple functions that return constant values
                    if (node.arguments && node.arguments.length > 0) {
                        return extractLiteralValue(node.arguments[0]);
                    }
                    return undefined;
                default:
                    return undefined;
            }
        }

// Convert Filter to Lucene Index Definition
function convertFilterToLuceneIndex(filter) {
    const nodeType = filter.nodeType || 'nt:base';
    const indexName = generateIndexName(filter);
    
    const indexDef = {
        [`/oak:index/${indexName}`]: {
            "jcr:primaryType": "oak:QueryIndexDefinition",
            "type": "lucene",
            "async": ["async", "nrt"],
            "compatVersion": 2,
            "evaluatePathRestrictions": true,
            "reindex": false,
            "reindexCount": 0
        }
    };

    const indexRoot = indexDef[`/oak:index/${indexName}`];

    // Add included paths if path restrictions exist
    if (filter.pathPrefix) {
        indexRoot.includedPaths = filter.pathPrefix;
    }

    // Create indexRules
    indexRoot.indexRules = {
        "jcr:primaryType": "nt:unstructured"
    };

    // Add rule for the specific node type
    const nodeTypeKey = nodeType.replace(':', '_');
    indexRoot.indexRules[nodeType] = {
        "jcr:primaryType": "nt:unstructured",
        "properties": {
            "jcr:primaryType": "nt:unstructured"
        }
    };

    const properties = indexRoot.indexRules[nodeType].properties;

    // Add property definitions based on filter restrictions and referenced properties
    const allProperties = new Set([...filter.properties]);
    filter.propertyRestrictions.forEach(restriction => {
        allProperties.add(restriction.propertyName);
    });

    // Sort properties are always needed as ordered
    filter.sortOrder.forEach(sort => {
        allProperties.add(sort.property);
    });

    allProperties.forEach(prop => {
        const propKey = prop.replace(/[:\-\.]/g, '');
        const propDef = createPropertyDefinition(prop, filter);
        if (propDef) {
            properties[propKey] = propDef;
        }
    });

    // Add node name property for search optimization
    if (!allProperties.has(':nodeName')) {
        properties.nodeName = {
            "jcr:primaryType": "nt:unstructured",
            "name": ":nodeName",
            "propertyIndex": true,
            "useInSuggest": true
        };
    }

    return indexDef;
}

function generateIndexName(filter) {
    let name = 'custom';
    
    if (filter.nodeType) {
        name = filter.nodeType.replace(/[:\-]/g, '') + 'Lucene';
    }
    
    if (filter.pathPrefix) {
        const pathPart = filter.pathPrefix.replace(/[\/\-\.]/g, '');
        name += pathPart.charAt(0).toUpperCase() + pathPart.slice(1);
    }
    
    return name + 'Custom';
}

function createPropertyDefinition(propertyName, filter) {
    const propDef = {
        "jcr:primaryType": "nt:unstructured",
        "propertyIndex": true
    };

    // Set property name (handle special properties)
    if (propertyName === ':nodeName') {
        propDef.name = ":nodeName";
        propDef.useInSuggest = true;
        delete propDef.propertyIndex;
        propDef.propertyIndex = true;
        return propDef;
    } else {
        propDef.name = `str:${propertyName}`;
    }

    // Find restrictions for this property to determine type and features
    const restrictions = filter.propertyRestrictions.filter(r => r.propertyName === propertyName);
    const sortRestrictions = filter.sortOrder.filter(s => s.property === propertyName);

    // Determine property type based on restrictions
    if (restrictions.length > 0) {
        const restriction = restrictions[0];
        
        if (restriction.propertyType === 'string' && typeof restriction.value === 'string') {
            // Date properties
            if (propertyName.includes('created') || propertyName.includes('modified') || 
                propertyName.includes('Date') || propertyName.includes('Time') ||
                restriction.value.match(/^\d{4}-\d{2}-\d{2}/)) {
                propDef.type = "Date";
            }
        } else if (restriction.propertyType === 'number') {
            if (Number.isInteger(restriction.value)) {
                propDef.type = "Long";
            } else {
                propDef.type = "Double";
            }
        }

        // Add null checks for IS NULL / IS NOT NULL operations
        if (restriction.operator === 'IS NULL' || restriction.operator === 'IS NOT NULL') {
            propDef.nullCheckEnabled = true;
            propDef.notNullCheckEnabled = true;
        }
    }

    // If property is used in ORDER BY, make it ordered
    if (sortRestrictions.length > 0) {
        propDef.ordered = true;
    }

    // Special handling for common JCR properties
    if (propertyName === 'jcr:uuid') {
        propDef.name = "str:jcr:uuid";
    } else if (propertyName === 'jcr:path') {
        // Path is typically not indexed as a property, handled via path restrictions
        return null;
    } else if (propertyName.includes('title') || propertyName.includes('Title')) {
        propDef.boost = 2.0;
        propDef.useInSuggest = true;
        propDef.useInSpellcheck = true;
        propDef.nodeScopeIndex = true;
    } else if (propertyName.includes('description') || propertyName.includes('Description')) {
        propDef.useInSuggest = true;
        propDef.useInSpellcheck = true;
        propDef.nodeScopeIndex = true;
    } else if (propertyName.includes('tag') || propertyName.includes('Tag')) {
        propDef.useInSuggest = true;
        propDef.useInSpellcheck = true;
        propDef.nodeScopeIndex = true;
    }

    return propDef;
}

function formatAST(node, indent = 0) {
    const spaces = '  '.repeat(indent);
    
    if (node === null || node === undefined) {
        return `${spaces}null`;
    }
    
    if (typeof node !== 'object') {
        return `${spaces}${JSON.stringify(node)}`;
    }
    
    if (Array.isArray(node)) {
        if (node.length === 0) {
            return `${spaces}[]`;
        }
        
        let result = `${spaces}[\n`;
        for (let i = 0; i < node.length; i++) {
            result += formatAST(node[i], indent + 1);
            if (i < node.length - 1) {
                result += ',';
            }
            result += '\n';
        }
        result += `${spaces}]`;
        return result;
    }
    
    let result = `${spaces}{\n`;
    const keys = Object.keys(node);
    
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = node[key];
        
        result += `${spaces}  "${key}": `;
        
        if (typeof value === 'object' && value !== null) {
            result += '\n' + formatAST(value, indent + 2);
        } else {
            result += JSON.stringify(value);
        }
        
        if (i < keys.length - 1) {
            result += ',';
        }
        result += '\n';
    }
    
    result += `${spaces}}`;
    return result;
}

function formatFilter(filter) {
    const lines = [];
    
    lines.push('Oak Filter Analysis:');
    lines.push('==================');
    lines.push('');
    
    if (filter.selector) {
        lines.push(`Selector: ${filter.selector}`);
    }
    
    if (filter.nodeType) {
        lines.push(`Node Type: ${filter.nodeType}`);
    }
    
    lines.push('');
    
    if (filter.pathRestrictions.length > 0) {
        lines.push('Path Restrictions:');
        filter.pathRestrictions.forEach(restriction => {
            switch (restriction.type) {
                case 'PATH_PREFIX':
                    lines.push(`  - Path starts with: ${restriction.path}`);
                    break;
                case 'PATH_GLOB':
                    lines.push(`  - Path matches: ${restriction.pattern}`);
                    break;
                case 'PATH_EXACT':
                    lines.push(`  - Exact path: ${restriction.path}`);
                    break;
            }
        });
        lines.push('');
    }
    
    if (filter.propertyRestrictions.length > 0) {
        lines.push('Property Restrictions:');
        filter.propertyRestrictions.forEach(restriction => {
            const valueStr = restriction.value !== null ? JSON.stringify(restriction.value) : 'null';
            lines.push(`  - ${restriction.propertyName} ${restriction.operator} ${valueStr}`);
        });
        lines.push('');
    }
    
    if (filter.sortOrder.length > 0) {
        lines.push('Sort Order:');
        filter.sortOrder.forEach(sort => {
            lines.push(`  - ${sort.property} ${sort.direction}`);
        });
        lines.push('');
    }
    
    if (filter.properties.size > 0) {
        lines.push('Referenced Properties:');
        Array.from(filter.properties).forEach(prop => {
            lines.push(`  - ${prop}`);
        });
        lines.push('');
    }
    
    // Oak-specific optimizations
    lines.push('Query Optimizations:');
    if (filter.pathPrefix) {
        lines.push(`  - Can use path index (prefix: ${filter.pathPrefix})`);
    }
    if (filter.nodeType) {
        lines.push(`  - Can use node type index (${filter.nodeType})`);
    }
    if (filter.propertyRestrictions.some(r => r.propertyName === 'jcr:uuid')) {
        lines.push('  - Can use UUID index');
    }
    if (filter.propertyRestrictions.some(r => r.propertyName.startsWith('jcr:'))) {
        lines.push('  - Uses JCR system properties');
    }
    
    return lines.join('\n');
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

function formatLuceneIndex(indexDef) {
    // Format as JSON with custom formatting for readability
    return formatJSONCustom(indexDef, 0);
}

// Export for Node.js testing environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SQL2Lexer,
        SQL2Parser,
        convertASTToFilter,
        convertFilterToLuceneIndex,
        formatAST,
        formatFilter,
        formatLuceneIndex
    };
} 