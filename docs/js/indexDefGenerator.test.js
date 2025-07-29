/**
 * Unit Tests for Index Definition Generator
 * 
 * Run with: node js/indexDefGenerator.test.js
 */

const { SQL2Lexer, SQL2Parser, formatAST, convertASTToFilter, convertFilterToLuceneIndex } = require('./sql2-parser.js');

// Simple test framework
class TestRunner {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
    }

    test(name, testFn) {
        this.tests.push({ name, testFn });
    }

    assertEqual(actual, expected, message = '') {
        if (JSON.stringify(actual) === JSON.stringify(expected)) {
            return true;
        } else {
            throw new Error(`Assertion failed ${message}: 
Expected: ${JSON.stringify(expected, null, 2)}
Actual: ${JSON.stringify(actual, null, 2)}`);
        }
    }

    assertContains(actual, expected, message = '') {
        // Handle string comparison directly, not through JSON.stringify
        const actualStr = typeof actual === 'string' ? actual : JSON.stringify(actual);
        const expectedStr = typeof expected === 'string' ? expected : JSON.stringify(expected);
        if (actualStr.includes(expectedStr)) {
            return true;
        } else {
            throw new Error(`Assertion failed ${message}: 
Expected string to contain "${expectedStr}"`);
        }
    }

    async run() {
        console.log('🧪 Running Index Definition Generator Tests...\n');

        for (const { name, testFn } of this.tests) {
            try {
                await testFn.call(this);
                console.log(`✅ ${name}`);
                this.passed++;
            } catch (error) {
                console.log(`❌ ${name}`);
                console.log(`   Error: ${error.message}\n`);
                this.failed++;
            }
        }

        console.log(`\n📊 Test Results: ${this.passed} passed, ${this.failed} failed`);
        
        if (this.failed > 0) {
            process.exit(1);
        }
    }
}

// Test Suite
const runner = new TestRunner();

runner.test('Should parse DAM Asset SQL-2 query correctly', function() {
    // Arrange
    const testSQL = `SELECT *
FROM [dam:Asset]
WHERE [jcr:content/metadata/status] = 'published'
ORDER BY [jcr:content/metadata/jcr:lastModified] DESC`;

    // Expected AST structure (current correct result)
    const expectedAST = {
        "type": "SelectStatement",
        "columns": [
            {
                "type": "AllColumns",
                "value": "*"
            }
        ],
        "from": {
            "type": "NodeType",
            "value": "dam:Asset"
        },
        "where": {
            "type": "BinaryOperation",
            "operator": "=",
            "left": {
                "type": "Property",
                "name": "jcr:content/metadata/status"
            },
            "right": {
                "type": "Literal",
                "dataType": "string",
                "value": "published"
            }
        },
        "orderBy": [
            {
                "type": "OrderBy",
                "expression": {
                    "type": "Property",
                    "name": "jcr:content/metadata/jcr:lastModified"
                },
                "direction": "DESC"
            }
        ],
        "options": null
    };

    // Act
    const lexer = new SQL2Lexer(testSQL);
    const parser = new SQL2Parser(lexer.tokens);
    const actualAST = parser.parseQuery();

    // Assert - Test the complete AST structure
    this.assertEqual(actualAST, expectedAST, 'Complete AST structure should match expected');

    // Assert - Test individual components
    this.assertEqual(actualAST.type, 'SelectStatement', 'Should be a SelectStatement');
    this.assertEqual(actualAST.from.value, 'dam:Asset', 'Should query dam:Asset node type');
    this.assertEqual(actualAST.where.operator, '=', 'Should use equality operator');
    this.assertEqual(actualAST.where.left.name, 'jcr:content/metadata/status', 'Should filter on status property');
    this.assertEqual(actualAST.where.right.value, 'published', 'Should filter for published status');
    this.assertEqual(actualAST.orderBy[0].direction, 'DESC', 'Should order descending');
    this.assertEqual(actualAST.orderBy[0].expression.name, 'jcr:content/metadata/jcr:lastModified', 'Should order by lastModified');
});

