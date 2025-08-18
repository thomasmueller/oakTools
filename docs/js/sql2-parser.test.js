// Unit tests for SQL-2 Parser
// Run with: node sql2-parser.test.js

// Import the parser (for Node.js environment)
let SQL2Lexer, SQL2Parser, convertASTToFilter, convertFilterToLuceneIndex;

if (typeof require !== 'undefined') {
    const parser = require('./sql2-parser.js');
    SQL2Lexer = parser.SQL2Lexer;
    SQL2Parser = parser.SQL2Parser;
    convertASTToFilter = parser.convertASTToFilter;
    convertFilterToLuceneIndex = parser.convertFilterToLuceneIndex;
}

// Simple test framework
class TestRunner {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
    }

    test(name, fn) {
        this.tests.push({ name, fn });
    }

    assertEqual(actual, expected, message = '') {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
        }
    }

    assertTrue(condition, message = '') {
        if (!condition) {
            throw new Error(`${message}\nExpected: true\nActual: false`);
        }
    }

    assertContains(array, value, message = '') {
        if (!array.includes(value)) {
            throw new Error(`${message}\nExpected array to contain: ${value}\nActual: ${JSON.stringify(array)}`);
        }
    }

    run() {
        console.log('Running SQL-2 Parser Tests...\n');
        
        for (const test of this.tests) {
            try {
                test.fn.call(this);
                console.log(`✅ ${test.name}`);
                this.passed++;
            } catch (error) {
                console.log(`❌ ${test.name}`);
                console.log(`   ${error.message}\n`);
                this.failed++;
            }
        }

        console.log(`\nTest Results: ${this.passed} passed, ${this.failed} failed`);
        
        if (this.failed === 0) {
            console.log('🎉 All tests passed!');
        } else {
            console.log('⚠️  Some tests failed');
        }
        
        return this.failed === 0;
    }
}

// Test cases
const runner = new TestRunner();

// Lexer Tests
runner.test('Lexer - Simple SELECT statement', function() {
    const lexer = new SQL2Lexer('SELECT * FROM [nt:base]');
    const tokens = lexer.tokens;
    
    this.assertEqual(tokens[0].type, 'SELECT');
    this.assertEqual(tokens[1].type, 'STAR');
    this.assertEqual(tokens[2].type, 'FROM');
    this.assertEqual(tokens[3].type, 'BRACKETED_NAME');
    this.assertEqual(tokens[3].value, 'nt:base');
    this.assertEqual(tokens[4].type, 'EOF');
});

runner.test('Lexer - String literals', function() {
    const lexer = new SQL2Lexer("SELECT 'hello world' FROM [nt:base]");
    const tokens = lexer.tokens;
    
    this.assertEqual(tokens[1].type, 'STRING');
    this.assertEqual(tokens[1].value, 'hello world');
});

runner.test('Lexer - Number literals', function() {
    const lexer = new SQL2Lexer('SELECT 123 FROM [nt:base]');
    const tokens = lexer.tokens;
    
    this.assertEqual(tokens[1].type, 'NUMBER');
    this.assertEqual(tokens[1].value, 123);
});

runner.test('Lexer - Comparison operators', function() {
    const lexer = new SQL2Lexer('WHERE x = 1 AND y <> 2 AND z <= 3');
    const tokens = lexer.tokens;
    
    this.assertContains(tokens.map(t => t.type), 'EQUALS');
    this.assertContains(tokens.map(t => t.type), 'NOT_EQUALS');
    this.assertContains(tokens.map(t => t.type), 'LTE');
});

// Parser Tests
runner.test('Parser - Simple SELECT *', function() {
    const lexer = new SQL2Lexer('SELECT * FROM [nt:base]');
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.type, 'SelectStatement');
    this.assertEqual(ast.columns.length, 1);
    this.assertEqual(ast.columns[0].type, 'AllColumns');
    this.assertEqual(ast.from.type, 'NodeType');
    this.assertEqual(ast.from.value, 'nt:base');
});

