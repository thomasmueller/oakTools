// Unit Tests for XPath to SQL-2 Converter (xpath2.js)
// Run with: node xpath2.test.js

// Import the converter functions
const {
    convertXPathToSQL2,
    XPathToSQL2Converter
} = require('./xpath2.js');

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

    assertContains(actual, expected, message) {
        if (typeof actual === 'string' && typeof expected === 'string') {
            if (!actual.includes(expected)) {
                throw new Error(message || `Expected "${actual}" to contain "${expected}"`);
            }
        } else {
            throw new Error('assertContains requires string arguments');
        }
    }

    run() {
        console.log('XPath to SQL-2 Converter Unit Tests (xpath2.js)');
        console.log('===============================================\n');

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
    }
}

// Create test runner instance
const runner = new TestRunner();

// Note: xpath2.js has a different internal structure than xpath-converter.js
// It only exports convertXPathToSQL2 and XPathToSQL2Converter
// We test the main conversion functionality end-to-end

// Full conversion tests
runner.test('Full conversion - basic descendant with condition and order', () => {
    const input = '/jcr:root/content//element(*, nt:base)[fn:path() >= $lastValue] order by fn:path()';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'select', 'Should contain select clause');
    runner.assertContains(result, 'from [nt:base]', 'Should have correct from clause');
    runner.assertContains(result, 'isdescendantnode', 'Should use descendant node function');
    runner.assertContains(result, 'order by', 'Should include order by clause');
});

runner.test('Full conversion - simple property condition', () => {
    const input = '/jcr:root/content//element(*, dam:Asset)[@status="published"]';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'from [dam:Asset]', 'Should query dam:Asset');
    runner.assertContains(result, 'status', 'Should include status condition');
    runner.assertContains(result, 'published', 'Should include published value');
});

runner.test('Full conversion - explain prefix', () => {
    const input = 'explain /jcr:root/content//element(*, nt:base)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'explain', 'Should preserve explain prefix');
});

runner.test('Full conversion - measure prefix', () => {
    const input = 'measure /jcr:root/content//element(*, nt:base)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'measure', 'Should preserve measure prefix');
});

runner.test('Full conversion - empty query handling', () => {
    const input = '';
    const result = convertXPathToSQL2(input);
    
    runner.assert(result.includes('select'), 'Should handle empty query');
});

runner.test('Edge case - descendant at root', () => {
    const input = '//element(*, nt:base)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'select', 'Should handle descendant at root');
    runner.assertContains(result, 'from [nt:base]', 'Should have correct node type');
});

runner.test('Edge case - child node relationship', () => {
    const input = '/jcr:root/content/element(*, cq:Page)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'ischildnode', 'Should use child node relationship');
});

// Oak-specific tests
runner.test('Oak test - lastModified with order by', () => {
    const input = '/jcr:root/content//element(*, cq:Page)[@lastModified >= "2015-02-26"] order by @lastModified descending';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'lastModified', 'Should handle lastModified property');
    runner.assertContains(result, 'order by', 'Should include order by');
    runner.assertContains(result, 'desc', 'Should handle descending order');
});

runner.test('Oak test - simple property equality', () => {
    const input = '/jcr:root/content//element(*, cq:Page)[@jcr:title="test"]';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'jcr:title', 'Should include jcr:title property');
    runner.assertContains(result, 'test', 'Should include test value');
});

runner.test('Oak test - property existence check', () => {
    const input = '/jcr:root/content//element(*, cq:Page)[@jcr:title]';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'jcr:title', 'Should check for jcr:title existence');
});

runner.test('Oak test - numeric comparison negative', () => {
    const input = '/jcr:root/content//element(*, nt:base)[@size = -1234]';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'size', 'Should handle size property');
    runner.assertContains(result, '-1234', 'Should handle negative numbers');
});

runner.test('Oak test - numeric comparison positive large', () => {
    const input = '/jcr:root/content//element(*, nt:base)[@size = 9876543210]';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'size', 'Should handle size property');
    runner.assertContains(result, '9876543210', 'Should handle large numbers');
});

runner.test('Oak test - decimal notation', () => {
    const input = '/jcr:root/content//element(*, nt:base)[@size = 12300]';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'size', 'Should handle size property');
    runner.assertContains(result, '12300', 'Should handle decimal numbers');
});

