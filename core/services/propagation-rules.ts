// Propagation Rules - Define how changes propagate between concepts
import { Change, Concept, Suggestion } from '../types/core';
import { PropagationContext } from './knowledge-spreader';

export abstract class PropagationRule {
    constructor(
        public name: string,
        public description: string,
        public priority: number = 5
    ) {}
    
    abstract matches(change: Change, context: PropagationContext): Promise<boolean>;
    abstract apply(change: Change, context: PropagationContext): Promise<Suggestion[]>;
    abstract canPropagate(change: Change, targetConcept: Concept): Promise<boolean>;
    abstract transform(targetName: string, change: Change): Promise<string | null>;
}

// Getter/Setter Synchronization Rule
export class GetterSetterSyncRule extends PropagationRule {
    constructor() {
        super(
            'getter_setter_sync',
            'Synchronizes getter and setter method names',
            8
        );
    }
    
    async matches(change: Change, context: PropagationContext): Promise<boolean> {
        if (change.type !== 'rename' || !change.to) return false;
        
        const name = change.identifier.toLowerCase();
        return name.startsWith('get') || name.startsWith('set') ||
               name.startsWith('is') || name.startsWith('has');
    }
    
    async apply(change: Change, context: PropagationContext): Promise<Suggestion[]> {
        const suggestions: Suggestion[] = [];
        
        if (!change.to) return suggestions;
        
        const oldName = change.identifier;
        const newName = change.to;
        
        // Find corresponding getter/setter
        if (oldName.startsWith('get')) {
            const setterName = oldName.replace('get', 'set');
            const newSetterName = newName.replace('get', 'set');
            
            suggestions.push({
                type: 'related_rename',
                target: setterName,
                suggestion: newSetterName,
                confidence: 0.9,
                reason: 'Getter/setter pair synchronization',
                autoApply: false,
                evidence: ['Maintains getter/setter naming consistency']
            });
            
        } else if (oldName.startsWith('set')) {
            const getterName = oldName.replace('set', 'get');
            const newGetterName = newName.replace('set', 'get');
            
            suggestions.push({
                type: 'related_rename',
                target: getterName,
                suggestion: newGetterName,
                confidence: 0.9,
                reason: 'Getter/setter pair synchronization',
                autoApply: false,
                evidence: ['Maintains getter/setter naming consistency']
            });
        }
        
        return suggestions;
    }
    
    async canPropagate(change: Change, targetConcept: Concept): Promise<boolean> {
        const targetName = targetConcept.canonicalName.toLowerCase();
        const sourceName = change.identifier.toLowerCase();
        
        // Check if they form a getter/setter pair
        if (sourceName.startsWith('get') && targetName.startsWith('set')) {
            const sourceProperty = sourceName.substring(3);
            const targetProperty = targetName.substring(3);
            return sourceProperty === targetProperty;
        }
        
        if (sourceName.startsWith('set') && targetName.startsWith('get')) {
            const sourceProperty = sourceName.substring(3);
            const targetProperty = targetName.substring(3);
            return sourceProperty === targetProperty;
        }
        
        return false;
    }
    
    async transform(targetName: string, change: Change): Promise<string | null> {
        if (!change.to) return null;
        
        const oldName = change.identifier;
        const newName = change.to;
        
        if (oldName.startsWith('get') && targetName.startsWith('set')) {
            const property = targetName.substring(3);
            const newProperty = newName.substring(3);
            return `set${newProperty}`;
        }
        
        if (oldName.startsWith('set') && targetName.startsWith('get')) {
            const property = targetName.substring(3);
            const newProperty = newName.substring(3);
            return `get${newProperty}`;
        }
        
        return null;
    }
}

// Interface Implementation Synchronization Rule
export class InterfaceImplementationSyncRule extends PropagationRule {
    constructor() {
        super(
            'interface_implementation_sync',
            'Synchronizes interface and implementation method names',
            9
        );
    }
    