runner.test('Parser - SELECT with properties', function() {
    const lexer = new SQL2Lexer('SELECT [jcr:title], [jcr:created] FROM [nt:base]');
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.columns.length, 2);
    this.assertEqual(ast.columns[0].expression.type, 'Property');
    this.assertEqual(ast.columns[0].expression.name, 'jcr:title');
    this.assertEqual(ast.columns[1].expression.type, 'Property');
    this.assertEqual(ast.columns[1].expression.name, 'jcr:created');
});

runner.test('Parser - WHERE clause with comparison', function() {
    const lexer = new SQL2Lexer("SELECT * FROM [nt:base] WHERE [jcr:title] = 'test'");
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.where.type, 'BinaryOperation');
    this.assertEqual(ast.where.operator, '=');
    this.assertEqual(ast.where.left.type, 'Property');
    this.assertEqual(ast.where.left.name, 'jcr:title');
    this.assertEqual(ast.where.right.type, 'Literal');
    this.assertEqual(ast.where.right.value, 'test');
});

runner.test('Parser - WHERE clause with LIKE', function() {
    const lexer = new SQL2Lexer("SELECT * FROM [nt:base] WHERE [jcr:path] LIKE '/content/%'");
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.where.type, 'BinaryOperation');
    this.assertEqual(ast.where.operator, 'LIKE');
    this.assertEqual(ast.where.left.name, 'jcr:path');
    this.assertEqual(ast.where.right.value, '/content/%');
});

runner.test('Parser - WHERE clause with AND', function() {
    const lexer = new SQL2Lexer("SELECT * FROM [nt:base] WHERE [jcr:title] = 'test' AND [jcr:created] > '2023-01-01'");
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.where.type, 'BinaryOperation');
    this.assertEqual(ast.where.operator, 'AND');
    this.assertEqual(ast.where.left.operator, '=');
    this.assertEqual(ast.where.right.operator, '>');
});

runner.test('Parser - ORDER BY clause', function() {
    const lexer = new SQL2Lexer('SELECT * FROM [nt:base] ORDER BY [jcr:created] DESC');
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.orderBy.length, 1);
    this.assertEqual(ast.orderBy[0].type, 'OrderBy');
    this.assertEqual(ast.orderBy[0].expression.name, 'jcr:created');
    this.assertEqual(ast.orderBy[0].direction, 'DESC');
});

runner.test('Parser - IS NULL clause', function() {
    const lexer = new SQL2Lexer('SELECT * FROM [nt:base] WHERE [jcr:title] IS NULL');
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.where.type, 'IsNull');
    this.assertEqual(ast.where.expression.name, 'jcr:title');
    this.assertEqual(ast.where.not, false);
});

runner.test('Parser - IS NOT NULL clause', function() {
    const lexer = new SQL2Lexer('SELECT * FROM [nt:base] WHERE [jcr:title] IS NOT NULL');
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.where.type, 'IsNull');
    this.assertEqual(ast.where.expression.name, 'jcr:title');
    this.assertEqual(ast.where.not, true);
});

runner.test('Parser - Function calls', function() {
    const lexer = new SQL2Lexer('SELECT UPPER([jcr:title]) FROM [nt:base]');
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.columns[0].expression.type, 'Function');
    this.assertEqual(ast.columns[0].expression.name, 'upper');
    this.assertEqual(ast.columns[0].expression.arguments.length, 1);
    this.assertEqual(ast.columns[0].expression.arguments[0].name, 'jcr:title');
});

runner.test('Parser - IN comparison', function() {
    const lexer = new SQL2Lexer("SELECT * FROM [nt:base] WHERE [jcr:primaryType] IN ('nt:file', 'nt:folder')");
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.where.type, 'InComparison');
    this.assertEqual(ast.where.expression.name, 'jcr:primaryType');
    this.assertEqual(ast.where.values.length, 2);
    this.assertEqual(ast.where.values[0].value, 'nt:file');
    this.assertEqual(ast.where.values[1].value, 'nt:folder');
});

