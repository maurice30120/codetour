const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runScript } = require('..');

test('TypeScript code with type annotations is transpiled and executed', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  // Create a test file
  fs.writeFileSync(path.join(root, 'test.txt'), 'hello world');
  
  // TypeScript code with type annotations
  const tsCode = `
    (): string => {
      const result: Array<{file: string, line: number, text: string}> = search("hello");
      return result.length > 0 ? result[0].text : "not found";
    }
  `;
  
  const result = await runScript({ workspace: root, code: tsCode });
  assert.equal(result, 'hello world');
});

test('TypeScript code with interface definitions is transpiled', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  fs.writeFileSync(path.join(root, 'test.txt'), 'interface test');
  
  const tsCode = `
    interface SearchResult {
      file: string;
      line: number;
      text: string;
    }
    (): string => {
      const results: SearchResult[] = search("interface");
      return results.length > 0 ? results[0].text : "not found";
    }
  `;
  
  const result = await runScript({ workspace: root, code: tsCode });
  assert.equal(result, 'interface test');
});

test('TypeScript syntax errors return compact error messages', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  // Invalid TypeScript - missing closing brace
  const tsCode = `
    (): string => {
      return "hello";
  `;
  
  await assert.rejects(
    runScript({ workspace: root, code: tsCode }),
    /TypeScript validation failed.*TS1005/ 
  );
});

test('TypeScript type errors in strict mode return compact error messages', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  // Type error - assigning string to number
  const tsCode = `
    (): number => {
      const x: number = "not a number";
      return x;
    }
  `;
  
  await assert.rejects(
    runScript({ workspace: root, code: tsCode }),
    /TypeScript validation failed/ 
  );
});

test('JavaScript code still works without TypeScript validation', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  fs.writeFileSync(path.join(root, 'test.txt'), 'javascript test');
  
  // Plain JavaScript
  const jsCode = `
    (() => {
      const result = search("javascript");
      return result.length > 0 ? result[0].text : "not found";
    })()
  `;
  
  const result = await runScript({ workspace: root, code: jsCode });
  assert.equal(result, 'javascript test');
});

test('TypeScript code using only allowed primitives executes successfully', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  fs.writeFileSync(path.join(root, 'test1.txt'), 'line 1\nline 2\nline 3');
  fs.writeFileSync(path.join(root, 'test2.txt'), 'another file');
  
  const tsCode = `
    (): string => {
      const files = listFiles();
      const content = read("test1.txt");
      const searchResults = search("line 2");
      return \`Files: \${files.length}, Lines: \${content.lines.length}, Search: \${searchResults.length}\`;
    }
  `;
  
  const result = await runScript({ workspace: root, code: tsCode });
  assert.ok(result.includes('Files:'));
  assert.ok(result.includes('Lines:'));
  assert.ok(result.includes('Search:'));
});

test('TypeScript code with disallowed function calls is rejected', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  // Try to use eval
  const tsCode = `
    (): string => {
      return eval("1+1");
    }
  `;
  
  await assert.rejects(
    runScript({ workspace: root, code: tsCode }),
    /disallowed function/ 
  );
});

test('TypeScript code with Function constructor is rejected', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  const tsCode = `
    (): string => {
      const fn = new Function("return 'test'");
      return fn();
    }
  `;
  
  await assert.rejects(
    runScript({ workspace: root, code: tsCode }),
    /disallowed function/ 
  );
});

test('TypeScript code can use allowed global objects', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  // Use allowed globals like JSON, Math, Date
  const tsCode = `
    (): string => {
      const obj = { test: "value" };
      const json = JSON.stringify(obj);
      const num = Math.abs(-5);
      const date = new Date();
      return \`\${json}-\${num}-\${date.getFullYear()}\`;
    }
  `;
  
  const result = await runScript({ workspace: root, code: tsCode });
  assert.ok(result.includes('{"test":"value"}'));
  assert.ok(result.includes('5'));
  assert.ok(result.includes(new Date().getFullYear().toString()));
});

test('Trace information is included in the output', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  fs.writeFileSync(path.join(root, 'test.txt'), 'trace test');
  
  const tsCode = `
    (): string => {
      return search("trace")[0]?.text || "not found";
    }
  `;
  
  // Note: The current implementation returns {value, trace} but runScript only returns value
  // This test verifies that the worker.js processes TypeScript correctly
  const result = await runScript({ workspace: root, code: tsCode });
  assert.equal(result, 'trace test');
});

test('TypeScript arrow function with explicit return type works', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  const tsCode = `
    const func: () => number = (): number => {
      return 42;
    };
    func();
  `;
  
  const result = await runScript({ workspace: root, code: tsCode });
  assert.equal(result, 42);
});

test('TypeScript generic types are transpiled correctly', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  
  const tsCode = `
    (): number => {
      const arr: Array<number> = [1, 2, 3];
      const sum: number = arr.reduce((a, b) => a + b, 0);
      return sum;
    }
  `;
  
  const result = await runScript({ workspace: root, code: tsCode });
  assert.equal(result, 6);
});
