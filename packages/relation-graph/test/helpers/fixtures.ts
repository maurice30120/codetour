import type { SourceFile } from "../../src/index";

/**
 * Ground-truth fixtures for the engine-level extraction contract of #149/#150.
 * Line numbers below are asserted by the tests — edit with care.
 */

export const TS_GREETER_PATH = "src/greeter.ts";
export const TS_MAIN_PATH = "src/main.ts";

export const TS_GREETER = `export class Greeter {
  greet(name: string): string {
    return "hi " + name;
  }
  twice(): string {
    return this.greet("x");
  }
}
`;

export const TS_MAIN = `import { Greeter } from "./greeter";

function top(a: number): number {
  return a * 2;
}

const g = new Greeter();
console.log(g.greet("bob"));
top(3);
`;

export const TS_FIXTURES: SourceFile[] = [
  { path: TS_GREETER_PATH, content: TS_GREETER },
  { path: TS_MAIN_PATH, content: TS_MAIN }
];

export const PY_CALCULATOR_PATH = "calculator.py";
export const PY_UTIL_PATH = "util.py";
export const PY_MAIN_PATH = "main.py";

export const PY_CALCULATOR = `class Calculator:
    def add(self, a, b):
        return a + b

    def twice(self, x):
        return self.add(x, x)
`;

export const PY_UTIL = `def helper(x):
    return x - 1
`;

export const PY_MAIN = `from calculator import Calculator

def run():
    calc = Calculator()
    print(calc.add(1, 2))
    return helper(3)
`;

export const PY_FIXTURES: SourceFile[] = [
  { path: PY_CALCULATOR_PATH, content: PY_CALCULATOR },
  { path: PY_UTIL_PATH, content: PY_UTIL },
  { path: PY_MAIN_PATH, content: PY_MAIN }
];
