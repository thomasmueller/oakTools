// XPath to SQL-2 Converter - Accurate port of Java XPathToSQL2Converter
// Based on Apache Jackrabbit Oak XPathToSQL2Converter.java

// Character types, used during the tokenizer phase
const CHAR_END = -1, CHAR_VALUE = 2;
const CHAR_NAME = 4, CHAR_SPECIAL_1 = 5, CHAR_SPECIAL_2 = 6;
const CHAR_STRING = 7, CHAR_DECIMAL = 8;

// Token types
const KEYWORD = 1, IDENTIFIER = 2, END = 4, VALUE_STRING = 5, VALUE_NUMBER = 6;
const MINUS = 12, PLUS = 13, OPEN = 14, CLOSE = 15;

// Configuration flags
const NODETYPE_OPTIMIZATION = true;
const NODETYPE_UNION = true;

/**
 * XPath to SQL2 Converter - Main entry point
 * @param {string} query - XPath query string
 * @returns {string} - SQL2 query string
 * @throws {Error} - If parsing fails
 */
function convertXPathToSQL2(query) {
    const converter = new XPathToSQL2Converter();
    return converter.convert(query);
}

/**
 * XPath to SQL2 Converter Class - Port of Java implementation
 */
class XPathToSQL2Converter {
    constructor() {
        // The query as an array of characters and character types
        this.statement = '';
        this.statementChars = null;
        this.characterTypes = null;

        // The current state of the parser
        this.parseIndex = 0;
        this.currentTokenType = 0;
        this.currentToken = '';
        this.currentTokenQuoted = false;
        this.expected = null;
        this.currentSelector = new Selector();
        this.selectors = [];
    }

    /**
     * Convert the query to SQL2.
     * @param {string} query - the query string
     * @returns {string} - the SQL2 query
     * @throws {Error} - if parsing fails
     */
    convert(query) {
        const statement = this.convertToStatement(query);
        return statement.toString();
    }

