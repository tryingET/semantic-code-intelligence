import { test } from 'bun:test';

export class ExportedTsClass {
    run() { return 1; }
}

function InternalTsFunction() {
    sharedState.value = 1;
    return 1;
}

class MethodContainer {
    InternalTsMethod() {
        this.value = 1;
    }
}

export const ExportedTsVariable = 1;
export interface ExportedTsType { value: string }

const registry = new Map<string, unknown>();
registry.set('internal', InternalTsFunction);
test('internal function', () => InternalTsFunction());

const sharedState = { value: 0 };
void MethodContainer;