    async matches(change: Change, context: PropagationContext): Promise<boolean> {
        if (change.type !== 'rename') return false;
        
        return context.concept?.metadata.isInterface === true;
    }
    
    async apply(change: Change, context: PropagationContext): Promise<Suggestion[]> {
        const suggestions: Suggestion[] = [];
        
        if (!change.to || !context.concept) return suggestions;
        
        // Find all implementations
        const implementations = await this.findImplementations(context.concept);
        
        for (const impl of implementations) {
            suggestions.push({
                type: 'implementation_update',
                target: impl.canonicalName,
                suggestion: change.to,
                confidence: 0.95,
                reason: 'Interface method renamed - implementation must match',
                autoApply: true,
                evidence: [
                    'Interface contract requires matching method names',
                    'High confidence due to direct interface-implementation relationship'
                ]
            });
        }
        
        return suggestions;
    }
    
    async canPropagate(change: Change, targetConcept: Concept): Promise<boolean> {
        // Check if target implements the changed interface
        return this.implementsInterface(targetConcept, change.source);
    }
    
    async transform(targetName: string, change: Change): Promise<string | null> {
        // For interface implementations, use the exact new name
        return change.to || null;
    }
    
    private async findImplementations(interfaceConcept: Concept): Promise<Concept[]> {
        // This would find all concepts that implement this interface
        // Implementation depends on having access to the ontology
        return [];
    }
    
    private implementsInterface(concept: Concept, interfaceSource: string): boolean {
        // Check if concept implements the interface
        for (const [_, relation] of concept.relations) {
            if (relation.type === 'implements' && relation.targetConceptId === interfaceSource) {
                return true;
            }
        }
        return false;
    }
}

// Test File Synchronization Rule
export class TestFileSyncRule extends PropagationRule {
    constructor() {
        super(
            'test_file_sync',
            'Synchronizes test files with source file changes',
            6
        );
    }
    
    async matches(change: Change, context: PropagationContext): Promise<boolean> {
        if (change.type !== 'rename') return false;
        
        // Don't apply if the change is already in a test file
        return !this.isTestFile(change.location);
    }
    
    async apply(change: Change, context: PropagationContext): Promise<Suggestion[]> {
        const suggestions: Suggestion[] = [];
        
        if (!change.to) return suggestions;
        
        // Generate test-related suggestions
        const testVariants = this.generateTestNames(change.identifier, change.to);
        
        for (const variant of testVariants) {
            suggestions.push({
                type: 'test_rename',
                target: variant.old,
                suggestion: variant.new,
                confidence: 0.8,
                reason: 'Test should match implementation name',
                autoApply: false,
                evidence: ['Maintains test-implementation naming consistency']
            });
        }
        
        return suggestions;
    }
    
    async canPropagate(change: Change, targetConcept: Concept): Promise<boolean> {
        const targetName = targetConcept.canonicalName;
        const sourceName = change.identifier;
        
        // Check if target is a test variant of source
        return this.isTestVariant(targetName, sourceName);
    }
    
    async transform(targetName: string, change: Change): Promise<string | null> {
        if (!change.to) return null;
        
        // Transform test names
        const testSuffixes = ['Test', 'Spec', 'Tests', 'Specs'];
        
        for (const suffix of testSuffixes) {
            if (targetName.endsWith(suffix)) {
                const baseName = targetName.substring(0, targetName.length - suffix.length);
                if (baseName === change.identifier) {
                    return change.to + suffix;
                }
            }
        }
        
        return null;
    }
    
    private isTestFile(location: string): boolean {
        const testPatterns = ['/test/', '/tests/', '/__tests__/', '.test.', '.spec.'];
        return testPatterns.some(pattern => location.includes(pattern));
    }
    