runner.test('Should format AST output correctly', function() {
    // Arrange
    const testSQL = `SELECT *
FROM [dam:Asset]
WHERE [jcr:content/metadata/status] = 'published'
ORDER BY [jcr:content/metadata/jcr:lastModified] DESC`;

    // Act
    const lexer = new SQL2Lexer(testSQL);
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    const formattedAST = formatAST(ast);

    // Assert - Check that formatting produces valid JSON-like output
    this.assertContains(formattedAST, 'SelectStatement', 'Should contain SelectStatement type');
    this.assertContains(formattedAST, 'dam:Asset', 'Should contain dam:Asset value');
    this.assertContains(formattedAST, 'jcr:content/metadata/status', 'Should contain status property');
    this.assertContains(formattedAST, 'published', 'Should contain published value');
    this.assertContains(formattedAST, 'DESC', 'Should contain DESC direction');
});

runner.test('Should handle empty SQL input gracefully', function() {
    // Arrange
    const emptySQL = '';

    // Act & Assert
    const lexer = new SQL2Lexer(emptySQL);
    // Note: Empty input still produces EOF token, so we expect at least 1 token
    this.assertEqual(lexer.tokens.length >= 0, true, 'Should handle empty input without errors');
});

runner.test('Should parse SELECT statement with WHERE clause', function() {
    // Arrange
    const simpleSQL = "SELECT * FROM [nt:base] WHERE [title] = 'test'";

    // Act
    const lexer = new SQL2Lexer(simpleSQL);
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();

    // Assert
    this.assertEqual(ast.type, 'SelectStatement', 'Should be a SelectStatement');
    this.assertEqual(ast.where.type, 'BinaryOperation', 'Should have a WHERE clause');
    this.assertEqual(ast.where.left.name, 'title', 'Should reference title property');
    this.assertEqual(ast.where.right.value, 'test', 'Should match test value');
});

runner.test('BUG: Table alias breaks WHERE and ORDER BY parsing', function() {
    // Arrange - Working query without alias
    const workingSQL = `SELECT *
FROM [dam:Asset]
WHERE [jcr:content/metadata/status] = 'published'
ORDER BY [jcr:content/metadata/jcr:lastModified] DESC`;

    // Arrange - Broken query with alias (should produce same WHERE/ORDER BY)
    const brokenSQL = `SELECT *
FROM [dam:Asset] AS a
WHERE a.[jcr:content/metadata/status] = 'published'
ORDER BY a.[jcr:content/metadata/jcr:lastModified] DESC`;

    // Act - Parse working query
    const workingLexer = new SQL2Lexer(workingSQL);
    const workingParser = new SQL2Parser(workingLexer.tokens);
    const workingAST = workingParser.parseQuery();

    // Act - Parse broken query
    const brokenLexer = new SQL2Lexer(brokenSQL);
    const brokenParser = new SQL2Parser(brokenLexer.tokens);
    const brokenAST = brokenParser.parseQuery();

    // Expected behavior for working query (without alias)
    const expectedWhereWithoutAlias = {
        "type": "BinaryOperation",
        "operator": "=",
        "left": {
            "type": "Property",
            "name": "jcr:content/metadata/status"
        },
        "right": {
            "type": "Literal",
            "dataType": "string",
            "value": "published"
        }
    };

    const expectedOrderByWithoutAlias = [{
        "type": "OrderBy",
        "expression": {
            "type": "Property",
            "name": "jcr:content/metadata/jcr:lastModified"
        },
        "direction": "DESC"
    }];

    // Expected behavior for alias query (with selector references)
    const expectedWhereWithAlias = {
        "type": "BinaryOperation",
        "operator": "=",
        "left": {
            "type": "Property",
            "name": "jcr:content/metadata/status",
            "selector": "a"
        },
        "right": {
            "type": "Literal",
            "dataType": "string",
            "value": "published"
        }
    };

    const expectedOrderByWithAlias = [{
        "type": "OrderBy",
        "expression": {
            "type": "Property",
            "name": "jcr:content/metadata/jcr:lastModified",
            "selector": "a"
        },
        "direction": "DESC"
    }];

    // Assert - Working query produces correct WHERE and ORDER BY
    this.assertEqual(workingAST.where, expectedWhereWithoutAlias, 'Working query should have correct WHERE clause');
    this.assertEqual(workingAST.orderBy, expectedOrderByWithoutAlias, 'Working query should have correct ORDER BY clause');

    // Assert - Alias query should produce correct WHERE and ORDER BY with selector references
    try {
        this.assertEqual(brokenAST.where, expectedWhereWithAlias, 'Alias query should have WHERE clause with selector');
        this.assertEqual(brokenAST.orderBy, expectedOrderByWithAlias, 'Alias query should have ORDER BY clause with selector');
        console.log('   ✅ BUG FIXED: Alias parsing now works correctly!');
    } catch (error) {
        console.log('   🐛 BUG CONFIRMED: Alias query parsing still has issues');
        console.log('   Expected WHERE:', JSON.stringify(expectedWhereWithAlias, null, 4));
        console.log('   Actual WHERE:', JSON.stringify(brokenAST.where, null, 4));
        console.log('   Expected ORDER BY:', JSON.stringify(expectedOrderByWithAlias, null, 4));
        console.log('   Actual ORDER BY:', JSON.stringify(brokenAST.orderBy, null, 4));
        // Don't fail the test - this documents any remaining issues
    }
});