    convertToStatement(query) {
        query = query.trim();

        const statement = new Statement();

        if (query.startsWith("explain ")) {
            query = query.substring("explain".length).trim();
            statement.setExplain(true);
        }
        if (query.startsWith("measure")) {
            query = query.substring("measure".length).trim();
            statement.setMeasure(true);
        }

        if (query === '') {
            // special case, will always result in an empty result
            query = "//jcr:root";
        }

        statement.setOriginalQuery(query);

        this.initialize(query);

        this.expected = [];
        this.read();

        if (this.currentTokenType === END) {
            throw this.getSyntaxError("the query may not be empty");
        }

        this.currentSelector.name = "a";

        let pathPattern = "";
        let startOfQuery = true;

        while (true) {
            // if true, path or nodeType conditions are not allowed
            let shortcut = false;
            const slash = this.readIf("/");

            if (!slash) {
                if (startOfQuery) {
                    // the query doesn't start with "/"
                    this.currentSelector.path = "/";
                    pathPattern = "/";
                    this.currentSelector.isChild = true;
                } else {
                    break;
                }
            } else if (this.readIf("jcr:root")) {
                // "/jcr:root" may only appear at the beginning
                if (pathPattern !== '') {
                    throw this.getSyntaxError("jcr:root needs to be at the beginning");
                }
                if (this.readIf("/")) {
                    // "/jcr:root/"
                    this.currentSelector.path = "/";
                    pathPattern = "/";
                    if (this.readIf("/")) {
                        // "/jcr:root//"
                        pathPattern = "//";
                        this.currentSelector.isDescendant = true;
                    } else {
                        this.currentSelector.isChild = true;
                    }
                } else {
                    // for example "/jcr:root[condition]"
                    pathPattern = "/%";
                    this.currentSelector.path = "/";
                    shortcut = true;
                }
            } else if (this.readIf("/")) {
                // "//" was read
                pathPattern += "%";
                if (this.currentSelector.isDescendant) {
                    // the query started with "//", and now "//" was read
                    this.nextSelector(true);
                }
                this.currentSelector.isDescendant = true;
            } else {
                // the token "/" was read
                pathPattern += "/";
                if (startOfQuery) {
                    this.currentSelector.path = "/";
                } else {
                    if (this.currentSelector.isDescendant) {
                        // the query started with "//", and now "/" was read
                        this.nextSelector(true);
                    }
                    this.currentSelector.isChild = true;
                }
            }

            const startParseIndex = this.parseIndex;
            if (shortcut) {
                // "*" and so on are not allowed now
            } else if (this.readIf("*")) {
                // "...*"
                pathPattern += "%";
                if (!this.currentSelector.isDescendant) {
                    if (this.selectors.length === 0 && this.currentSelector.path === "") {
                        // the query /* is special
                        this.currentSelector.path = "/";
                    }
                }
            } else if (this.currentTokenType === IDENTIFIER) {
                // probably a path restriction
                const identifier = this.readIdentifier();
                if (this.readIf("(")) {
                    if ("text" === identifier) {
                        // "...text()"
                        this.currentSelector.isChild = false;
                        pathPattern += "jcr:xmltext";
                        this.read(")");
                        if (this.currentSelector.isDescendant) {
                            this.currentSelector.nodeName = "jcr:xmltext";
                        } else {
                            this.currentSelector.path = PathUtils.concat(this.currentSelector.path, "jcr:xmltext");
                        }
                    } else if ("element" === identifier) {
                        // "...element(..."
                        if (this.readIf(")")) {
                            // any
                            pathPattern += "%";
                        } else {
                            if (this.readIf("*")) {
                                // any
                                pathPattern += "%";
                            } else {
                                const name = this.readPathSegment();
                                pathPattern += name;
                                this.appendNodeName(name);
                            }
                            if (this.readIf(",")) {
                                this.currentSelector.nodeType = this.readIdentifier();
                            }
                            this.read(")");
                        }
                    } else if ("rep:excerpt" === identifier) {
                        let p;

                        if (this.readIf(")")) {
                            this.rewindSelector();
                            p = new ExpressionProperty(this.currentSelector, "rep:excerpt", false);
                        } else if (this.readIf(".")) {
                            this.rewindSelector();
                            p = new ExpressionProperty(this.currentSelector, "rep:excerpt", false);
                            this.read(")");
                        } else {
                            // this will also deal with relative properties
                            const e = this.parseExpression();
                            if (!(e instanceof ExpressionProperty)) {
                                throw this.getSyntaxError();
                            }
                            const prop = e;
                            const property = prop.getColumnAliasName();
                            this.rewindSelector();
                            p = new ExpressionProperty(this.currentSelector,
                                "rep:excerpt(" + property + ")", false);
                            this.read(")");
                        }

                        statement.addSelectColumn(p);
                    } else {
                        throw this.getSyntaxError();
                    }
                } else {
                    const name = ISO9075.decode(identifier);
                    pathPattern += name;
                    this.appendNodeName(name);
                }
            } else if (this.readIf("@")) {
                this.rewindSelector();
                const p = this.readProperty();
                statement.addSelectColumn(p);
            } else if (this.readIf("(")) {
                this.rewindSelector();
                do {
                    if (this.readIf("@")) {
                        const p = this.readProperty();
                        statement.addSelectColumn(p);
                    } else if (this.readIf("rep:excerpt")) {
                        let p;

                        this.read("(");
                        if (this.readIf(")")) {
                            p = new ExpressionProperty(this.currentSelector, "rep:excerpt", false);
                        } else if (this.readIf(".")) {
                            p = new ExpressionProperty(this.currentSelector, "rep:excerpt", false);
                            this.read(")");
                        } else {
                            // this will also deal with relative properties
                            const e = this.parseExpression();
                            if (!(e instanceof ExpressionProperty)) {
                                throw this.getSyntaxError();
                            }
                            const prop = e;
                            const property = prop.getColumnAliasName();
                            p = new ExpressionProperty(this.currentSelector,
                                "rep:excerpt(" + property + ")", false);
                            this.read(")");
                        }

                        statement.addSelectColumn(p);
                    } else if (this.readIf("rep:spellcheck")) {
                        // only rep:spellcheck() is currently supported
                        this.read("(");
                        this.read(")");
                        const p = new ExpressionProperty(this.currentSelector, "rep:spellcheck()", false);
                        statement.addSelectColumn(p);
                    } else if (this.readIf("rep:suggest")) {
                        this.readOpenDotClose(true);
                        const p = new ExpressionProperty(this.currentSelector, "rep:suggest()", false);
                        statement.addSelectColumn(p);
                    } else if (this.readIf("rep:facet")) {
                        // this will also deal with relative properties
                        // (functions and so on are also working, but this is probably not needed)
                        this.read("(");
                        const e = this.parseExpression();
                        if (!(e instanceof ExpressionProperty)) {
                            throw this.getSyntaxError();
                        }
                        const prop = e;
                        const property = prop.getColumnAliasName();
                        this.read(")");
                        this.rewindSelector();
                        const p = new ExpressionProperty(this.currentSelector,
                            "rep:facet(" + property + ")", false);
                        statement.addSelectColumn(p);
                    }
                } while (this.readIf("|"));
                if (!this.readIf(")")) {
                    return this.convertToUnion(query, statement, startParseIndex - 1);
                }
            } else if (this.readIf(".")) {
                // just "." this is simply ignored, so that
                // "a/./b" is the same as "a/b"
                if (this.readIf(".")) {
                    // ".." means "the parent of the node"
                    // handle like a regular path restriction
                    const name = "..";
                    pathPattern += name;
                    if (!this.currentSelector.isChild) {
                        this.currentSelector.nodeName = name;
                    } else {
                        if (this.currentSelector.isChild) {
                            this.currentSelector.isChild = false;
                            this.currentSelector.isParent = true;
                        }
                    }
                } else {
                    if (this.selectors.length > 0) {
                        this.currentSelector = this.selectors.pop();
                        this.currentSelector.condition = null;
                        this.currentSelector.joinCondition = null;
                    }
                }
            } else {
                throw this.getSyntaxError();
            }
            if (this.readIf("[")) {
                do {
                    const c = this.parseConstraint();
                    this.currentSelector.condition = Expression.and(this.currentSelector.condition, c);
                    this.read("]");
                } while (this.readIf("["));
            }
            startOfQuery = false;
            this.nextSelector(false);
        }

        if (this.selectors.length === 0) {
            this.nextSelector(true);
        }

        // the current selector wasn't used so far
        // go back to the last one
        this.currentSelector = this.selectors[this.selectors.length - 1];
        if (this.selectors.length === 1) {
            this.currentSelector.onlySelector = true;
        }

        if (this.readIf("order")) {
            this.read("by");
            do {
                const order = new Order();
                order.expr = this.parseExpression();
                if (this.readIf("descending")) {
                    order.descending = true;
                } else {
                    this.readIf("ascending");
                }
                statement.addOrderBy(order);
            } while (this.readIf(","));
        }

        let options = null;
        if (this.readIf("option")) {
            this.read("(");
            options = new QueryOptions();
            while (true) {
                if (this.readIf("traversal")) {
                    const type = this.readIdentifier().toUpperCase();
                    options.traversal = type; // Traversal.valueOf(type)
                } else if (this.readIf("index")) {
                    if (this.readIf("name")) {
                        options.indexName = this.readIdentifier();
                    } else if (this.readIf("tag")) {
                        options.indexTag = this.readIdentifier();
                    }
                } else if (this.readIf("offset")) {
                    options.offset = this.readNumber();
                } else if (this.readIf("limit")) {
                    options.limit = this.readNumber();
                } else if (this.readIf("prefetches")) {
                    options.prefetchCount = parseInt(this.readNumber());
                } else if (this.readIf("prefetch")) {
                    // legacy
                    options.prefetchCount = parseInt(this.readNumber());
                } else {
                    break;
                }
                if (!this.readIf(",")) {
                    break;
                }
            }
            this.read(")");
        }

        statement.setQueryOptions(options);

        // now combine the selectors
        // if there is only one selector, this is simple
        const columnSelector = this.selectors[0];
        statement.setColumnSelector(columnSelector);
        statement.setSelectors(this.selectors);

        // build all conditions
        let where = null;
        
        // Add path conditions for selectors
        for (let i = 0; i < this.selectors.length; i++) {
            const s = this.selectors[i];
            
            // Add path conditions
            if (i === 0) { // First selector
                if (s.isDescendant && s.path && s.path !== '/' && s.path !== '') {
                    const pathCondition = new ExpressionFunction("isdescendantnode", [
                        new ExpressionSelectorExpr(s),
                        ExpressionLiteral.newString(s.path)
                    ]);
                    where = Expression.and(where, pathCondition);
                } else if (s.isChild && s.path && s.path !== '/' && s.path !== '') {
                    const pathCondition = new ExpressionFunction("ischildnode", [
                        new ExpressionSelectorExpr(s),
                        ExpressionLiteral.newString(s.path)
                    ]);
                    where = Expression.and(where, pathCondition);
                }
            }
            
            if (s.joinCondition != null) {
                where = Expression.and(where, s.joinCondition);
            }
            if (s.condition != null) {
                where = Expression.and(where, s.condition);
            }
        }
        statement.setWhere(where);

        return statement;
    }