runner.test('Parser - CAST expression', function() {
    const lexer = new SQL2Lexer('SELECT CAST([jcr:created] AS DATE) FROM [nt:base]');
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.columns[0].expression.type, 'Cast');
    this.assertEqual(ast.columns[0].expression.expression.name, 'jcr:created');
    this.assertEqual(ast.columns[0].expression.dataType, 'DATE');
});

runner.test('Parser - CONTAINS function', function() {
    const lexer = new SQL2Lexer("SELECT * FROM [nt:base] WHERE CONTAINS([jcr:content], 'test')");
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.where.type, 'Function');
    this.assertEqual(ast.where.name, 'contains');
    this.assertEqual(ast.where.arguments.length, 2);
    this.assertEqual(ast.where.arguments[0].name, 'jcr:content');
    this.assertEqual(ast.where.arguments[1].value, 'test');
});

runner.test('Parser - Multiple SQL-2 functions', function() {
    const lexer = new SQL2Lexer('SELECT LENGTH([jcr:title]), LOWER([jcr:description]), NAME() FROM [nt:base]');
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.columns.length, 3);
    this.assertEqual(ast.columns[0].expression.type, 'Function');
    this.assertEqual(ast.columns[0].expression.name, 'length');
    this.assertEqual(ast.columns[1].expression.type, 'Function');
    this.assertEqual(ast.columns[1].expression.name, 'lower');
    this.assertEqual(ast.columns[2].expression.type, 'Function');
    this.assertEqual(ast.columns[2].expression.name, 'name');
});

runner.test('Parser - OPTION clause', function() {
    const sql = "SELECT * FROM [nt:base] WHERE [name] = 'test' OPTION (index tag [myTag])";
    const lexer = new SQL2Lexer(sql);
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.type, 'SelectStatement');
    this.assertTrue(ast.options !== null);
    this.assertEqual(ast.options.indexTag, 'myTag');
});

runner.test('Parser - OPTION clause with identifier tag', function() {
    const sql = "SELECT * FROM [nt:base] WHERE [name] = 'test' OPTION (index tag myTag)";
    const lexer = new SQL2Lexer(sql);
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    this.assertEqual(ast.type, 'SelectStatement');
    this.assertTrue(ast.options !== null);
    this.assertEqual(ast.options.indexTag, 'myTag');
});

// Filter conversion tests
runner.test('Filter conversion - Basic query', function() {
    const lexer = new SQL2Lexer("SELECT [jcr:title] FROM [nt:base] WHERE [jcr:path] LIKE '/content/%'");
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    const filter = convertASTToFilter(ast);
    
    this.assertEqual(filter.nodeType, 'nt:base');
    this.assertEqual(filter.pathPrefix, '/content');
    this.assertEqual(filter.pathRestrictions.length, 1);
    this.assertEqual(filter.pathRestrictions[0].type, 'PATH_PREFIX');
});

runner.test('Filter conversion - Property restrictions', function() {
    const lexer = new SQL2Lexer("SELECT * FROM [nt:base] WHERE [jcr:created] > '2023-01-01'");
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    const filter = convertASTToFilter(ast);
    
    this.assertEqual(filter.propertyRestrictions.length, 1);
    this.assertEqual(filter.propertyRestrictions[0].propertyName, 'jcr:created');
    this.assertEqual(filter.propertyRestrictions[0].operator, '>');
    this.assertEqual(filter.propertyRestrictions[0].value, '2023-01-01');
});

runner.test('Filter conversion - Sort order', function() {
    const lexer = new SQL2Lexer('SELECT * FROM [nt:base] ORDER BY [jcr:created] DESC, [jcr:title] ASC');
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    const filter = convertASTToFilter(ast);
    
    this.assertEqual(filter.sortOrder.length, 2);
    this.assertEqual(filter.sortOrder[0].property, 'jcr:created');
    this.assertEqual(filter.sortOrder[0].direction, 'DESC');
    this.assertEqual(filter.sortOrder[1].property, 'jcr:title');
    this.assertEqual(filter.sortOrder[1].direction, 'ASC');
});