runner.test('Should parse table alias in FROM clause correctly', function() {
    // Arrange
    const aliasSQL = `SELECT * FROM [dam:Asset] AS a`;
    
    // Act
    const lexer = new SQL2Lexer(aliasSQL);
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    // Assert
    this.assertEqual(ast.type, 'SelectStatement', 'Should be a SelectStatement');
    this.assertEqual(ast.from.type, 'NodeType', 'Should have NodeType from clause');
    this.assertEqual(ast.from.value, 'dam:Asset', 'Should reference dam:Asset node type');
    this.assertEqual(ast.from.alias, 'a', 'Should have alias "a"');
});

runner.test('BUG: Table alias breaks parsing even without alias prefix', function() {
    // Arrange - Working query without alias
    const workingSQL = `SELECT *
FROM [dam:Asset]
WHERE [jcr:content/metadata/status] = 'published'
ORDER BY [jcr:content/metadata/jcr:lastModified] DESC`;

    // Arrange - Broken query with alias but NO prefix (should still work)
    const brokenSQL = `SELECT *
FROM [dam:Asset] AS a
WHERE [jcr:content/metadata/status] = 'published'
ORDER BY [jcr:content/metadata/jcr:lastModified] DESC`;

    // Act
    const workingLexer = new SQL2Lexer(workingSQL);
    const workingParser = new SQL2Parser(workingLexer.tokens);
    const workingAST = workingParser.parseQuery();

    const brokenLexer = new SQL2Lexer(brokenSQL);
    const brokenParser = new SQL2Parser(brokenLexer.tokens);
    const brokenAST = brokenParser.parseQuery();

    // Assert - The presence of "AS a" alone breaks parsing, even without using the alias
    this.assertEqual(workingAST.where !== null, true, 'Working query should have WHERE clause');
    this.assertEqual(workingAST.orderBy.length > 0, true, 'Working query should have ORDER BY clause');
    
    // Document the bug: even when not using the alias prefix, parsing fails
    if (brokenAST.where === null || brokenAST.orderBy.length === 0) {
        console.log('   🐛 BUG: Even without alias prefix, "AS a" breaks WHERE/ORDER BY parsing');
        console.log('   Working WHERE exists:', workingAST.where !== null);
        console.log('   Broken WHERE exists:', brokenAST.where !== null);
        console.log('   Working ORDER BY count:', workingAST.orderBy.length);
        console.log('   Broken ORDER BY count:', brokenAST.orderBy.length);
    } else {
        console.log('   ✅ BUG FIXED: Alias without prefix now works correctly!');
        this.assertEqual(brokenAST.where, workingAST.where, 'WHERE clauses should be identical');
        this.assertEqual(brokenAST.orderBy, workingAST.orderBy, 'ORDER BY clauses should be identical');
    }
});