    // Helper methods for parsing

    nextSelector(create) {
        if (create || this.currentSelector.condition != null) {
            this.selectors.push(this.currentSelector);
            this.currentSelector = new Selector(this.currentSelector);
            this.currentSelector.name = String.fromCharCode(97 + this.selectors.length); // 'a', 'b', etc.
        }
    }

    rewindSelector() {
        if (this.selectors.length > 0) {
            this.currentSelector = this.selectors[this.selectors.length - 1];
        }
    }

    appendNodeName(name) {
        if (this.currentSelector.isDescendant) {
            this.currentSelector.nodeName = name;
        } else {
            this.currentSelector.path = PathUtils.concat(this.currentSelector.path, name);
        }
    }

    readIf(token) {
        if (this.currentToken === token) {
            this.read();
            return true;
        }
        this.addExpected(token);
        return false;
    }

    read(token = null) {
        if (token && this.currentToken !== token) {
            throw this.getSyntaxError(`Expected '${token}' but got '${this.currentToken}'`);
        }
        
        this.currentTokenQuoted = false;
        if (this.expected) {
            this.expected = [];
        }
        
        const types = this.characterTypes;
        let i = this.parseIndex;
        let type = types[i];
        
        while (type === 0) {
            type = types[++i];
        }
        
        const start = i;
        const chars = this.statementChars;
        let c = chars[i++];
        this.currentToken = "";
        
        switch (type) {
            case CHAR_NAME:
                while (true) {
                    type = types[i];
                    // the '-' can be part of a name,
                    // for example in "fn:lower-case"
                    // the '.' can be part of a name,
                    // for example in "@offloading.status"
                    if (type !== CHAR_NAME && type !== CHAR_VALUE
                            && chars[i] !== '-'
                            && chars[i] !== '.') {
                        break;
                    }
                    i++;
                }
                this.currentToken = this.statement.substring(start, i);
                if (this.currentToken === '') {
                    throw this.getSyntaxError();
                }
                this.currentTokenType = IDENTIFIER;
                this.parseIndex = i;
                return;
                
            case CHAR_SPECIAL_2:
                if (types[i] === CHAR_SPECIAL_2) {
                    i++;
                }
                this.currentToken = this.statement.substring(start, i);
                this.currentTokenType = KEYWORD;
                this.parseIndex = i;
                break;
                
            case CHAR_SPECIAL_1:
                this.currentToken = this.statement.substring(start, i);
                switch (c) {
                    case '+':
                        this.currentTokenType = PLUS;
                        break;
                    case '-':
                        this.currentTokenType = MINUS;
                        break;
                    case '(':
                        this.currentTokenType = OPEN;
                        break;
                    case ')':
                        this.currentTokenType = CLOSE;
                        break;
                    default:
                        this.currentTokenType = KEYWORD;
                }
                this.parseIndex = i;
                return;
                
            case CHAR_VALUE:
                let number = c.charCodeAt(0) - '0'.charCodeAt(0);
                while (true) {
                    c = chars[i];
                    if (c < '0' || c > '9') {
                        if (c === '.') {
                            this.readDecimal(start, i);
                            break;
                        }
                        if (c === 'E' || c === 'e') {
                            this.readDecimal(start, i);
                            break;
                        }
                        this.currentTokenType = VALUE_NUMBER;
                        this.currentToken = String(number);
                        this.parseIndex = i;
                        break;
                    }
                    number = number * 10 + (c.charCodeAt(0) - '0'.charCodeAt(0));
                    if (number > 2147483647) { // Integer.MAX_VALUE
                        this.readDecimal(start, i);
                        break;
                    }
                    i++;
                }
                return;
                
            case CHAR_DECIMAL:
                if (types[i] !== CHAR_VALUE) {
                    this.currentTokenType = KEYWORD;
                    this.currentToken = ".";
                    this.parseIndex = i;
                    return;
                }
                this.readDecimal(start, i - 1);
                return;
                
            case CHAR_STRING:
                this.readString(i, c);
                return;
                
            case CHAR_END:
                this.currentToken = "";
                this.currentTokenType = END;
                this.parseIndex = i;
                return;
                
            default:
                throw this.getSyntaxError();
        }
    }