runner.test('Filter conversion - IN comparison', function() {
    const lexer = new SQL2Lexer("SELECT * FROM [nt:base] WHERE [jcr:primaryType] IN ('nt:file', 'nt:folder')");
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    const filter = convertASTToFilter(ast);
    
    this.assertEqual(filter.propertyRestrictions.length, 1);
    this.assertEqual(filter.propertyRestrictions[0].propertyName, 'jcr:primaryType');
    this.assertEqual(filter.propertyRestrictions[0].operator, 'IN');
    this.assertEqual(filter.propertyRestrictions[0].value.length, 2);
    this.assertEqual(filter.propertyRestrictions[0].value[0], 'nt:file');
    this.assertEqual(filter.propertyRestrictions[0].value[1], 'nt:folder');
});

runner.test('Filter conversion - CONTAINS function', function() {
    const lexer = new SQL2Lexer("SELECT * FROM [nt:base] WHERE CONTAINS([jcr:content], 'test')");
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    const filter = convertASTToFilter(ast);
    
    this.assertEqual(filter.isFulltextSearchable, true);
    this.assertEqual(filter.propertyRestrictions.length, 1);
    this.assertEqual(filter.propertyRestrictions[0].propertyName, 'jcr:content');
    this.assertEqual(filter.propertyRestrictions[0].operator, 'contains');
});

// Lucene index generation tests
runner.test('Lucene index generation - Basic structure', function() {
    const lexer = new SQL2Lexer("SELECT [jcr:title] FROM [nt:base] WHERE [jcr:path] LIKE '/content/%'");
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    const filter = convertASTToFilter(ast);
    const indexDef = convertFilterToLuceneIndex(filter);
    
    const indexKey = Object.keys(indexDef)[0];
    const index = indexDef[indexKey];
    
    this.assertEqual(index.type, 'lucene');
    this.assertTrue(Array.isArray(index.async));
    this.assertContains(index.async, 'async');
    this.assertEqual(index.compatVersion, 2);
    this.assertEqual(index.includedPaths, ['/content']);
    this.assertEqual(index.queryPaths, ['/content']);
});

runner.test('Lucene index generation - IndexRules properties', function() {
    const lexer = new SQL2Lexer("SELECT [jcr:title], [jcr:created] FROM [nt:base] WHERE [jcr:title] IS NOT NULL ORDER BY [jcr:created] DESC");
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    const filter = convertASTToFilter(ast);
    const indexDef = convertFilterToLuceneIndex(filter);
    
    const indexKey = Object.keys(indexDef)[0];
    const index = indexDef[indexKey];
    const properties = index.indexRules['nt:base'].properties;
    
    this.assertTrue('title' in properties);
    this.assertTrue('created' in properties);
    
    // jcr:created should be ordered (used in ORDER BY)
    this.assertEqual(properties.created.ordered, true);
    
    // jcr:title property should not have boost
    this.assertEqual(properties.title.hasOwnProperty('boost'), false, 'Title should not have boost property');
});

runner.test('Complex query test', function() {
    const sql = `SELECT [jcr:title], [jcr:created] 
                 FROM [nt:base] 
                 WHERE [jcr:path] LIKE '/content/%' 
                   AND [jcr:created] > '2023-01-01'
                   AND [jcr:title] IS NOT NULL
                 ORDER BY [jcr:created] DESC`;
    
    const lexer = new SQL2Lexer(sql);
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    // Verify AST structure
    this.assertEqual(ast.type, 'SelectStatement');
    this.assertEqual(ast.columns.length, 2);
    this.assertEqual(ast.from.type, 'NodeType');
    this.assertEqual(ast.where.type, 'BinaryOperation');
    this.assertEqual(ast.where.operator, 'AND');
    this.assertEqual(ast.orderBy.length, 1);
    
    // Convert to filter
    const filter = convertASTToFilter(ast);
    this.assertEqual(filter.nodeType, 'nt:base');
    this.assertEqual(filter.pathPrefix, '/content');
    this.assertTrue(filter.propertyRestrictions.length >= 2);
    
    // Generate index
    const indexDef = convertFilterToLuceneIndex(filter);
    const indexKey = Object.keys(indexDef)[0];
    const index = indexDef[indexKey];
    
    this.assertEqual(index.type, 'lucene');
    this.assertEqual(index.includedPaths, ['/content']);
    this.assertEqual(index.queryPaths, ['/content']);
    this.assertTrue('nt:base' in index.indexRules);
});

