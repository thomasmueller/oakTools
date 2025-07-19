# XPath to SQL-2 Converter JavaScript Module

This directory contains the XPath to SQL-2 converter JavaScript module and its unit tests.

## Files

- `xpath-converter.js` - Main converter module with all conversion logic
- `xpath-converter.test.js` - Unit tests for the converter
- `README.md` - This documentation file

## Running Unit Tests

To run the unit tests, you need Node.js installed on your system.

### Prerequisites

Make sure you have Node.js installed:
```bash
node --version
```

### Running Tests

Navigate to the `js` directory and run:
```bash
cd docs/js
node xpath-converter.test.js
```

### Test Output

The test runner will show:
- ✅ PASS for successful tests
- ❌ FAIL for failed tests with detailed error messages
- Final summary with pass/fail counts

### Example Output

```
XPath to SQL-2 Converter Unit Tests
=====================================

✅ PASS: convertXPathExpression - fn:path() conversion
✅ PASS: convertXPathExpression - jcr:first(@property) conversion
✅ PASS: Full conversion - basic descendant with condition
✅ PASS: Oak test - jcr:like function
✅ PASS: Oak test - property existence check
...

=====================================
Test Results: 35 passed, 0 failed
```

## Test Coverage

The unit tests cover:

### Individual Function Tests
- `convertXPathExpression()` - XPath syntax conversions
- `parseXPath()` - XPath parsing logic
- `buildSQL2Query()` - SQL-2 query building

### Integration Tests
- Complete XPath to SQL-2 conversions
- Edge cases and error handling
- Prefix handling (explain, measure)

### Test Cases Include
- Basic descendant paths with conditions
- JCR functions (`jcr:first`, `fn:path`, `jcr:like`, `jcr:contains`)
- Rep excerpt functions (with and without arguments)
- Property conditions and existence checks
- Boolean operators (`and`, `or`, `not`)
- Order by clauses with direction keywords
- Path relationship functions (`isdescendantnode`, `ischildnode`, `issamenode`)
- Property selection patterns
- Numeric comparisons (including negative and scientific notation)
- String handling with escaped quotes
- Complex boolean expressions
- Edge cases from Apache Jackrabbit Oak test suite

## Adding New Tests

To add new tests, edit `xpath-converter.test.js` and add new test cases using:

```javascript
runner.test('Test name', () => {
    const result = convertXPathToSQL2('your-xpath-query');
    runner.assertEqual(result, 'expected-sql2-output', 'Test description');
});
```

## Module Usage

The converter can be used in Node.js environments:

```javascript
const { convertXPathToSQL2 } = require('./xpath-converter.js');

const sql2 = convertXPathToSQL2('/jcr:root/content//element(*, nt:base)');
console.log(sql2);
``` 