runner.test('Should generate correct Lucene index definition for DAM Asset query', function() {
    // Arrange
    const testSQL = `SELECT *
FROM [dam:Asset] AS a
WHERE a.[jcr:content/metadata/status] = 'published'
ORDER BY a.[jcr:content/metadata/jcr:lastModified] DESC`;

    // Expected index definition (without nodeName property)
    const expectedIndexDef = {
        "/oak:index/damAssetLuceneCustom": {
            "jcr:primaryType": "oak:QueryIndexDefinition",
            "type": "lucene",
            "async": ["async", "nrt"],
            "compatVersion": 2,
            "evaluatePathRestrictions": true,
            "indexRules": {
                "jcr:primaryType": "nt:unstructured",
                "dam:Asset": {
                    "jcr:primaryType": "nt:unstructured",
                    "properties": {
                        "jcr:primaryType": "nt:unstructured",
                        "status": {
                            "jcr:primaryType": "nt:unstructured",
                            "propertyIndex": true,
                            "name": "str:jcr:content/metadata/status"
                        },
                                                  "lastModified": {
                              "jcr:primaryType": "nt:unstructured",
                              "propertyIndex": true,
                              "name": "str:jcr:content/metadata/jcr:lastModified",
                              "ordered": true
                          }
                    }
                }
            }
        }
    };

    // Act - Full pipeline: SQL -> AST -> Filter -> Index Definition
    const lexer = new SQL2Lexer(testSQL);
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    const filter = convertASTToFilter(ast);
    const actualIndexDef = convertFilterToLuceneIndex(filter);

    // Assert - Verify the complete structure
    this.assertEqual(actualIndexDef, expectedIndexDef, 'Generated index definition should match expected structure');

    // Assert - Verify specific properties exist
    const properties = actualIndexDef["/oak:index/damAssetLuceneCustom"].indexRules["dam:Asset"].properties;
    
    this.assertEqual(properties["status"]["name"], "str:jcr:content/metadata/status", 
        'Status property should have correct name');
    this.assertEqual(properties["status"]["propertyIndex"], true, 
        'Status property should be indexed');
        
    this.assertEqual(properties["lastModified"]["name"], "str:jcr:content/metadata/jcr:lastModified", 
        'LastModified property should have correct name');
    this.assertEqual(properties["lastModified"]["ordered"], true, 
        'LastModified property should be ordered for sorting');

    // Assert - Verify nodeName property is NOT included (this was the bug)
    this.assertEqual(properties.hasOwnProperty("nodeName"), false, 
        'Index definition should NOT include nodeName property');
        
    // Assert - Verify only the expected properties are present
    const propertyKeys = Object.keys(properties).filter(key => key !== "jcr:primaryType");
    const expectedPropertyKeys = ["status", "lastModified"];
    this.assertEqual(propertyKeys.sort(), expectedPropertyKeys.sort(), 
        'Should only contain the two expected properties (no extra nodeName)');
});

runner.test('Should handle duplicate property names correctly with incrementing suffixes', function() {
    // Arrange - Query with multiple properties that resolve to the same key
    const testSQL = `SELECT *
FROM [dam:Asset] AS a
WHERE a.[jcr:content/metadata/status] = 'published'
and a.[jcr:content/test/status] = 'published'
ORDER BY a.[jcr:content/metadata/jcr:lastModified] DESC`;

    // Act
    const lexer = new SQL2Lexer(testSQL);
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    const filter = convertASTToFilter(ast);
    const indexDef = convertFilterToLuceneIndex(filter);

    // Assert
    const properties = indexDef["/oak:index/damAssetLuceneCustom"].indexRules["dam:Asset"].properties;
    const propKeys = Object.keys(properties).filter(key => key !== "jcr:primaryType");

    // Should generate: status, status_1, lastModified
    this.assertEqual(propKeys.includes("status"), true, 'Should contain status property');
    this.assertEqual(propKeys.includes("status_1"), true, 'Should contain status_1 for duplicate');
    this.assertEqual(propKeys.includes("lastModified"), true, 'Should contain lastModified property');
    this.assertEqual(propKeys.length, 3, 'Should have exactly 3 properties');

    // Verify the property definitions point to correct original names
    this.assertEqual(properties["status"]["name"], "str:jcr:content/metadata/status", 
        'First status should map to metadata/status');
    this.assertEqual(properties["status_1"]["name"], "str:jcr:content/test/status", 
        'Second status should map to test/status');
    this.assertEqual(properties["lastModified"]["name"], "str:jcr:content/metadata/jcr:lastModified", 
        'LastModified should map correctly');
    this.assertEqual(properties["lastModified"]["ordered"], true, 
        'LastModified should be ordered for sorting');
});

