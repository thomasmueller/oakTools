// Unit Tests for XPath to SQL-2 Converter
// Run with: node xpath-converter.test.js

// Import the converter functions
const {
    convertXPathToSQL2,
    XPathParser,
    convertCondition,
    buildSQL2Query
} = require('./xpath-converter.js');

// Simple test framework
class TestRunner {
    constructor() {
        this.passed = 0;
        this.failed = 0;
        this.tests = [];
    }

    test(name, testFunction) {
        this.tests.push({ name, testFunction });
    }

    assert(condition, message) {
        if (!condition) {
            throw new Error(message || 'Assertion failed');
        }
    }

    assertEqual(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(message || `Expected: ${expected}, Got: ${actual}`);
        }
    }

    run() {
        console.log('XPath to SQL-2 Converter Unit Tests');
        console.log('=====================================\n');

        for (const test of this.tests) {
            try {
                test.testFunction();
                console.log(`✅ PASS: ${test.name}`);
                this.passed++;
            } catch (error) {
                console.log(`❌ FAIL: ${test.name}`);
                console.log(`   ${error.message}\n`);
                this.failed++;
            }
        }

        console.log('\n=====================================');
        console.log(`Test Results: ${this.passed} passed, ${this.failed} failed`);
        
        if (this.failed > 0) {
            process.exit(1);
        }
    }
}

// Create test runner instance
const runner = new TestRunner();

// Unit Tests for convertCondition function
runner.test('convertCondition - fn:path() conversion', () => {
    const result = convertCondition('fn:path()');
    runner.assertEqual(result, 'path(a)', 'Should convert fn:path() to path(a)');
});

runner.test('convertCondition - jcr:first(@property) conversion', () => {
    const result = convertCondition('jcr:first(@vanityPath)');
    runner.assertEqual(result, 'first([vanityPath])', 'Should convert jcr:first(@property) to first([property])');
});

runner.test('convertCondition - @property conversion', () => {
    const result = convertCondition('@title = "test"');
    runner.assertEqual(result, '[title] = "test"', 'Should convert @property to [property]');
});

runner.test('convertCondition - $variable conversion', () => {
    const result = convertCondition('$lastValue');
    runner.assertEqual(result, '@lastValue', 'Should convert $variable to @variable');
});

runner.test('convertCondition - @jcr:path conversion', () => {
    const result = convertCondition('@jcr:path = "/content"');
    runner.assertEqual(result, '[jcr:path] = "/content"', 'Should convert @jcr:path to [jcr:path]');
});

runner.test('convertCondition - complex expression', () => {
    const result = convertCondition('jcr:first(@vanityPath) >= $lastValue');
    runner.assertEqual(result, 'first([vanityPath]) >= @lastValue', 'Should handle complex expressions');
});

// Unit Tests for XPathParser class
runner.test('XPathParser - basic descendant path', () => {
    const parser = new XPathParser('/jcr:root/content//element(*, nt:base)');
    const result = parser.parse();
    runner.assertEqual(result.path, '/content', 'Should extract path correctly');
    runner.assertEqual(result.isDescendant, true, 'Should detect descendant relationship');
    runner.assertEqual(result.nodeType, 'nt:base', 'Should extract node type');
});

runner.test('XPathParser - condition parsing', () => {
    const parser = new XPathParser('//*[@title="test"]');
    const result = parser.parse();
    runner.assertEqual(result.conditions.length, 1, 'Should parse one condition');
    runner.assertEqual(result.conditions[0], '@title="test"', 'Should extract condition correctly');
});

runner.test('XPathParser - order by parsing', () => {
    const parser = new XPathParser('//* order by fn:path()');
    const result = parser.parse();
    runner.assertEqual(result.orderBy.length, 1, 'Should parse order by clause');
    runner.assertEqual(result.orderBy[0], 'path(a)', 'Should convert order by expression');
});

runner.test('XPathParser - order by with descending', () => {
    const parser = new XPathParser('//* order by @prop descending');
    const result = parser.parse();
    runner.assertEqual(result.orderBy.length, 1, 'Should parse order by clause');
    runner.assertEqual(result.orderBy[0], '[prop] desc', 'Should convert descending to desc');
});

runner.test('XPathParser - order by with ascending', () => {
    const parser = new XPathParser('//* order by @prop ascending');
    const result = parser.parse();
    runner.assertEqual(result.orderBy.length, 1, 'Should parse order by clause');
    runner.assertEqual(result.orderBy[0], '[prop] asc', 'Should convert ascending to asc');
});