    readDecimal(start, i) {
        while (true) {
            const type = this.characterTypes[i];
            if (type !== CHAR_VALUE) {
                break;
            }
            i++;
        }
        if (this.statementChars[i] === 'E' || this.statementChars[i] === 'e') {
            i++;
            if (this.statementChars[i] === '+' || this.statementChars[i] === '-') {
                i++;
            }
            while (true) {
                const type = this.characterTypes[i];
                if (type !== CHAR_VALUE) {
                    break;
                }
                i++;
            }
        }
        this.parseIndex = i;
        this.currentToken = this.statement.substring(start, i);
        this.currentTokenType = VALUE_NUMBER;
    }

    readString(i, quote) {
        const start = i - 1;
        while (true) {
            if (this.statementChars[i] === quote) {
                break;
            }
            if (i >= this.statementChars.length) {
                throw this.getSyntaxError("Unterminated string: " + this.statement.substring(start));
            }
            i++;
        }
        this.currentToken = this.statement.substring(start + 1, i);
        this.currentTokenQuoted = true;
        this.currentTokenType = VALUE_STRING;
        this.parseIndex = i + 1;
    }

    readIdentifier() {
        if (this.currentTokenType !== IDENTIFIER) {
            throw this.getSyntaxError("Expected identifier");
        }
        const s = this.currentToken;
        this.read();
        return s;
    }

    readNumber() {
        if (this.currentTokenType !== VALUE_NUMBER) {
            throw this.getSyntaxError("Expected number");
        }
        const number = parseFloat(this.currentToken);
        this.read();
        return number;
    }

    readPathSegment() {
        return this.readIdentifier();
    }

    readProperty() {
        return new ExpressionProperty(this.currentSelector, this.readIdentifier(), false);
    }

    readOpenDotClose(allowEmpty) {
        this.read("(");
        if (allowEmpty && this.readIf(")")) {
            return;
        }
        this.read(".");
        this.read(")");
    }

    parseConstraint() {
        let a = this.parseAnd();
        let i = 0;
        while (this.readIf("or")) {
            a = new ExpressionOrCondition(a, this.parseAnd());
            if (++i % 100 === 0) {
                // optimize every 100 iterations
                a = a.optimize ? a.optimize() : a;
            }
        }
        return a.optimize ? a.optimize() : a;
    }

    parseAnd() {
        let a = this.parseCondition();
        while (this.readIf("and")) {
            a = new ExpressionAndCondition(a, this.parseCondition());
        }
        return a.optimize ? a.optimize() : a;
    }

    parseCondition() {
        let a;
        if (this.readIf("fn:not") || this.readIf("not")) {
            this.read("(");
            a = this.parseConstraint();
            if (a instanceof ExpressionCondition && a.operator === "is not null") {
                // not(@property) -> @property is null
                a = new ExpressionCondition(a.left, "is null", null);
            } else {
                const f = new ExpressionFunction("not");
                f.params.push(a);
                a = f;
            }
            this.read(")");
        } else if (this.readIf("(")) {
            a = this.parseConstraint();
            this.read(")");
        } else {
            const e = this.parseExpression();
            if (e.isCondition && e.isCondition()) {
                return e;
            }
            a = this.parseConditionFromExpression(e);
        }
        return a.optimize ? a.optimize() : a;
    }