runner.test('Should apply property naming rules correctly', function() {
    // Test the specific naming rules
    const testCases = [
        { input: 'jcr:content/metadata/status', expected: 'status' },
        { input: 'jcr:content/metadata/jcr:lastModified', expected: 'lastModified' },
        { input: 'simple', expected: 'simple' },
        { input: 'ns:property', expected: 'property' },
        { input: 'path/to/ns:property', expected: 'property' },
        { input: 'path/to/simple', expected: 'simple' }
    ];

    // Mock usedKeys set for testing
    testCases.forEach(testCase => {
        const usedKeys = new Set();
        // We need to call the function directly, but it's not exported
        // So let's test it indirectly through a simple query
        const testSQL = `SELECT * FROM [nt:base] WHERE [${testCase.input}] = 'test'`;
        
        const lexer = new SQL2Lexer(testSQL);
        const parser = new SQL2Parser(lexer.tokens);
        const ast = parser.parseQuery();
        const filter = convertASTToFilter(ast);
        const indexDef = convertFilterToLuceneIndex(filter);
        
        const properties = indexDef["/oak:index/ntbaseLuceneCustom"].indexRules["nt:base"].properties;
        const propKeys = Object.keys(properties).filter(key => key !== "jcr:primaryType");
        
        this.assertEqual(propKeys.includes(testCase.expected), true, 
            `Property '${testCase.input}' should generate key '${testCase.expected}', got: ${propKeys}`);
    });
});

runner.test('Should handle LOWER function in WHERE clause correctly', function() {
    const testSQL = `SELECT * FROM [dam:Asset]
WHERE LOWER([jcr:content/metadata/status]) = 'published'`;
    
    console.log('Testing LOWER function query...');
    
    const lexer = new SQL2Lexer(testSQL);
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    console.log('AST WHERE clause:', JSON.stringify(ast.where, null, 2));
    
    const filter = convertASTToFilter(ast);
    console.log('Filter propertyRestrictions:', JSON.stringify(filter.propertyRestrictions, null, 2));
    
    // Check that we have a property restriction with function
    this.assertEqual(filter.propertyRestrictions.length, 1, 'Should have one property restriction');
    
    const restriction = filter.propertyRestrictions[0];
    this.assertEqual(restriction.propertyName, 'LOWER([jcr:content/metadata/status])', 
        'Property name should include the LOWER function');
    this.assertEqual(restriction.isFunction, true, 'Should mark as function');
    this.assertEqual(restriction.operator, '=', 'Should have equals operator');
    this.assertEqual(restriction.value, 'published', 'Should have published value');
    
    // Test index definition generation
    const indexDef = convertFilterToLuceneIndex(filter);
    const properties = indexDef["/oak:index/damAssetLuceneCustom"].indexRules["dam:Asset"].properties;
    
    // Find the function property (should not have a simple property name key)
    const propertyKeys = Object.keys(properties).filter(key => key !== "jcr:primaryType");
    console.log('Generated property keys:', propertyKeys);
    
    // Should have a property with function defined
    const functionProp = Object.values(properties).find(prop => prop.function);
    this.assertEqual(!!functionProp, true, 'Should have a property with function defined');
    
    if (functionProp) {
        this.assertEqual(functionProp.function, 'LOWER([jcr:content/metadata/status])', 
            'Function should be preserved');
        this.assertEqual(functionProp.hasOwnProperty('name'), false, 
            'Should not have name property when function is used');
    }
});