// Integration Tests for convertXPathToSQL2 function
runner.test('Full conversion - basic descendant with condition and order', () => {
    const input = '/jcr:root/content//element(*, nt:base)[fn:path() >= $lastValue] order by fn:path()';
    const expected = `select [jcr:path], [jcr:score], *
  from [nt:base] as a
  where path(a) >= @lastValue
  and isdescendantnode(a, '/content')
  order by path(a)`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should convert complete XPath query correctly');
});

runner.test('Full conversion - jcr:first function with multiple order by', () => {
    const input = '/jcr:root/content//element(*, nt:base)[jcr:first(@vanityPath) >= $lastValue] order by jcr:first(@vanityPath), @jcr:path';
    const expected = `select [jcr:path], [jcr:score], *
  from [nt:base] as a
  where first([vanityPath]) >= @lastValue
  and isdescendantnode(a, '/content')
  order by first([vanityPath]), [jcr:path]`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle jcr:first and multiple order by');
});

runner.test('Full conversion - rep:excerpt function', () => {
    const input = '//*[@a=\'b\']/(rep:excerpt(@a) | rep:excerpt(@b) | rep:excerpt(@c))';
    const expected = `select [jcr:path], [jcr:score], [rep:excerpt(a)], [rep:excerpt(b)], [rep:excerpt(c)]
  from [nt:base] as a
  where [a] = 'b'`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle rep:excerpt functions');
});

runner.test('Full conversion - simple property condition', () => {
    const input = '//*[@title="test"]';
    const expected = `select [jcr:path], [jcr:score], *
  from [nt:base] as a
  where [title] = "test"`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle simple property conditions');
});

runner.test('Full conversion - explain prefix', () => {
    const input = 'explain //*[@status="active"]';
    const expected = `explain select [jcr:path], [jcr:score], *
  from [nt:base] as a
  where [status] = "active"`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle explain prefix');
});

runner.test('Full conversion - measure prefix', () => {
    const input = 'measure //*[@type="document"]';
    const expected = `measure select [jcr:path], [jcr:score], *
  from [nt:base] as a
  where [type] = "document"`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle measure prefix');
});

runner.test('Full conversion - empty query handling', () => {
    const result = convertXPathToSQL2('');
    runner.assert(result.includes('select [jcr:path], [jcr:score], *'), 'Should handle empty query');
});

// Edge Cases
runner.test('Edge case - descendant at root', () => {
    const input = '//*[@prop="value"]';
    const result = convertXPathToSQL2(input);
    runner.assert(result.includes('where [prop] = "value"'), 'Should handle descendant at root');
});

runner.test('Edge case - child node relationship', () => {
    const input = '/jcr:root/content/page[@title="test"]';
    const result = convertXPathToSQL2(input);
    runner.assert(!result.includes('isdescendantnode'), 'Should not use descendant for direct child');
});

// Additional test cases from Apache Jackrabbit Oak xpath.txt
runner.test('Oak test - lastModified with order by', () => {
    const input = '/jcr:root/content//element(*, nt:base)[@jcr:lastModified >= $lastModified] order by @jcr:lastModified, @jcr:path';
    const expected = `select [jcr:path], [jcr:score], *
  from [nt:base] as a
  where [jcr:lastModified] >= @lastModified
  and isdescendantnode(a, '/content')
  order by [jcr:lastModified], [jcr:path]`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle lastModified queries');
});

runner.test('Oak test - contains with rep:excerpt', () => {
    const input = '/jcr:root//element(*, nt:base)[jcr:contains(., \'hello\')]/rep:excerpt()';
    const expected = `select [jcr:path], [jcr:score], [rep:excerpt]
  from [nt:base] as a
  where contains(*, 'hello')
  and isdescendantnode(a, '/')`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle contains with rep:excerpt');
});

runner.test('Oak test - rep:excerpt with property', () => {
    const input = '/jcr:root//element(*, nt:base)[jcr:contains(., \'hello\')]/rep:excerpt(@jcr:title)';
    const expected = `select [jcr:path], [jcr:score], [rep:excerpt(jcr:title)]
  from [nt:base] as a
  where contains(*, 'hello')
  and isdescendantnode(a, '/')`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle rep:excerpt with property');
});

runner.test('Oak test - simple property equality', () => {
    const input = '//element(*, my:type)[@my:title = \'JSR 170\']';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  where [my:title] = 'JSR 170'`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle simple property equality');
});

runner.test('Oak test - jcr:like function', () => {
    const input = '//element(*, my:type)[jcr:like(@title,\'%Java%\')]';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  where [title] like '%Java%'`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle jcr:like function');
});

runner.test('Oak test - jcr:contains function', () => {
    const input = '//element(*, my:type)[jcr:contains(., \'JSR 170\')]';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  where contains(*, 'JSR 170')`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle jcr:contains function');
});

runner.test('Oak test - property existence check', () => {
    const input = '//element(*, my:type)[@my:title]';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  where [my:title] is not null`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle property existence check');
});