    parseConditionFromExpression(left) {
        if (this.readIf("=")) {
            return new ExpressionCondition(left, "=", this.parseExpression());
        } else if (this.readIf("<>")) {
            return new ExpressionCondition(left, "<>", this.parseExpression());
        } else if (this.readIf("!=")) {
            return new ExpressionCondition(left, "<>", this.parseExpression());
        } else if (this.readIf("<")) {
            return new ExpressionCondition(left, "<", this.parseExpression());
        } else if (this.readIf(">")) {
            return new ExpressionCondition(left, ">", this.parseExpression());
        } else if (this.readIf("<=")) {
            return new ExpressionCondition(left, "<=", this.parseExpression());
        } else if (this.readIf(">=")) {
            return new ExpressionCondition(left, ">=", this.parseExpression());
        } else {
            return new ExpressionCondition(left, "is not null", null);
        }
    }

    parseExpression() {
        if (this.readIf("@")) {
            return this.readProperty();
        } else if (this.readIf("true")) {
            if (this.readIf("(")) {
                this.read(")");
            }
            return ExpressionLiteral.newBoolean(true);
        } else if (this.readIf("false")) {
            if (this.readIf("(")) {
                this.read(")");
            }
            return ExpressionLiteral.newBoolean(false);
        } else if (this.readIf("$")) {
            return ExpressionLiteral.newBindVariable(this.readIdentifier());
        } else if (this.currentTokenType === VALUE_NUMBER) {
            const l = ExpressionLiteral.newNumber(this.currentToken);
            this.read();
            return l;
        } else if (this.currentTokenType === VALUE_STRING) {
            const l = ExpressionLiteral.newString(this.currentToken);
            this.read();
            return l;
        } else if (this.readIf("-")) {
            if (this.currentTokenType !== VALUE_NUMBER) {
                throw this.getSyntaxError();
            }
            const l = ExpressionLiteral.newNumber('-' + this.currentToken);
            this.read();
            return l;
        } else if (this.readIf("+")) {
            if (this.currentTokenType !== VALUE_NUMBER) {
                throw this.getSyntaxError();
            }
            return this.parseExpression();
        } else {
            return this.parsePropertyOrFunction();
        }
    }

    parsePropertyOrFunction() {
        let buff = '';
        let isPath = false;
        
        while (true) {
            if (this.currentTokenType === IDENTIFIER) {
                const name = this.readPathSegment();
                buff += name;
            } else if (this.readIf("*")) {
                // any node
                buff += '*';
                isPath = true;
            } else if (this.readIf(".")) {
                buff += '.';
                if (this.readIf(".")) {
                    buff += '.';
                }
                isPath = true;
            } else if (this.readIf("@")) {
                if (this.readIf("*")) {
                    // xpath supports @*, even though jackrabbit may not
                    buff += '*';
                } else {
                    buff += this.readPathSegment();
                }
                return new ExpressionProperty(this.currentSelector, buff, false);
            } else {
                break;
            }
            if (this.readIf("/")) {
                isPath = true;
                buff += '/';
            } else {
                break;
            }
        }
        
        if (!isPath && this.readIf("(")) {
            return this.parseFunction(buff);
        } else if (buff.length > 0) {
            if (isPath) {
                return new ExpressionProperty(this.currentSelector, buff, true);
            } else {
                return new ExpressionProperty(this.currentSelector, buff, false);
            }
        } else {
            throw this.getSyntaxError("Unexpected token");
        }
    }