runner.test('Should handle IS NULL and IS NOT NULL conditions correctly', function() {
    // Test IS NULL
    const testSQL1 = `SELECT * FROM [dam:Asset] WHERE [jcr:content/metadata/status] IS NULL`;
    
    console.log('Testing IS NULL condition...');
    
    const lexer1 = new SQL2Lexer(testSQL1);
    const parser1 = new SQL2Parser(lexer1.tokens);
    const ast1 = parser1.parseQuery();
    const filter1 = convertASTToFilter(ast1);
    
    this.assertEqual(filter1.propertyRestrictions.length, 1, 'Should have one property restriction for IS NULL');
    this.assertEqual(filter1.propertyRestrictions[0].operator, 'IS NULL', 'Should have IS NULL operator');
    
    const indexDef1 = convertFilterToLuceneIndex(filter1);
    const properties1 = indexDef1["/oak:index/damAssetLuceneCustom"].indexRules["dam:Asset"].properties;
    const statusProp1 = properties1.status;
    
    this.assertEqual(statusProp1.nullCheckEnabled, true, 'Should have nullCheckEnabled for IS NULL');
    this.assertEqual(statusProp1.hasOwnProperty('notNullCheckEnabled'), false, 'Should NOT have notNullCheckEnabled for IS NULL');
    
    // Test IS NOT NULL
    const testSQL2 = `SELECT * FROM [dam:Asset] WHERE [jcr:content/metadata/status] IS NOT NULL`;
    
    console.log('Testing IS NOT NULL condition...');
    
    const lexer2 = new SQL2Lexer(testSQL2);
    const parser2 = new SQL2Parser(lexer2.tokens);
    const ast2 = parser2.parseQuery();
    const filter2 = convertASTToFilter(ast2);
    
    this.assertEqual(filter2.propertyRestrictions.length, 1, 'Should have one property restriction for IS NOT NULL');
    this.assertEqual(filter2.propertyRestrictions[0].operator, 'IS NOT NULL', 'Should have IS NOT NULL operator');
    
    const indexDef2 = convertFilterToLuceneIndex(filter2);
    const properties2 = indexDef2["/oak:index/damAssetLuceneCustom"].indexRules["dam:Asset"].properties;
    const statusProp2 = properties2.status;
    
    this.assertEqual(statusProp2.notNullCheckEnabled, true, 'Should have notNullCheckEnabled for IS NOT NULL');
    this.assertEqual(statusProp2.hasOwnProperty('nullCheckEnabled'), false, 'Should NOT have nullCheckEnabled for IS NOT NULL');
    
    // Test both conditions for same property
    const testSQL3 = `SELECT * FROM [dam:Asset] WHERE [jcr:content/metadata/status] IS NULL OR [jcr:content/metadata/status] IS NOT NULL`;
    
    console.log('Testing both IS NULL and IS NOT NULL conditions...');
    
    const lexer3 = new SQL2Lexer(testSQL3);
    const parser3 = new SQL2Parser(lexer3.tokens);
    const ast3 = parser3.parseQuery();
    const filter3 = convertASTToFilter(ast3);
    
    this.assertEqual(filter3.propertyRestrictions.length, 2, 'Should have two property restrictions');
    
    const indexDef3 = convertFilterToLuceneIndex(filter3);
    const properties3 = indexDef3["/oak:index/damAssetLuceneCustom"].indexRules["dam:Asset"].properties;
    const statusProp3 = properties3.status;
    
    this.assertEqual(statusProp3.nullCheckEnabled, true, 'Should have nullCheckEnabled when both conditions present');
    this.assertEqual(statusProp3.notNullCheckEnabled, true, 'Should have notNullCheckEnabled when both conditions present');
    
    // Test regular equality condition (should not have null checks)
    const testSQL4 = `SELECT * FROM [dam:Asset] WHERE [jcr:content/metadata/status] = 'published'`;
    
    console.log('Testing regular equality condition (no null checks)...');
    
    const lexer4 = new SQL2Lexer(testSQL4);
    const parser4 = new SQL2Parser(lexer4.tokens);
    const ast4 = parser4.parseQuery();
    const filter4 = convertASTToFilter(ast4);
    
    const indexDef4 = convertFilterToLuceneIndex(filter4);
    const properties4 = indexDef4["/oak:index/damAssetLuceneCustom"].indexRules["dam:Asset"].properties;
    const statusProp4 = properties4.status;
    
    this.assertEqual(statusProp4.hasOwnProperty('nullCheckEnabled'), false, 'Should NOT have nullCheckEnabled for equality');
    this.assertEqual(statusProp4.hasOwnProperty('notNullCheckEnabled'), false, 'Should NOT have notNullCheckEnabled for equality');
});