    private generateTestNames(oldName: string, newName: string): Array<{ old: string; new: string }> {
        const variants: Array<{ old: string; new: string }> = [];
        const testSuffixes = ['Test', 'Spec', 'Tests', 'Specs'];
        
        for (const suffix of testSuffixes) {
            variants.push({
                old: oldName + suffix,
                new: newName + suffix
            });
        }
        
        return variants;
    }
    
    private isTestVariant(testName: string, sourceName: string): boolean {
        const testSuffixes = ['Test', 'Spec', 'Tests', 'Specs'];
        
        return testSuffixes.some(suffix => 
            testName === sourceName + suffix
        );
    }
}

// Service/Controller Pattern Rule
export class ServiceControllerPatternRule extends PropagationRule {
    constructor() {
        super(
            'service_controller_pattern',
            'Propagates changes between service and controller layers',
            7
        );
    }
    
    async matches(change: Change, context: PropagationContext): Promise<boolean> {
        if (change.type !== 'rename') return false;
        
        const name = change.identifier.toLowerCase();
        return name.includes('service') || name.includes('controller');
    }
    
    async apply(change: Change, context: PropagationContext): Promise<Suggestion[]> {
        const suggestions: Suggestion[] = [];
        
        if (!change.to) return suggestions;
        
        const oldName = change.identifier;
        const newName = change.to;
        
        if (oldName.includes('Service')) {
            // Suggest corresponding controller change
            const controllerName = oldName.replace('Service', 'Controller');
            const newControllerName = newName.replace('Service', 'Controller');
            
            suggestions.push({
                type: 'layer_sync',
                target: controllerName,
                suggestion: newControllerName,
                confidence: 0.7,
                reason: 'Service-Controller layer synchronization',
                autoApply: false,
                evidence: ['Maintains consistency across service layers']
            });
        }
        
        if (oldName.includes('Controller')) {
            // Suggest corresponding service change
            const serviceName = oldName.replace('Controller', 'Service');
            const newServiceName = newName.replace('Controller', 'Service');
            
            suggestions.push({
                type: 'layer_sync',
                target: serviceName,
                suggestion: newServiceName,
                confidence: 0.7,
                reason: 'Controller-Service layer synchronization',
                autoApply: false,
                evidence: ['Maintains consistency across service layers']
            });
        }
        
        return suggestions;
    }
    
    async canPropagate(change: Change, targetConcept: Concept): Promise<boolean> {
        const sourceName = change.identifier;
        const targetName = targetConcept.canonicalName;
        
        // Check for service-controller relationships
        if (sourceName.includes('Service') && targetName.includes('Controller')) {
            const sourceBase = sourceName.replace('Service', '');
            const targetBase = targetName.replace('Controller', '');
            return sourceBase === targetBase;
        }
        
        if (sourceName.includes('Controller') && targetName.includes('Service')) {
            const sourceBase = sourceName.replace('Controller', '');
            const targetBase = targetName.replace('Service', '');
            return sourceBase === targetBase;
        }
        
        return false;
    }
    
    async transform(targetName: string, change: Change): Promise<string | null> {
        if (!change.to) return null;
        
        const oldName = change.identifier;
        const newName = change.to;
        
        if (oldName.includes('Service') && targetName.includes('Controller')) {
            const baseChange = newName.replace('Service', '');
            return targetName.replace(oldName.replace('Service', ''), baseChange);
        }
        
        if (oldName.includes('Controller') && targetName.includes('Service')) {
            const baseChange = newName.replace('Controller', '');
            return targetName.replace(oldName.replace('Controller', ''), baseChange);
        }
        
        return null;
    }
}

// Naming Convention Consistency Rule
export class NamingConventionRule extends PropagationRule {
    constructor() {
        super(
            'naming_convention',
            'Maintains naming convention consistency',
            4
        );
    }
    
    async matches(change: Change, context: PropagationContext): Promise<boolean> {
        return change.type === 'rename' && !!change.to;
    }
    