runner.test('Oak test - property non-existence check', () => {
    const input = '//element(*, my:type)[not(@my:title)]';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  where [my:title] is null`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle property non-existence check');
});

runner.test('Oak test - numeric comparison negative', () => {
    const input = '//element(*, my:type)[@my:value < -1.0]';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  where [my:value] < -1.0`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle negative numeric comparison');
});

runner.test('Oak test - numeric comparison positive large', () => {
    const input = '//element(*, my:type)[@my:value > +10123123123]';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  where [my:value] > +10123123123`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle large positive numeric comparison');
});

runner.test('Oak test - scientific notation', () => {
    const input = '//element(*, my:type)[@my:value <= 10.3e-3]';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  where [my:value] <= 10.3e-3`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle scientific notation');
});

runner.test('Oak test - string with escaped quotes', () => {
    const input = '//element(*, my:type)[@my:value <> \'Joe\'\'s Caffee\']';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  where [my:value] <> 'Joe''s Caffee'`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle escaped quotes in strings');
});

runner.test('Oak test - complex boolean AND condition', () => {
    const input = '//element(*, my:type)[(not(@my:title) and @my:subject)]';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  where [my:title] is null and [my:subject] is not null`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle complex boolean AND conditions');
});

runner.test('Oak test - order by single property', () => {
    const input = '//element(*, my:type) order by @jcr:lastModified';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  order by [jcr:lastModified]`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle single property order by');
});

runner.test('Oak test - order by multiple properties with direction', () => {
    const input = '//element(*, my:type) order by @my:date descending, @my:title ascending';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  order by [my:date] desc, [my:title] asc`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle multiple properties with direction in order by');
});

runner.test('Oak test - descendant nodes path', () => {
    const input = '/jcr:root/nodes//element(*, my:type)';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  where isdescendantnode(a, '/nodes')`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle descendant nodes path');
});

runner.test('Oak test - specific element by name', () => {
    const input = '/jcr:root/some/element(nodes, my:type)';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  where issamenode(a, '/some/nodes')`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle specific element by name');
});

runner.test('Oak test - child nodes path', () => {
    const input = '/jcr:root/some/nodes/element(*, my:type)';
    const expected = `select [jcr:path], [jcr:score], *
  from [my:type] as a
  where ischildnode(a, '/some/nodes')`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle child nodes path');
});

// Test for property selection
runner.test('Oak test - property selection', () => {
    const input = '//element(*, my:type)/@my:title';
    const expected = `select [jcr:path], [jcr:score], [my:title]
  from [my:type] as a`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle property selection');
});

runner.test('Oak test - multiple property selection', () => {
    const input = '//element(*, my:type)/(@my:title | @my:text)';
    const expected = `select [jcr:path], [jcr:score], [my:title], [my:text]
  from [my:type] as a`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle multiple property selection');
});

runner.test('XPath OPTION clause - index tag with brackets', () => {
    const input = '/jcr:root/content//element(*, cq:Page)[@jcr:title="test"] option(index tag [myTag])';
    const expected = `select [jcr:path], [jcr:score], *
  from [cq:Page] as a
  where [jcr:title] = "test"
  and isdescendantnode(a, '/content')
  option (index tag [myTag])`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle OPTION clause with bracketed tag');
});

runner.test('XPath OPTION clause - index tag without brackets', () => {
    const input = '/jcr:root/content//element(*, cq:Page)[@jcr:title="test"] option(index tag myTag)';
    const expected = `select [jcr:path], [jcr:score], *
  from [cq:Page] as a
  where [jcr:title] = "test"
  and isdescendantnode(a, '/content')
  option (index tag [myTag])`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle OPTION clause with unbracketed tag');
});

runner.test('XPath OPTION clause - with order by', () => {
    const input = '/jcr:root/content//element(*, cq:Page)[@jcr:title="test"] order by @jcr:created option(index tag [testTag])';
    const expected = `select [jcr:path], [jcr:score], *
  from [cq:Page] as a
  where [jcr:title] = "test"
  and isdescendantnode(a, '/content')
  order by [jcr:created]
  option (index tag [testTag])`;
    
    const result = convertXPathToSQL2(input);
    runner.assertEqual(result.trim(), expected.trim(), 'Should handle OPTION clause with ORDER BY');
});

runner.test('XPathParser - option parsing', () => {
    const parser = new XPathParser('//*[@title="test"] option(index tag [abc])');
    const result = parser.parse();
    
    runner.assert(result.options !== null, 'Should parse options');
    runner.assertEqual(result.options.indexTag, 'abc', 'Should extract index tag');
});

// Run all tests
runner.run(); 