runner.test('Oak test - descendant nodes path', () => {
    const input = '/jcr:root/content/campaigns//element(*, nt:base)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'isdescendantnode', 'Should use descendant relationship');
    runner.assertContains(result, '/content/campaigns', 'Should include correct path');
});

runner.test('Oak test - specific element by name', () => {
    const input = '/jcr:root/content/campaigns/summer/element(groupByMonth, nt:unstructured)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'groupByMonth', 'Should handle specific element name');
});

runner.test('Oak test - child nodes path', () => {
    const input = '/jcr:root/content/campaigns/element(*, nt:base)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'ischildnode', 'Should use child relationship');
    runner.assertContains(result, '/content/campaigns', 'Should include correct path');
});

// Test basic conversion works
runner.test('Basic conversion - simple query', () => {
    const input = '/jcr:root/content//element(*, dam:Asset)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'select', 'Should have select clause');
    runner.assertContains(result, 'from [dam:Asset]', 'Should have from clause');
    runner.assertContains(result, 'where', 'Should have where clause');
});

runner.test('Basic conversion - with property condition', () => {
    const input = '/jcr:root/content//element(*, dam:Asset)[@status="approved"]';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'status', 'Should include status property');
    runner.assertContains(result, 'approved', 'Should include approved value');
});

// Option support tests
runner.test('Option support - limit', () => {
    const input = '/jcr:root/content//element(*, dam:Asset) option(limit 100)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'option (limit 100)', 'Should include limit option');
    runner.assertContains(result, 'from [dam:Asset]', 'Should have correct from clause');
});

runner.test('Option support - index tag', () => {
    const input = '/jcr:root/content//element(*, dam:Asset) option(index tag myTag)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'option (index tag [myTag])', 'Should include index tag option with brackets');
    runner.assertContains(result, 'from [dam:Asset]', 'Should have correct from clause');
});

runner.test('Option support - index name', () => {
    const input = '/jcr:root/content//element(*, dam:Asset) option(index name myIndex)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'option (index name [myIndex])', 'Should include index name option with brackets');
    runner.assertContains(result, 'from [dam:Asset]', 'Should have correct from clause');
});

runner.test('Option support - offset', () => {
    const input = '/jcr:root/content//element(*, dam:Asset) option(offset 50)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'option (offset 50)', 'Should include offset option');
    runner.assertContains(result, 'from [dam:Asset]', 'Should have correct from clause');
});

runner.test('Option support - traversal', () => {
    const input = '/jcr:root/content//element(*, dam:Asset) option(traversal DEFAULT)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'option (traversal DEFAULT)', 'Should include traversal option');
    runner.assertContains(result, 'from [dam:Asset]', 'Should have correct from clause');
});

runner.test('Option support - prefetch', () => {
    const input = '/jcr:root/content//element(*, dam:Asset) option(prefetch 1000)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'option (prefetch 1000)', 'Should include prefetch option');
    runner.assertContains(result, 'from [dam:Asset]', 'Should have correct from clause');
});

runner.test('Option support - multiple options', () => {
    const input = '/jcr:root/content//element(*, dam:Asset) option(limit 100, index tag myTag, offset 50)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'option (', 'Should include option clause');
    runner.assertContains(result, 'index tag [myTag]', 'Should include index tag');
    runner.assertContains(result, 'limit 100', 'Should include limit');
    runner.assertContains(result, 'offset 50', 'Should include offset');
});

runner.test('Option support - with order by', () => {
    const input = '/jcr:root/content//element(*, dam:Asset) order by @title option(limit 100)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'order by', 'Should include order by clause');
    runner.assertContains(result, 'option (limit 100)', 'Should include option clause after order by');
});

runner.test('Option support - complex query with options', () => {
    const input = '/jcr:root/content//element(*, dam:Asset)[@status="published"] order by @title option(index tag myTag, limit 50)';
    const result = convertXPathToSQL2(input);
    
    runner.assertContains(result, 'status', 'Should include status condition');
    runner.assertContains(result, 'published', 'Should include published value');
    runner.assertContains(result, 'order by', 'Should include order by');
    runner.assertContains(result, 'option (index tag [myTag], limit 50)', 'Should include options');
});

// Run all tests
runner.run();