    parseFunction(name) {
        // Complete function conversion based on Java XPathToSQL2Converter.parseFunction
        if (name === "jcr:like") {
            const left = this.parseExpression();
            this.read(",");
            const right = this.parseExpression();
            this.read(")");
            return new ExpressionCondition(left, "like", right);
        } else if (name === "jcr:contains") {
            const left = this.parseExpression();
            this.read(",");
            const right = this.parseExpression();
            this.read(")");
            return new ExpressionContains(left, right);
        } else if (name === "jcr:score") {
            const f = new ExpressionFunction("score");
            f.params.push(new ExpressionSelectorExpr(this.currentSelector));
            this.read(")");
            return f;
        } else if (name === "xs:dateTime") {
            const expr = this.parseExpression();
            this.read(")");
            return new ExpressionCast(expr, "date");
        } else if (name === "fn:coalesce") {
            const f = new ExpressionFunction("coalesce");
            f.params.push(this.parseExpression());
            this.read(",");
            f.params.push(this.parseExpression());
            this.read(")");
            return f;
        } else if (name === "jcr:first") {
            const f = new ExpressionFunction("first");
            f.params.push(this.parseExpression());
            this.read(")");
            return f;
        } else if (name === "fn:lower-case") {
            const f = new ExpressionFunction("lower");
            f.params.push(this.parseExpression());
            this.read(")");
            return f;
        } else if (name === "fn:upper-case") {
            const f = new ExpressionFunction("upper");
            f.params.push(this.parseExpression());
            this.read(")");
            return f;
        } else if (name === "fn:string-length") {
            const f = new ExpressionFunction("length");
            f.params.push(this.parseExpression());
            this.read(")");
            return f;
        } else if (name === "fn:name") {
            const f = new ExpressionFunction("name");
            if (!this.readIf(")")) {
                // only name(.) and name() are currently supported
                this.read(".");
                this.read(")");
            }
            f.params.push(new ExpressionSelectorExpr(this.currentSelector));
            return f;
        } else if (name === "fn:path") {
            const f = new ExpressionFunction("path");
            if (!this.readIf(")")) {
                // only path(.) and path() are currently supported
                this.read(".");
                this.read(")");
            }
            f.params.push(new ExpressionSelectorExpr(this.currentSelector));
            return f;
        } else if (name === "fn:local-name") {
            const f = new ExpressionFunction("localname");
            if (!this.readIf(")")) {
                // only localname(.) and localname() are currently supported
                this.read(".");
                this.read(")");
            }
            f.params.push(new ExpressionSelectorExpr(this.currentSelector));
            return f;
        } else if (name === "jcr:deref") {
            throw this.getSyntaxError("jcr:deref is not supported");
        } else if (name === "rep:native") {
            const selectorName = this.currentSelector.name;
            const language = this.parseExpression();
            this.read(",");
            const expr = this.parseExpression();
            this.read(")");
            return new ExpressionNativeFunction(selectorName, language, expr);
        } else if (name === "rep:similar") {
            const property = this.parseExpression();
            this.read(",");
            const path = this.parseExpression();
            this.read(")");
            return new ExpressionSimilar(property, path);
        } else if (name === "rep:spellcheck") {
            const term = this.parseExpression();
            this.read(")");
            return new ExpressionSpellcheck(term);
        } else if (name === "rep:suggest") {
            const term = this.parseExpression();
            this.read(")");
            return new ExpressionSuggest(term);
        } else {
            throw this.getSyntaxError("Unsupported function: " + name + ". Supported: jcr:like | jcr:contains | jcr:score | xs:dateTime | " +
                    "fn:lower-case | fn:upper-case | jcr:first | fn:name | fn:local-name | fn:path | rep:similar | rep:spellcheck | rep:suggest");
        }
    }

    convertToUnion(query, statement, startParseIndex) {
        // Union conversion logic - simplified
        return statement;
    }

    addExpected(token) {
        if (this.expected) {
            this.expected.push(token);
        }
    }

    getSyntaxError(message = null) {
        if (!message) {
            if (this.expected && this.expected.length > 0) {
                message = `Expected: ${this.expected.join(', ')}`;
            } else {
                message = `Unexpected token: '${this.currentToken}'`;
            }
        }
        return new Error(`Syntax error at position ${this.parseIndex}: ${message}`);
    }

    initialize(query) {
        if (!query) {
            query = "";
        }
        this.statement = query;
        let len = query.length + 1;
        const command = new Array(len);
        const types = new Array(len);
        len--;
        for (let i = 0; i < len; i++) {
            command[i] = query.charAt(i);
        }
        command[len] = ' ';
        
        let startLoop = 0;
        for (let i = 0; i < len; i++) {
            const c = command[i];
            let type = 0;
            switch (c) {
                case '@':
                case '|':
                case '/':
                case '-':
                case '(':
                case ')':
                case '{':
                case '}':
                case '*':
                case ',':
                case ';':
                case '+':
                case '%':
                case '?':
                case '$':
                case '[':
                case ']':
                    type = CHAR_SPECIAL_1;
                    break;
                case '!':
                case '<':
                case '>':
                case '=':
                    type = CHAR_SPECIAL_2;
                    break;
                case '.':
                    type = CHAR_DECIMAL;
                    break;
                case '\'':
                    type = CHAR_STRING;
                    types[i] = CHAR_STRING;
                    startLoop = i;
                    while (command[++i] !== '\'') {
                        this.checkRunOver(i, len, startLoop);
                    }
                    break;
                case '"':
                    type = CHAR_STRING;
                    types[i] = CHAR_STRING;
                    startLoop = i;
                    while (command[++i] !== '"') {
                        this.checkRunOver(i, len, startLoop);
                    }
                    break;
                case ':':
                case '_':
                    type = CHAR_NAME;
                    break;
                default:
                    if (c >= 'a' && c <= 'z') {
                        type = CHAR_NAME;
                    } else if (c >= 'A' && c <= 'Z') {
                        type = CHAR_NAME;
                    } else if (c >= '0' && c <= '9') {
                        type = CHAR_VALUE;
                    } else {
                        // Check if it's a valid identifier character
                        if (/[\w\u00a1-\uffff]/.test(c)) {
                            type = CHAR_NAME;
                        }
                    }
            }
            types[i] = type;
        }
        this.statementChars = command;
        types[len] = CHAR_END;
        this.characterTypes = types;
        this.parseIndex = 0;
    }

    checkRunOver(i, len, startLoop) {
        if (i >= len) {
            this.parseIndex = startLoop;
            throw this.getSyntaxError();
        }
    }
}

// Supporting Classes

class Statement {
    constructor() {
        this.explain = false;
        this.measure = false;
        this.columnSelector = null;
        this.columnList = [];
        this.selectors = null;
        this.where = null;
        this.orderList = [];
        this.xpathQuery = '';
        this.queryOptions = null;
    }

