/**
 * Test fixture file for ontology-lsp integration tests
 */

export class TestClass {
// mcp unified apply_after_checks test
    private value: number = 0;

    constructor(initialValue?: number) {
        this.value = initialValue ?? 0;
    }

    public getValue(): number {
        return this.value;
    }

    public setValue(newValue: number): void {
        this.value = newValue;
    }

    public static createDefault(): TestClass {
        return new TestClass(42);
    }
}

export function TestFunction(param: string): string {
    return `Hello, ${param}!`;
}

export interface TestInterface {
    id: string;
    name: string;
    active: boolean;
}

// Some additional test functions for different scenarios
export const getUserData = (id: string) => {
    return { id, name: 'Test User' };
};

export const setUserData = (id: string, data: any) => {
    console.log('Setting user data:', id, data);
};

// Class with inheritance for testing
export class ExtendedTestClass extends TestClass {
    private metadata: string;

    constructor(initialValue?: number, metadata?: string) {
        super(initialValue);
        this.metadata = metadata || 'default';
    }

    public getMetadata(): string {
        return this.metadata;
    }
}

// Generic function for testing
export function processData<T>(data: T): T {
    return data;
}

// Async function for testing
export async function fetchUserData(id: string): Promise<TestInterface> {
    return {
        id,
        name: `User ${id}`,
        active: true,
    };
}