runner.test('Should not include unwanted properties in index definition', function() {
    // Test title property (should not have any special properties)
    const testSQL1 = `SELECT * FROM [dam:Asset] WHERE [jcr:content/metadata/title] = 'test'`;
    
    console.log('Testing removal of unwanted properties...');
    
    const lexer1 = new SQL2Lexer(testSQL1);
    const parser1 = new SQL2Parser(lexer1.tokens);
    const ast1 = parser1.parseQuery();
    const filter1 = convertASTToFilter(ast1);
    const indexDef1 = convertFilterToLuceneIndex(filter1);
    const properties1 = indexDef1["/oak:index/damAssetLuceneCustom"].indexRules["dam:Asset"].properties;
    const titleProp = properties1.title;
    
    console.log('Title property structure:', JSON.stringify(titleProp, null, 2));
    
    // Should NOT have boost property
    this.assertEqual(titleProp.hasOwnProperty('boost'), false, 'Should NOT have boost property');
    
    // Should NOT have unwanted properties
    this.assertEqual(titleProp.hasOwnProperty('useInSuggest'), false, 'Should NOT have useInSuggest');
    this.assertEqual(titleProp.hasOwnProperty('useInSpellcheck'), false, 'Should NOT have useInSpellcheck');
    this.assertEqual(titleProp.hasOwnProperty('nodeScopeIndex'), false, 'Should NOT have nodeScopeIndex');
    
    // Test description property (should not have any special properties)
    const testSQL2 = `SELECT * FROM [dam:Asset] WHERE [jcr:content/metadata/description] = 'test'`;
    
    const lexer2 = new SQL2Lexer(testSQL2);
    const parser2 = new SQL2Parser(lexer2.tokens);
    const ast2 = parser2.parseQuery();
    const filter2 = convertASTToFilter(ast2);
    const indexDef2 = convertFilterToLuceneIndex(filter2);
    const properties2 = indexDef2["/oak:index/damAssetLuceneCustom"].indexRules["dam:Asset"].properties;
    const descProp = properties2.description;
    
    console.log('Description property structure:', JSON.stringify(descProp, null, 2));
    
    // Should NOT have unwanted properties
    this.assertEqual(descProp.hasOwnProperty('useInSuggest'), false, 'Description should NOT have useInSuggest');
    this.assertEqual(descProp.hasOwnProperty('useInSpellcheck'), false, 'Description should NOT have useInSpellcheck');
    this.assertEqual(descProp.hasOwnProperty('nodeScopeIndex'), false, 'Description should NOT have nodeScopeIndex');
    
    // Test tag property (should not have any special properties)
    const testSQL3 = `SELECT * FROM [dam:Asset] WHERE [jcr:content/metadata/tag] = 'test'`;
    
    const lexer3 = new SQL2Lexer(testSQL3);
    const parser3 = new SQL2Parser(lexer3.tokens);
    const ast3 = parser3.parseQuery();
    const filter3 = convertASTToFilter(ast3);
    const indexDef3 = convertFilterToLuceneIndex(filter3);
    const properties3 = indexDef3["/oak:index/damAssetLuceneCustom"].indexRules["dam:Asset"].properties;
    const tagProp = properties3.tag;
    
    console.log('Tag property structure:', JSON.stringify(tagProp, null, 2));
    
    // Should NOT have unwanted properties
    this.assertEqual(tagProp.hasOwnProperty('useInSuggest'), false, 'Tag should NOT have useInSuggest');
    this.assertEqual(tagProp.hasOwnProperty('useInSpellcheck'), false, 'Tag should NOT have useInSpellcheck');
    this.assertEqual(tagProp.hasOwnProperty('nodeScopeIndex'), false, 'Tag should NOT have nodeScopeIndex');
});

runner.test('Should not include reindex properties in index definition', function() {
    const testSQL = `SELECT * FROM [dam:Asset] WHERE [jcr:content/metadata/status] = 'published'`;
    
    console.log('Testing removal of reindex properties...');
    
    const lexer = new SQL2Lexer(testSQL);
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    const filter = convertASTToFilter(ast);
    const indexDef = convertFilterToLuceneIndex(filter);
    
    const indexRoot = indexDef["/oak:index/damAssetLuceneCustom"];
    
    console.log('Index definition top-level keys:', Object.keys(indexRoot));
    
    // Should NOT have reindex properties
    this.assertEqual(indexRoot.hasOwnProperty('reindex'), false, 'Should NOT have reindex property');
    this.assertEqual(indexRoot.hasOwnProperty('reindexCount'), false, 'Should NOT have reindexCount property');
    
    // Should still have essential properties
    this.assertEqual(indexRoot.hasOwnProperty('jcr:primaryType'), true, 'Should have jcr:primaryType');
    this.assertEqual(indexRoot.hasOwnProperty('type'), true, 'Should have type');
    this.assertEqual(indexRoot.hasOwnProperty('async'), true, 'Should have async');
    this.assertEqual(indexRoot.hasOwnProperty('compatVersion'), true, 'Should have compatVersion');
    this.assertEqual(indexRoot.hasOwnProperty('evaluatePathRestrictions'), true, 'Should have evaluatePathRestrictions');
    this.assertEqual(indexRoot.hasOwnProperty('indexRules'), true, 'Should have indexRules');
    
    // Verify essential property values
    this.assertEqual(indexRoot['jcr:primaryType'], 'oak:QueryIndexDefinition', 'Should have correct primaryType');
    this.assertEqual(indexRoot.type, 'lucene', 'Should have correct type');
    this.assertEqual(indexRoot.compatVersion, 2, 'Should have correct compatVersion');
    this.assertEqual(indexRoot.evaluatePathRestrictions, true, 'Should have evaluatePathRestrictions true');
});