    async apply(change: Change, context: PropagationContext): Promise<Suggestion[]> {
        const suggestions: Suggestion[] = [];
        
        if (!change.to) return suggestions;
        
        // Detect naming convention change
        const conventionChange = this.detectConventionChange(change.identifier, change.to);
        
        if (conventionChange) {
            // Find other identifiers that could follow the same convention
            const candidates = await this.findConventionCandidates(
                conventionChange,
                context
            );
            
            for (const candidate of candidates) {
                const suggestion = this.applyConvention(candidate, conventionChange);
                if (suggestion) {
                    suggestions.push({
                        type: 'convention_consistency',
                        target: candidate,
                        suggestion: suggestion,
                        confidence: 0.6,
                        reason: `Following ${conventionChange.from} → ${conventionChange.to} convention`,
                        autoApply: false,
                        evidence: ['Maintains naming convention consistency']
                    });
                }
            }
        }
        
        return suggestions;
    }
    
    async canPropagate(change: Change, targetConcept: Concept): Promise<boolean> {
        // This rule can potentially propagate to any concept
        return true;
    }
    
    async transform(targetName: string, change: Change): Promise<string | null> {
        if (!change.to) return null;
        
        const conventionChange = this.detectConventionChange(change.identifier, change.to);
        if (conventionChange) {
            return this.applyConvention(targetName, conventionChange);
        }
        
        return null;
    }
    
    private detectConventionChange(oldName: string, newName: string): {
        from: string;
        to: string;
        type: 'case' | 'prefix' | 'suffix';
    } | null {
        // Detect case changes
        if (this.isCamelCase(oldName) && this.isPascalCase(newName)) {
            return { from: 'camelCase', to: 'PascalCase', type: 'case' };
        }
        
        if (this.isPascalCase(oldName) && this.isCamelCase(newName)) {
            return { from: 'PascalCase', to: 'camelCase', type: 'case' };
        }
        
        // Detect prefix changes
        const oldPrefix = this.extractPrefix(oldName);
        const newPrefix = this.extractPrefix(newName);
        
        if (oldPrefix !== newPrefix && oldPrefix && newPrefix) {
            return { from: oldPrefix, to: newPrefix, type: 'prefix' };
        }
        
        return null;
    }
    
    private async findConventionCandidates(
        conventionChange: { from: string; to: string; type: string },
        context: PropagationContext
    ): Promise<string[]> {
        // This would find identifiers that match the old convention
        // Implementation depends on having access to all identifiers
        return [];
    }
    
    private applyConvention(
        identifier: string,
        convention: { from: string; to: string; type: string }
    ): string | null {
        switch (convention.type) {
            case 'case':
                if (convention.from === 'camelCase' && convention.to === 'PascalCase') {
                    return this.toPascalCase(identifier);
                }
                if (convention.from === 'PascalCase' && convention.to === 'camelCase') {
                    return this.toCamelCase(identifier);
                }
                break;
                
            case 'prefix':
                if (identifier.startsWith(convention.from)) {
                    return identifier.replace(convention.from, convention.to);
                }
                break;
        }
        
        return null;
    }
    
    private isCamelCase(str: string): boolean {
        return /^[a-z][a-zA-Z0-9]*$/.test(str);
    }
    
    private isPascalCase(str: string): boolean {
        return /^[A-Z][a-zA-Z0-9]*$/.test(str);
    }
    
    private extractPrefix(str: string): string | null {
        const match = str.match(/^(get|set|is|has|create|delete|update|handle)/);
        return match ? match[1] : null;
    }
    
    private toPascalCase(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
    
    private toCamelCase(str: string): string {
        return str.charAt(0).toLowerCase() + str.slice(1);
    }
}

// Factory function to create default rules
export function createDefaultRules(): PropagationRule[] {
    return [
        new GetterSetterSyncRule(),
        new InterfaceImplementationSyncRule(),
        new TestFileSyncRule(),
        new ServiceControllerPatternRule(),
        new NamingConventionRule()
    ];
}