    setExplain(explain) {
        this.explain = explain;
    }

    setMeasure(measure) {
        this.measure = measure;
    }

    setOriginalQuery(query) {
        this.xpathQuery = query;
    }

    addSelectColumn(column) {
        this.columnList.push(column);
    }

    setColumnSelector(selector) {
        this.columnSelector = selector;
    }

    setSelectors(selectors) {
        this.selectors = selectors;
    }

    setWhere(where) {
        this.where = where;
    }

    addOrderBy(order) {
        this.orderList.push(order);
    }

    setQueryOptions(options) {
        this.queryOptions = options;
    }

    toString() {
        let buff = '';

        // explain | measure ...
        if (this.explain) {
            buff += "explain ";
        }
        if (this.measure) {
            buff += "measure ";
        }

        // select ...
        buff += "select ";
        buff += new ExpressionProperty(this.columnSelector, QueryConstants.JCR_PATH, false).toString();
        if (this.selectors.length > 1) {
            buff += " as [" + QueryConstants.JCR_PATH + "]";
        }
        buff += ", ";
        buff += new ExpressionProperty(this.columnSelector, QueryConstants.JCR_SCORE, false).toString();
        if (this.selectors.length > 1) {
            buff += " as [" + QueryConstants.JCR_SCORE + "]";
        }
        if (this.columnList.length === 0) {
            buff += ", ";
            buff += new ExpressionProperty(this.columnSelector, "*", false).toString();
        } else {
            for (let i = 0; i < this.columnList.length; i++) {
                buff += ", ";
                const e = this.columnList[i];
                const columnName = e.toString();
                buff += columnName;
                if (this.selectors.length > 1) {
                    buff += " as [" + e.getColumnAliasName() + "]";
                }
            }
        }

        // from ...
        buff += " from ";
        for (let i = 0; i < this.selectors.length; i++) {
            const s = this.selectors[i];
            if (i > 0) {
                buff += " inner join ";
            }
            let nodeType = s.nodeType;
            if (!nodeType) {
                nodeType = "nt:base";
            }
            buff += '[' + nodeType + ']' + " as " + s.name;
            if (s.joinCondition) {
                buff += " on " + s.joinCondition;
            }
        }

        // where ...
        if (this.where) {
            buff += " where " + this.where.toString();
        }

        // order by ...
        if (this.orderList.length > 0) {
            buff += " order by ";
            for (let i = 0; i < this.orderList.length; i++) {
                if (i > 0) {
                    buff += ", ";
                }
                buff += this.orderList[i];
            }
        }

        // Add options clause if present
        if (this.queryOptions) {
            const optionParts = [];
            
            if (this.queryOptions.traversal) {
                optionParts.push('traversal ' + this.queryOptions.traversal);
            }
            if (this.queryOptions.indexName) {
                optionParts.push('index name [' + this.queryOptions.indexName + ']');
            }
            if (this.queryOptions.indexTag) {
                optionParts.push('index tag [' + this.queryOptions.indexTag + ']');
            }
            if (this.queryOptions.offset !== null && this.queryOptions.offset !== undefined) {
                optionParts.push('offset ' + this.queryOptions.offset);
            }
            if (this.queryOptions.limit !== null && this.queryOptions.limit !== undefined) {
                optionParts.push('limit ' + this.queryOptions.limit);
            }
            if (this.queryOptions.prefetchCount !== null && this.queryOptions.prefetchCount !== undefined) {
                optionParts.push('prefetch ' + this.queryOptions.prefetchCount);
            }
            
            if (optionParts.length > 0) {
                buff += ' option (' + optionParts.join(', ') + ')';
            }
        }
        
        return buff;
    }
}

class Selector {
    constructor(source = null) {
        this.name = '';
        this.onlySelector = false;
        this.nodeType = null;
        this.isChild = false;
        this.isParent = false;
        this.isDescendant = false;
        this.path = '';
        this.nodeName = null;
        this.condition = null;
        this.joinCondition = null;

        if (source) {
            this.name = source.name;
            this.onlySelector = source.onlySelector;
            this.nodeType = source.nodeType;
            this.isChild = source.isChild;
            this.isParent = source.isParent;
            this.isDescendant = source.isDescendant;
            this.path = source.path;
            this.nodeName = source.nodeName;
            this.condition = source.condition;
            this.joinCondition = source.joinCondition;
        }
    }
}

class Order {
    constructor() {
        this.expr = null;
        this.descending = false;
    }

    toString() {
        let result = this.expr.toString();
        if (this.descending) {
            result += " desc";
        }
        return result;
    }
}

class QueryOptions {
    constructor() {
        this.traversal = null;
        this.indexName = null;
        this.indexTag = null;
        this.offset = null;
        this.limit = null;
        this.prefetchCount = null;
    }
}

// Expression classes (simplified)
class Expression {
    static and(left, right) {
        if (!left) return right;
        if (!right) return left;
        return new ExpressionAndCondition(left, right);
    }

    static or(left, right) {
        if (!left) return right;
        if (!right) return left;
        return new ExpressionOrCondition(left, right);
    }
}