// Test for custom error message when using option(index name)
runner.test('Should show custom error message for option(index name)', () => {
    const sql = 'select * from [nt:base] option(index name myIndex)';
    
    try {
        const lexer = new SQL2Lexer(sql);
        const parser = new SQL2Parser(lexer.tokens);
        parser.parseQuery();
        runner.assertEqual(false, true, 'Should have thrown an error');
    } catch (error) {
        const expectedMessage = 'option(index name ...) is not officially supported. It is used for development only. Use index tags instead, using "option(index tag ...).';
        runner.assertEqual(error.message, expectedMessage, 'Should show correct error message for option(index name)');
    }
});

// Test that option(index tag) still works
runner.test('Should still support option(index tag) correctly', () => {
    const sql = 'select * from [nt:base] option(index tag myTag)';
    
    try {
        const lexer = new SQL2Lexer(sql);
        const parser = new SQL2Parser(lexer.tokens);
        const ast = parser.parseQuery();
        const filter = convertASTToFilter(ast);
        
        runner.assertEqual(filter.indexTag, 'myTag', 'Should correctly parse index tag');
    } catch (error) {
        runner.assertEqual(false, true, 'Should not throw an error for valid option(index tag): ' + error.message);
    }
});

// Test contains function conversion to property restriction
runner.test('Should convert contains function to property restriction', () => {
    const sql = 'SELECT * FROM [nt:base] WHERE contains([jcr:content], \'test\')';
    
    try {
        const lexer = new SQL2Lexer(sql);
        const parser = new SQL2Parser(lexer.tokens);
        const ast = parser.parseQuery();
        const filter = convertASTToFilter(ast);
        
        runner.assertEqual(filter.isFulltextSearchable, true, 'Should set isFulltextSearchable to true');
        runner.assertEqual(filter.propertyRestrictions.length, 1, 'Should have one property restriction');
        
        const restriction = filter.propertyRestrictions[0];
        runner.assertEqual(restriction.propertyName, 'jcr:content', 'Should have correct property name');
        runner.assertEqual(restriction.operator, 'contains', 'Should have contains operator');
        runner.assertEqual(restriction.value, 'test', 'Should have correct search value');
        runner.assertEqual(restriction.propertyType, 'string', 'Should have string property type');
    } catch (error) {
        runner.assertEqual(false, true, 'Should not throw an error for contains function: ' + error.message);
    }
});

// Test contains operator creates analyzed property in index definition
runner.test('Should create analyzed property for contains operator in index definition', () => {
    const sql = 'SELECT * FROM [nt:base] WHERE contains([jcr:content], \'test\')';
    
    try {
        const lexer = new SQL2Lexer(sql);
        const parser = new SQL2Parser(lexer.tokens);
        const ast = parser.parseQuery();
        const filter = convertASTToFilter(ast);
        const indexDef = convertFilterToLuceneIndex(filter);
        
        const indexRoot = indexDef[Object.keys(indexDef)[0]];
        const contentProperty = indexRoot.indexRules['nt:base'].properties.content;
        
        runner.assertEqual(contentProperty.name, 'str:jcr:content', 'Should have correct property name');
        runner.assertEqual(contentProperty.analyzed, true, 'Should have analyzed=true for contains operator');
        runner.assertEqual(contentProperty.propertyIndex, undefined, 'Should not have propertyIndex for contains operator');
    } catch (error) {
        runner.assertEqual(false, true, 'Should not throw an error for contains index generation: ' + error.message);
    }
});

// Run the tests
if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment
    const success = runner.run();
    process.exit(success ? 0 : 1);
} else {
    // Browser environment
    runner.run();
} 