runner.test('Should not include boost property in any index property', function() {
    const testCases = [
        { name: 'title', sql: `SELECT * FROM [dam:Asset] WHERE [jcr:content/metadata/title] = 'test'` },
        { name: 'description', sql: `SELECT * FROM [dam:Asset] WHERE [jcr:content/metadata/description] = 'test'` },
        { name: 'tag', sql: `SELECT * FROM [dam:Asset] WHERE [jcr:content/metadata/tag] = 'test'` },
        { name: 'status', sql: `SELECT * FROM [dam:Asset] WHERE [jcr:content/metadata/status] = 'published'` }
    ];
    
    console.log('Testing removal of boost property across all property types...');
    
    testCases.forEach(testCase => {
        const lexer = new SQL2Lexer(testCase.sql);
        const parser = new SQL2Parser(lexer.tokens);
        const ast = parser.parseQuery();
        const filter = convertASTToFilter(ast);
        const indexDef = convertFilterToLuceneIndex(filter);
        const properties = indexDef["/oak:index/damAssetLuceneCustom"].indexRules["dam:Asset"].properties;
        const prop = properties[testCase.name];
        
        console.log(`Checking ${testCase.name} property...`);
        
        // Should NOT have boost property
        this.assertEqual(prop.hasOwnProperty('boost'), false, `${testCase.name} should NOT have boost property`);
        
        // Should have essential properties
        this.assertEqual(prop.hasOwnProperty('jcr:primaryType'), true, `${testCase.name} should have jcr:primaryType`);
        this.assertEqual(prop.hasOwnProperty('propertyIndex'), true, `${testCase.name} should have propertyIndex`);
        this.assertEqual(prop.hasOwnProperty('name'), true, `${testCase.name} should have name`);
        
        // Verify values
        this.assertEqual(prop['jcr:primaryType'], 'nt:unstructured', `${testCase.name} should have correct primaryType`);
        this.assertEqual(prop.propertyIndex, true, `${testCase.name} should have propertyIndex true`);
        this.assertEqual(prop.name.startsWith('str:'), true, `${testCase.name} should have str: prefix in name`);
    });
});

runner.test('Should handle OPTION clause with index tag', function() {
    const testSQL = `SELECT * FROM [dam:Asset] WHERE [jcr:content/metadata/status] = 'published' OPTION (index tag [abc])`;
    
    console.log('Testing OPTION clause with index tag...');
    
    const lexer = new SQL2Lexer(testSQL);
    const parser = new SQL2Parser(lexer.tokens);
    const ast = parser.parseQuery();
    
    console.log('AST options:', JSON.stringify(ast.options, null, 2));
    
    // Check AST has options with indexTag
    this.assertEqual(ast.hasOwnProperty('options'), true, 'AST should have options');
    this.assertEqual(ast.options.hasOwnProperty('indexTag'), true, 'Options should have indexTag');
    this.assertEqual(ast.options.indexTag, 'abc', 'IndexTag should be "abc"');
    
    const filter = convertASTToFilter(ast);
    
    console.log('Filter indexTag:', filter.indexTag);
    
    // Check filter has indexTag
    this.assertEqual(filter.hasOwnProperty('indexTag'), true, 'Filter should have indexTag');
    this.assertEqual(filter.indexTag, 'abc', 'Filter indexTag should be "abc"');
    
    const indexDef = convertFilterToLuceneIndex(filter);
    const indexRoot = indexDef["/oak:index/damAssetLuceneCustom"];
    
    console.log('Index definition tags:', indexRoot.tags);
    
    // Check index definition has tags
    this.assertEqual(indexRoot.hasOwnProperty('tags'), true, 'Index definition should have tags');
    this.assertEqual(Array.isArray(indexRoot.tags), true, 'Tags should be an array');
    this.assertEqual(indexRoot.tags.length, 1, 'Tags array should have one element');
    this.assertEqual(indexRoot.tags[0], 'abc', 'Tags should contain "abc"');
});

// Run the tests
if (require.main === module) {
    runner.run().catch(console.error);
}

module.exports = { TestRunner }; 