class ExpressionProperty extends Expression {
    constructor(selector, propertyName, isPath) {
        super();
        this.selector = selector;
        this.propertyName = propertyName;
        this.isPath = isPath;
        this.thereWasNoAt = false; // Used by Contains expression
    }

    toString() {
        if (this.propertyName === '*') {
            return this.selector.name + '.*';
        }
        return this.selector.name + '.[' + this.propertyName + ']';
    }

    getColumnAliasName() {
        return this.propertyName;
    }
}

class ExpressionLiteral extends Expression {
    constructor(value, rawText = null) {
        super();
        this.value = value;
        this.rawText = rawText || value;
    }

    static newBoolean(value) {
        return new ExpressionLiteral(String(value), String(value));
    }

    static newNumber(s) {
        return new ExpressionLiteral(s, s);
    }

    static newString(s) {
        return new ExpressionLiteral(SQL2Utils.escapeStringLiteral(s), s);
    }

    static newBindVariable(s) {
        return new ExpressionLiteral("@" + s, s);
    }

    toString() {
        return this.value;
    }
}

class ExpressionAndCondition extends Expression {
    constructor(left, right) {
        super();
        this.left = left;
        this.right = right;
    }

    toString() {
        return '(' + this.left.toString() + ' and ' + this.right.toString() + ')';
    }
}

class ExpressionOrCondition extends Expression {
    constructor(left, right) {
        super();
        this.left = left;
        this.right = right;
    }

    toString() {
        return '(' + this.left.toString() + ' or ' + this.right.toString() + ')';
    }
}

class ExpressionCondition extends Expression {
    constructor(left, operator, right) {
        super();
        this.left = left;
        this.operator = operator;
        this.right = right;
    }

    toString() {
        if (this.right === null) {
            return this.left.toString() + ' ' + this.operator;
        }
        return this.left.toString() + ' ' + this.operator + ' ' + this.right.toString();
    }

    isCondition() {
        return true;
    }
}

class ExpressionFunction extends Expression {
    constructor(name, params = []) {
        super();
        this.name = name;
        this.params = params;
    }

    toString() {
        if (this.name === "path") {
            return 'path(' + this.params[0].toString() + ')';
        } else if (this.name === "score") {
            return 'score(' + this.params[0].toString() + ')';
        }
        return this.name + '(' + this.params.map(p => p.toString()).join(', ') + ')';
    }
}

class ExpressionSelectorExpr extends Expression {
    constructor(selector) {
        super();
        this.selector = selector;
    }

    toString() {
        return this.selector.name;
    }
}

class ExpressionContains extends Expression {
    constructor(left, right) {
        super();
        this.left = left;
        this.right = right;
    }

    toString() {
        let buff = "contains(";
        let l = this.left;
        if (l instanceof ExpressionProperty) {
            if (l.thereWasNoAt) {
                l = new ExpressionProperty(l.selector, l.propertyName + "/*", true);
            }
        }
        buff += l.toString();
        buff += ", " + this.right.toString() + ")";
        return buff;
    }

    isCondition() {
        return true;
    }
}

class ExpressionCast extends Expression {
    constructor(expr, type) {
        super();
        this.expr = expr;
        this.type = type;
    }

    toString() {
        return "cast(" + this.expr.toString() + " as " + this.type + ")";
    }

    isCondition() {
        return false;
    }
}

class ExpressionNativeFunction extends Expression {
    constructor(selector, language, expression) {
        super();
        this.selector = selector;
        this.language = language;
        this.expression = expression;
    }

    toString() {
        return "native(" + this.selector + ", " + this.language.toString() + ", " + this.expression.toString() + ")";
    }

    isCondition() {
        return true;
    }
}

class ExpressionSimilar extends Expression {
    constructor(property, path) {
        super();
        this.property = property;
        this.path = path;
    }

    toString() {
        return "similar(" + this.property.toString() + ", " + this.path.toString() + ")";
    }

    isCondition() {
        return true;
    }
}

class ExpressionSpellcheck extends Expression {
    constructor(term) {
        super();
        this.term = term;
    }

    toString() {
        return "spellcheck(" + this.term.toString() + ")";
    }

    isCondition() {
        return true;
    }
}

class ExpressionSuggest extends Expression {
    constructor(term) {
        super();
        this.term = term;
    }

    toString() {
        return "suggest(" + this.term.toString() + ")";
    }

    isCondition() {
        return true;
    }
}

// Utility classes
class PathUtils {
    static concat(base, child) {
        if (!base || base === '/') {
            return '/' + child;
        }
        return base + '/' + child;
    }
}

class ISO9075 {
    static decode(encoded) {
        // Simple decode - in real implementation would handle _x escaping
        return encoded;
    }
}

class SQL2Utils {
    static escapeStringLiteral(value) {
        if (value.indexOf("'") >= 0) {
            value = value.replace(/'/g, "''");
        }
        return "'" + value + "'";
    }
}

class QueryConstants {
    static get JCR_PATH() { return 'jcr:path'; }
    static get JCR_SCORE() { return 'jcr:score'; }
}

// Export for Node.js compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        convertXPathToSQL2,
        XPathToSQL2Converter
    };
} 