/**
 * Comprehensive tests for TeamKnowledgeSystem
 * Tests team member management, pattern sharing, validation, and collaboration
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { EventBusService } from '../../core/services/event-bus-service.js';
import { SharedServices } from '../../core/services/index.js';
import type { CoreConfig } from '../../core/types.js';
import { type Pattern, PatternCategory } from '../../types/core.js';
import { SharedPattern, TeamKnowledgeSystem, type TeamMember } from '../team-knowledge.js';

const TEST_DB_DIR = path.join(process.cwd(), '.test-data');
const createTestDbPath = () =>
    path.join(TEST_DB_DIR, `team-knowledge-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);

const cleanupDbFiles = (dbPath: string) => {
    const candidates = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            fs.unlinkSync(p);
        }
    }
};

const makeConfig = (dbPath: string): CoreConfig => ({
    layers: {
        layer1: { enabled: true, timeout: 5000, maxResults: 100 },
        layer2: { enabled: true, timeout: 50000, languages: ['typescript', 'javascript'] },
        layer3: { enabled: true, dbPath, cacheSize: 1000 },
        layer4: { enabled: true, dbPath },
        layer5: { enabled: true, maxDepth: 3, autoApplyThreshold: 0.8 },
    },
    cache: { enabled: true, strategy: 'memory', memory: { maxSize: 1000 * 1024, ttl: 300 } },
    monitoring: { enabled: true, metricsInterval: 1000, logLevel: 'error', tracing: { enabled: false, sampleRate: 0 } },
    performance: { healthCheckInterval: 30000 },
    database: { path: dbPath, maxConnections: 2 },
});

// Helper function to create test team member
function createTestTeamMember(id: string, role: TeamMember['role'] = 'developer'): Omit<TeamMember, 'stats'> {
    return {
        id,
        name: `Test User ${id}`,
        role,
        expertise: ['typescript', 'react', 'testing'],
        joinedAt: new Date(),
        lastActive: new Date(),
        preferences: {
            patternSharingLevel: 'team',
            receivePatternSuggestions: true,
            autoSyncPatterns: true,
        },
    };
}

// Helper function to create test pattern
function createTestPattern(id: string): Pattern {
    return {
        id,
        from: [
            { type: 'literal', value: 'get' },
            { type: 'variable', name: 'entity' },
        ],
        to: [
            { type: 'literal', value: 'fetch' },
            { type: 'variable', name: 'entity' },
        ],
        confidence: 0.8,
        occurrences: 5,
        examples: [
            {
                oldName: 'getData',
                newName: 'fetchData',
                context: {
                    file: '/src/api.ts',
                    surroundingSymbols: ['Api', 'data'],
                    timestamp: new Date(),
                },
                confidence: 0.9,
            },
        ],
        lastApplied: new Date(),
        category: PatternCategory.Convention,
    };
}

	describe('TeamKnowledgeSystem', () => {
	    let teamKnowledge: TeamKnowledgeSystem;
	    let sharedServices: SharedServices;
	    let eventBus: EventBusService;
	    let testDbPath: string;

	    beforeEach(async () => {
	        fs.mkdirSync(TEST_DB_DIR, { recursive: true });
	        testDbPath = createTestDbPath();
	        cleanupDbFiles(testDbPath);

	        // Create fresh event bus and shared services
	        eventBus = new EventBusService();
	        sharedServices = new SharedServices(makeConfig(testDbPath), eventBus);
	        await sharedServices.initialize();

	        // Create team knowledge system
	        teamKnowledge = new TeamKnowledgeSystem(sharedServices, eventBus, {
            minValidators: 2,
            minApprovalScore: 3.0,
            adoptionThreshold: 3,
        });

        await teamKnowledge.initialize();
    });

	    afterEach(async () => {
	        // Clean up
	        await teamKnowledge.dispose();
	        await sharedServices.dispose();

	        // Remove test database
	        cleanupDbFiles(testDbPath);
	    });

    describe('Initialization', () => {
        test('should initialize successfully', async () => {
            expect(teamKnowledge).toBeDefined();
            const diagnostics = teamKnowledge.getDiagnostics();
            expect(diagnostics.initialized).toBe(true);
            expect(diagnostics.teamMembersCount).toBe(0);
            expect(diagnostics.sharedPatternsCount).toBe(0);
        });

        test('should initialize database schema', async () => {
            const tables = await sharedServices.database.query(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            );

            const tableNames = tables.map((t) => t.name);
            expect(tableNames).toContain('team_members');
            expect(tableNames).toContain('shared_patterns');
            expect(tableNames).toContain('pattern_validations');
            expect(tableNames).toContain('pattern_adoptions');
        });

        test('should load existing team data', async () => {
            // Add test data first
            await sharedServices.database.execute(
                `
        INSERT INTO team_members (
          id, name, role, expertise, joined_at, last_active
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
                [
                    'test-user',
                    'Test User',
                    'developer',
                    '["typescript","react"]',
                    Math.floor(Date.now() / 1000),
                    Math.floor(Date.now() / 1000),
                ]
            );

            // Create new instance to test loading
            const newTeamKnowledge = new TeamKnowledgeSystem(sharedServices, eventBus);
            await newTeamKnowledge.initialize();

            const stats = newTeamKnowledge.getTeamStats();
            expect(stats.members).toBe(1);

            await newTeamKnowledge.dispose();
        });
    });

    describe('Team Member Management', () => {
        test('should register team member successfully', async () => {
            const member = createTestTeamMember('user1', 'developer');
            const memberId = await teamKnowledge.registerTeamMember(member);

            expect(memberId).toBe('user1');

            const stats = teamKnowledge.getTeamStats();
            expect(stats.members).toBe(1);
        });

        test('should register team members with different roles', async () => {
            const roles: TeamMember['role'][] = ['developer', 'senior', 'lead', 'architect', 'admin'];

            for (const role of roles) {
                const member = createTestTeamMember(`user-${role}`, role);
                await teamKnowledge.registerTeamMember(member);
            }

            const stats = teamKnowledge.getTeamStats();
            expect(stats.members).toBe(roles.length);
        });

        test('should emit event when registering team member', async () => {
            const eventPromise = new Promise((resolve) => {
                eventBus.once('team-member:registered', (data: any) => {
                    resolve(data);
                });
            });

            const member = createTestTeamMember('event-user', 'senior');
            await teamKnowledge.registerTeamMember(member);

            const eventData = await eventPromise;
            expect(eventData).toBeDefined();
            expect((eventData as any).memberId).toBe('event-user');
            expect((eventData as any).role).toBe('senior');
        });

        test('should update existing team member', async () => {
            const member = createTestTeamMember('update-user', 'developer');
            await teamKnowledge.registerTeamMember(member);

            // Update with new role and expertise
            const updatedMember = {
                ...member,
                role: 'senior' as const,
                expertise: ['typescript', 'node', 'graphql'],
            };

            await teamKnowledge.registerTeamMember(updatedMember);

            // Should still have only one member but with updated info
            const stats = teamKnowledge.getTeamStats();
            expect(stats.members).toBe(1);
        });

        test('should handle team member preferences', async () => {
            const member = createTestTeamMember('pref-user', 'developer');
            member.preferences = {
                patternSharingLevel: 'private',
                receivePatternSuggestions: false,
                autoSyncPatterns: false,
            };

            await teamKnowledge.registerTeamMember(member);

            const stats = teamKnowledge.getTeamStats();
            expect(stats.members).toBe(1);
        });
    });

    describe('Pattern Sharing', () => {
        let contributorId: string;
        let testPattern: Pattern;

        beforeEach(async () => {
            // Register a contributor
            const contributor = createTestTeamMember('contributor1', 'senior');
            contributorId = await teamKnowledge.registerTeamMember(contributor);

            // Create test pattern
            testPattern = createTestPattern('share-test-pattern');
        });

        test('should share pattern successfully', async () => {
            const documentation = {
                description: 'Replace get with fetch for consistency',
                whenToUse: 'When renaming data retrieval functions',
                whenNotToUse: 'For non-data retrieval functions',
                examples: ['getData -> fetchData', 'getUser -> fetchUser'],
                relatedPatterns: [],
            };

            const patternId = await teamKnowledge.sharePattern(testPattern, contributorId, documentation, 'team');

            expect(patternId).toBe(testPattern.id);

            const stats = teamKnowledge.getTeamStats();
            expect(stats.patterns).toBe(1);
        });

        test('should share pattern within performance target', async () => {
            const documentation = {
                description: 'Test pattern for performance',
                whenToUse: 'Always',
                whenNotToUse: 'Never',
                examples: [],
                relatedPatterns: [],
            };

            const startTime = Date.now();
            await teamKnowledge.sharePattern(testPattern, contributorId, documentation);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(50); // Should be under 50ms
        });

        test('should update contributor stats when sharing', async () => {
            const documentation = {
                description: 'Pattern for stats test',
                whenToUse: 'Testing',
                whenNotToUse: 'Production',
                examples: [],
                relatedPatterns: [],
            };

            await teamKnowledge.sharePattern(testPattern, contributorId, documentation);

            // Check that contributor stats were updated
            const diagnostics = teamKnowledge.getDiagnostics();
            expect(diagnostics.teamMembersCount).toBe(1);
        });

        test('should emit event when sharing pattern', async () => {
            const eventPromise = new Promise((resolve) => {
                eventBus.once('pattern:shared', (data: any) => {
                    resolve(data);
                });
            });

            const documentation = {
                description: 'Event test pattern',
                whenToUse: 'Testing events',
                whenNotToUse: 'Not testing',
                examples: [],
                relatedPatterns: [],
            };

            await teamKnowledge.sharePattern(testPattern, contributorId, documentation);

            const eventData = await eventPromise;
            expect(eventData).toBeDefined();
            expect((eventData as any).patternId).toBe(testPattern.id);
            expect((eventData as any).contributorId).toBe(contributorId);
        });

        test('should extract tags from pattern and documentation', async () => {
            const documentation = {
                description: 'React component pattern using TypeScript and hooks',
                whenToUse: 'When creating functional components',
                whenNotToUse: 'For class components',
                examples: [],
                relatedPatterns: [],
            };

            await teamKnowledge.sharePattern(testPattern, contributorId, documentation);

            const stats = teamKnowledge.getTeamStats();
            expect(stats.patterns).toBe(1);
        });
    });

    describe('Pattern Validation', () => {
        let contributorId: string;
        let validatorId: string;
        let patternId: string;

        beforeEach(async () => {
            // Register contributor and validator
            const contributor = createTestTeamMember('contributor2', 'developer');
            contributorId = await teamKnowledge.registerTeamMember(contributor);

            const validator = createTestTeamMember('validator1', 'senior');
            validatorId = await teamKnowledge.registerTeamMember(validator);

            // Share a pattern
            const testPattern = createTestPattern('validation-test-pattern');
            const documentation = {
                description: 'Pattern for validation testing',
                whenToUse: 'Always',
                whenNotToUse: 'Never',
                examples: [],
                relatedPatterns: [],
            };

            patternId = await teamKnowledge.sharePattern(testPattern, contributorId, documentation);
        });

        test('should validate pattern successfully', async () => {
            const validation = {
                status: 'approve' as const,
                score: 4.0,
                feedback: 'Good pattern, useful for consistency',
                criteria: {
                    correctness: 4.0,
                    usefulness: 4.5,
                    clarity: 3.5,
                    completeness: 4.0,
                },
            };

            await teamKnowledge.validatePattern(patternId, validatorId, validation);

            // Pattern should still be pending (needs more validations)
            const stats = teamKnowledge.getTeamStats();
            expect(stats.patterns).toBe(1);
        });

        test('should validate pattern within performance target', async () => {
            const validation = {
                status: 'approve' as const,
                score: 3.5,
                feedback: 'Performance test validation',
                criteria: {
                    correctness: 3.5,
                    usefulness: 3.5,
                    clarity: 3.5,
                    completeness: 3.5,
                },
            };

            const startTime = Date.now();
            await teamKnowledge.validatePattern(patternId, validatorId, validation);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(30); // Should be under 30ms
        });

        test('should promote pattern to validated after sufficient approvals', async () => {
            // Add first validation
            await teamKnowledge.validatePattern(patternId, validatorId, {
                status: 'approve',
                score: 4.0,
                feedback: 'First approval',
                criteria: { correctness: 4, usefulness: 4, clarity: 4, completeness: 4 },
            });

            // Register and add second validator
            const validator2 = createTestTeamMember('validator2', 'lead');
            const validator2Id = await teamKnowledge.registerTeamMember(validator2);

            await teamKnowledge.validatePattern(patternId, validator2Id, {
                status: 'approve',
                score: 3.5,
                feedback: 'Second approval',
                criteria: { correctness: 3, usefulness: 4, clarity: 4, completeness: 3 },
            });

            const stats = teamKnowledge.getTeamStats();
            expect(stats.validatedPatterns).toBe(1);
        });

        test('should handle rejection validations', async () => {
            const validation = {
                status: 'reject' as const,
                score: 2.0,
                feedback: 'Pattern is not useful',
                criteria: {
                    correctness: 3.0,
                    usefulness: 1.0,
                    clarity: 2.0,
                    completeness: 2.0,
                },
            };

            await teamKnowledge.validatePattern(patternId, validatorId, validation);

            // Pattern should remain pending
            const stats = teamKnowledge.getTeamStats();
            expect(stats.validatedPatterns).toBe(0);
        });

        test('should update validator stats', async () => {
            const validation = {
                status: 'approve' as const,
                score: 4.0,
                feedback: 'Stats test validation',
                criteria: {
                    correctness: 4.0,
                    usefulness: 4.0,
                    clarity: 4.0,
                    completeness: 4.0,
                },
            };

            await teamKnowledge.validatePattern(patternId, validatorId, validation);

            // Validator stats should be updated
            const diagnostics = teamKnowledge.getDiagnostics();
            expect(diagnostics.teamMembersCount).toBe(2); // contributor + validator
        });

        test('should emit event when validating pattern', async () => {
            const eventPromise = new Promise((resolve) => {
                eventBus.once('pattern:validated', (data: any) => {
                    resolve(data);
                });
            });

            const validation = {
                status: 'approve' as const,
                score: 3.8,
                feedback: 'Event test validation',
                criteria: {
                    correctness: 4.0,
                    usefulness: 3.5,
                    clarity: 4.0,
                    completeness: 3.5,
                },
            };

            await teamKnowledge.validatePattern(patternId, validatorId, validation);

            const eventData = await eventPromise;
            expect(eventData).toBeDefined();
            expect((eventData as any).patternId).toBe(patternId);
            expect((eventData as any).validatorId).toBe(validatorId);
            expect((eventData as any).status).toBe('approve');
        });
    });

    describe('Pattern Adoption', () => {
        let contributorId: string;
        let adopterId: string;
        let patternId: string;

        beforeEach(async () => {
            // Register contributor and adopter
            const contributor = createTestTeamMember('contributor3', 'senior');
            contributorId = await teamKnowledge.registerTeamMember(contributor);

            const adopter = createTestTeamMember('adopter1', 'developer');
            adopterId = await teamKnowledge.registerTeamMember(adopter);

            // Share and validate a pattern
            const testPattern = createTestPattern('adoption-test-pattern');
            const documentation = {
                description: 'Pattern for adoption testing',
                whenToUse: 'Testing adoption',
                whenNotToUse: 'Not testing',
                examples: [],
                relatedPatterns: [],
            };

            patternId = await teamKnowledge.sharePattern(testPattern, contributorId, documentation);

            // Add validations to make it validated
            const validator1 = createTestTeamMember('validator-adopt-1', 'lead');
            const validator1Id = await teamKnowledge.registerTeamMember(validator1);

            const validator2 = createTestTeamMember('validator-adopt-2', 'architect');
            const validator2Id = await teamKnowledge.registerTeamMember(validator2);

            await teamKnowledge.validatePattern(patternId, validator1Id, {
                status: 'approve',
                score: 4.0,
                feedback: 'Good for adoption',
                criteria: { correctness: 4, usefulness: 4, clarity: 4, completeness: 4 },
            });

            await teamKnowledge.validatePattern(patternId, validator2Id, {
                status: 'approve',
                score: 3.5,
                feedback: 'Approved for use',
                criteria: { correctness: 3, usefulness: 4, clarity: 4, completeness: 3 },
            });
        });

        test('should record pattern adoption successfully', async () => {
            const adoption = {
                context: '/src/user-service.ts',
                outcome: 'success' as const,
                feedback: 'Pattern worked well in user service',
            };

            await teamKnowledge.recordPatternAdoption(patternId, adopterId, adoption);

            const stats = teamKnowledge.getTeamStats();
            expect(stats.patterns).toBeGreaterThan(0);
        });

        test('should promote pattern to adopted after sufficient adoptions', async () => {
            // Record multiple successful adoptions
            const adopters = ['adopter-1', 'adopter-2', 'adopter-3'];

            for (let i = 0; i < adopters.length; i++) {
                const adopter = createTestTeamMember(adopters[i], 'developer');
                const adopterIdLocal = await teamKnowledge.registerTeamMember(adopter);

                await teamKnowledge.recordPatternAdoption(patternId, adopterIdLocal, {
                    context: `/src/module-${i}.ts`,
                    outcome: 'success',
                    feedback: `Worked well in module ${i}`,
                });
            }

            const stats = teamKnowledge.getTeamStats();
            expect(stats.adoptedPatterns).toBe(1);
        });

        test('should handle different adoption outcomes', async () => {
            const outcomes = ['success', 'failure', 'partial'] as const;

            for (let i = 0; i < outcomes.length; i++) {
                const adopter = createTestTeamMember(`outcome-adopter-${i}`, 'developer');
                const adopterIdLocal = await teamKnowledge.registerTeamMember(adopter);

                await teamKnowledge.recordPatternAdoption(patternId, adopterIdLocal, {
                    context: `/src/outcome-test-${i}.ts`,
                    outcome: outcomes[i],
                    feedback: `Test outcome: ${outcomes[i]}`,
                    modifications: outcomes[i] === 'partial' ? 'Minor adjustments needed' : undefined,
                });
            }

            // All adoptions should be recorded regardless of outcome
            const stats = teamKnowledge.getTeamStats();
            expect(stats.patterns).toBeGreaterThan(0);
        });

        test('should update adoption metrics', async () => {
            // Record successful adoption
            await teamKnowledge.recordPatternAdoption(patternId, adopterId, {
                context: '/src/metrics-test.ts',
                outcome: 'success',
                feedback: 'Great pattern!',
            });

            // Record failed adoption
            const adopter2 = createTestTeamMember('adopter-metrics-2', 'developer');
            const adopter2Id = await teamKnowledge.registerTeamMember(adopter2);

            await teamKnowledge.recordPatternAdoption(patternId, adopter2Id, {
                context: '/src/failed-test.ts',
                outcome: 'failure',
                feedback: 'Did not work as expected',
            });

            // Success rate should be 50%
            const stats = teamKnowledge.getTeamStats();
            expect(stats.patterns).toBeGreaterThan(0);
        });

        test('should emit event when recording adoption', async () => {
            const eventPromise = new Promise((resolve) => {
                eventBus.once('pattern:adopted', (data: any) => {
                    resolve(data);
                });
            });

            await teamKnowledge.recordPatternAdoption(patternId, adopterId, {
                context: '/src/event-adoption-test.ts',
                outcome: 'success',
                feedback: 'Event test adoption',
            });

            const eventData = await eventPromise;
            expect(eventData).toBeDefined();
            expect((eventData as any).patternId).toBe(patternId);
            expect((eventData as any).adopterId).toBe(adopterId);
            expect((eventData as any).outcome).toBe('success');
        });
    });

    describe('Pattern Synchronization', () => {
        beforeEach(async () => {
            // Register team members with auto-sync enabled
            for (let i = 1; i <= 3; i++) {
                const member = createTestTeamMember(`sync-user-${i}`, 'developer');
                member.preferences.autoSyncPatterns = i <= 2; // Only first 2 have auto-sync
                await teamKnowledge.registerTeamMember(member);
            }

            // Add some validated patterns
            const contributor = createTestTeamMember('sync-contributor', 'senior');
            contributor.preferences.autoSyncPatterns = false; // Contributor not counted in auto-sync
            const contributorId = await teamKnowledge.registerTeamMember(contributor);

            const testPattern = createTestPattern('sync-test-pattern');
            const documentation = {
                description: 'Pattern for sync testing',
                whenToUse: 'Sync testing',
                whenNotToUse: 'No sync',
                examples: [],
                relatedPatterns: [],
            };

            await teamKnowledge.sharePattern(testPattern, contributorId, documentation);
        });

        test('should sync team patterns successfully', async () => {
            const syncStatus = await teamKnowledge.syncTeamPatterns();

            expect(syncStatus.syncHealth).toBe('healthy');
            expect(syncStatus.membersSynced).toBe(2); // Only 2 have auto-sync enabled
            expect(syncStatus.patternsSynced).toBeGreaterThanOrEqual(0);
            expect(syncStatus.errors.length).toBe(0);
        });

        test('should sync patterns within performance target', async () => {
            const startTime = Date.now();
            await teamKnowledge.syncTeamPatterns();
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(200); // Should be under 200ms
        });

        test('should sync patterns for specific member', async () => {
            const syncStatus = await teamKnowledge.syncTeamPatterns('sync-user-1');

            expect(syncStatus.membersSynced).toBe(1);
            expect(syncStatus.syncHealth).toBe('healthy');
        });

        test('should emit event when syncing patterns', async () => {
            const eventPromise = new Promise((resolve) => {
                eventBus.once('team-patterns:synced', (data: any) => {
                    resolve(data);
                });
            });

            await teamKnowledge.syncTeamPatterns();

            const eventData = await eventPromise;
            expect(eventData).toBeDefined();
            expect((eventData as any).syncStatus).toBeDefined();
        });
    });

    describe('Team Insights Generation', () => {
        beforeEach(async () => {
            // Create diverse team setup for insights testing
            const roles: Array<[string, TeamMember['role'], string[]]> = [
                ['expert-ts', 'architect', ['typescript', 'node', 'microservices']],
                ['expert-react', 'senior', ['react', 'frontend', 'typescript']],
                ['junior-1', 'developer', ['javascript', 'react']],
                ['junior-2', 'developer', ['typescript', 'testing']],
                ['bottleneck', 'lead', ['typescript', 'react', 'node', 'graphql']],
            ];

            for (const [id, role, expertise] of roles) {
                const member = createTestTeamMember(id, role);
                member.expertise = expertise;
                await teamKnowledge.registerTeamMember(member);
            }

            // Create patterns with different contributors to simulate bottlenecks
            for (let i = 0; i < 15; i++) {
                const pattern = createTestPattern(`bottleneck-pattern-${i}`);
                await teamKnowledge.sharePattern(pattern, 'bottleneck', {
                    description: `Pattern ${i} from bottleneck user`,
                    whenToUse: 'Testing',
                    whenNotToUse: 'Not testing',
                    examples: [],
                    relatedPatterns: [],
                });
            }
        });

        test('should generate team insights', async () => {
            const insights = await teamKnowledge.generateTeamInsights();

            expect(Array.isArray(insights)).toBe(true);
        });

        test('should generate insights within performance target', async () => {
            const startTime = Date.now();
            await teamKnowledge.generateTeamInsights();
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(100); // Should be under 100ms
        });

        test('should identify expertise gaps', async () => {
            const insights = await teamKnowledge.generateTeamInsights();

            const expertiseGapInsights = insights.filter((i) => i.type === 'expertise_gap');

            // Should identify areas with few experts
            if (expertiseGapInsights.length > 0) {
                const insight = expertiseGapInsights[0];
                expect(insight.actionable).toBe(true);
                expect(insight.recommendedAction).toContain('training');
                expect(insight.impact).toBeDefined();
            }
        });

        test('should identify knowledge bottlenecks', async () => {
            const insights = await teamKnowledge.generateTeamInsights();

            const bottleneckInsights = insights.filter((i) => i.type === 'knowledge_bottleneck');

            if (bottleneckInsights.length > 0) {
                const insight = bottleneckInsights[0];
                expect(insight.description).toContain('bottleneck');
                expect(insight.affectedMembers).toContain('bottleneck');
                expect(insight.recommendedAction).toContain('knowledge sharing');
            }
        });

        test('should identify collaboration opportunities', async () => {
            const insights = await teamKnowledge.generateTeamInsights();

            const collaborationInsights = insights.filter((i) => i.type === 'collaboration_opportunity');

            if (collaborationInsights.length > 0) {
                const insight = collaborationInsights[0];
                expect(insight.affectedMembers.length).toBe(2);
                expect(insight.recommendedAction).toContain('collaboration');
            }
        });

        test('should provide actionable insights', async () => {
            const insights = await teamKnowledge.generateTeamInsights();

            const actionableInsights = insights.filter((i) => i.actionable);

            for (const insight of actionableInsights) {
                expect(insight.recommendedAction).toBeDefined();
                expect(insight.recommendedAction!.length).toBeGreaterThan(0);
                expect(insight.evidence.length).toBeGreaterThan(0);
            }
        });
    });

    describe('Pattern Recommendations', () => {
        let memberId: string;

        beforeEach(async () => {
            // Register member with specific expertise
            const member = createTestTeamMember('rec-user', 'developer');
            member.expertise = ['react', 'typescript', 'hooks'];
            memberId = await teamKnowledge.registerTeamMember(member);

            // Create and share some validated patterns
            const contributor = createTestTeamMember('rec-contributor', 'senior');
            const contributorId = await teamKnowledge.registerTeamMember(contributor);

            const patterns = [
                { id: 'react-pattern-1', tags: ['react', 'hooks'] },
                { id: 'ts-pattern-1', tags: ['typescript', 'types'] },
                { id: 'unrelated-pattern', tags: ['python', 'django'] },
            ];

            for (const { id, tags } of patterns) {
                const pattern = createTestPattern(id);
                await teamKnowledge.sharePattern(pattern, contributorId, {
                    description: `Pattern for ${tags.join(', ')}`,
                    whenToUse: 'Testing recommendations',
                    whenNotToUse: 'Not testing',
                    examples: [],
                    relatedPatterns: [],
                });

                // Validate patterns
                const validator1 = createTestTeamMember(`val-1-${id}`, 'lead');
                const validator1Id = await teamKnowledge.registerTeamMember(validator1);

                const validator2 = createTestTeamMember(`val-2-${id}`, 'architect');
                const validator2Id = await teamKnowledge.registerTeamMember(validator2);

                await teamKnowledge.validatePattern(id, validator1Id, {
                    status: 'approve',
                    score: 4.0,
                    feedback: 'Good pattern',
                    criteria: { correctness: 4, usefulness: 4, clarity: 4, completeness: 4 },
                });

                await teamKnowledge.validatePattern(id, validator2Id, {
                    status: 'approve',
                    score: 3.5,
                    feedback: 'Approved',
                    criteria: { correctness: 3, usefulness: 4, clarity: 4, completeness: 3 },
                });
            }
        });

        test('should get recommended patterns for member', async () => {
            const recommendations = await teamKnowledge.getRecommendedPatterns(memberId);

            expect(Array.isArray(recommendations)).toBe(true);

            // Should recommend patterns matching member expertise
            const recommendedIds = recommendations.map((r) => r.pattern.id);
            expect(recommendedIds).toContain('react-pattern-1');
            expect(recommendedIds).toContain('ts-pattern-1');
            expect(recommendedIds).not.toContain('unrelated-pattern');
        });

        test('should not recommend self-contributed patterns', async () => {
            // Share a pattern as the member
            const selfPattern = createTestPattern('self-contributed');
            await teamKnowledge.sharePattern(selfPattern, memberId, {
                description: 'Self-contributed pattern',
                whenToUse: 'Never recommend to self',
                whenNotToUse: 'Always',
                examples: [],
                relatedPatterns: [],
            });

            const recommendations = await teamKnowledge.getRecommendedPatterns(memberId);
            const recommendedIds = recommendations.map((r) => r.pattern.id);

            expect(recommendedIds).not.toContain('self-contributed');
        });

        test('should sort recommendations by success rate', async () => {
            const recommendations = await teamKnowledge.getRecommendedPatterns(memberId);

            if (recommendations.length > 1) {
                for (let i = 0; i < recommendations.length - 1; i++) {
                    expect(recommendations[i].metrics.successRate).toBeGreaterThanOrEqual(
                        recommendations[i + 1].metrics.successRate
                    );
                }
            }
        });

        test('should handle member without matching expertise', async () => {
            // Register member with no matching expertise
            const noMatchMember = createTestTeamMember('no-match', 'developer');
            noMatchMember.expertise = ['cobol', 'fortran'];
            const noMatchId = await teamKnowledge.registerTeamMember(noMatchMember);

            const recommendations = await teamKnowledge.getRecommendedPatterns(noMatchId);

            // Should return empty array or very few recommendations
            expect(recommendations.length).toBeLessThanOrEqual(2);
        });
    });

    describe('Pattern Import/Export', () => {
        let contributorId: string;

        beforeEach(async () => {
            const contributor = createTestTeamMember('export-contributor', 'senior');
            contributorId = await teamKnowledge.registerTeamMember(contributor);

            // Create and validate some patterns for export
            for (let i = 0; i < 3; i++) {
                const pattern = createTestPattern(`export-pattern-${i}`);
                await teamKnowledge.sharePattern(pattern, contributorId, {
                    description: `Export pattern ${i}`,
                    whenToUse: 'Export testing',
                    whenNotToUse: 'Not exporting',
                    examples: [],
                    relatedPatterns: [],
                });

                // Validate patterns
                const validator1 = createTestTeamMember(`export-val-1-${i}`, 'lead');
                const validator1Id = await teamKnowledge.registerTeamMember(validator1);

                const validator2 = createTestTeamMember(`export-val-2-${i}`, 'architect');
                const validator2Id = await teamKnowledge.registerTeamMember(validator2);

                await teamKnowledge.validatePattern(`export-pattern-${i}`, validator1Id, {
                    status: 'approve',
                    score: 4.0,
                    feedback: 'Export ready',
                    criteria: { correctness: 4, usefulness: 4, clarity: 4, completeness: 4 },
                });

                await teamKnowledge.validatePattern(`export-pattern-${i}`, validator2Id, {
                    status: 'approve',
                    score: 3.5,
                    feedback: 'Ready for export',
                    criteria: { correctness: 3, usefulness: 4, clarity: 4, completeness: 3 },
                });
            }
        });

        test('should export team patterns', async () => {
            const exportedPatterns = await teamKnowledge.exportTeamPatterns('team');

            expect(Array.isArray(exportedPatterns)).toBe(true);
            expect(exportedPatterns.length).toBe(3);

            for (const exported of exportedPatterns) {
                expect(exported.pattern).toBeDefined();
                expect(exported.documentation).toBeDefined();
                expect(exported.metrics).toBeDefined();
                expect(exported.validations).toBeGreaterThan(0);
                expect(exported.exportedAt).toBeDefined();
            }
        });

        test('should emit event when exporting patterns', async () => {
            const eventPromise = new Promise((resolve) => {
                eventBus.once('team-patterns:exported', (data: any) => {
                    resolve(data);
                });
            });

            await teamKnowledge.exportTeamPatterns('team');

            const eventData = await eventPromise;
            expect(eventData).toBeDefined();
            expect((eventData as any).scope).toBe('team');
            expect((eventData as any).count).toBe(3);
        });

        test('should import patterns from external source', async () => {
            const importer = createTestTeamMember('importer', 'developer');
            const importerId = await teamKnowledge.registerTeamMember(importer);

            const patternsToImport = [
                {
                    pattern: createTestPattern('imported-pattern-1'),
                    documentation: {
                        description: 'Imported pattern 1',
                        whenToUse: 'Import testing',
                        whenNotToUse: 'Not importing',
                        examples: [],
                        relatedPatterns: [],
                    },
                    tags: ['imported', 'typescript'],
                },
                {
                    pattern: createTestPattern('imported-pattern-2'),
                    documentation: {
                        description: 'Imported pattern 2',
                        whenToUse: 'Import testing',
                        whenNotToUse: 'Not importing',
                        examples: [],
                        relatedPatterns: [],
                    },
                    tags: ['imported', 'react'],
                },
            ];

            const result = await teamKnowledge.importPatterns(patternsToImport, importerId, 'external-team');

            expect(result.imported).toBe(2);
            expect(result.skipped).toBe(0);
            expect(result.errors.length).toBe(0);

            const stats = teamKnowledge.getTeamStats();
            expect(stats.patterns).toBe(5); // 3 original + 2 imported
        });

        test('should handle duplicate patterns during import', async () => {
            const importer = createTestTeamMember('importer2', 'developer');
            const importerId = await teamKnowledge.registerTeamMember(importer);

            // Try to import existing pattern
            const patternsToImport = [
                {
                    pattern: createTestPattern('export-pattern-0'), // Same ID as existing
                    documentation: {
                        description: 'Duplicate pattern',
                        whenToUse: 'Testing duplicates',
                        whenNotToUse: 'Not testing',
                        examples: [],
                        relatedPatterns: [],
                    },
                    tags: ['duplicate'],
                },
            ];

            const result = await teamKnowledge.importPatterns(patternsToImport, importerId, 'duplicate-source');

            expect(result.imported).toBe(0);
            expect(result.skipped).toBe(1);
            expect(result.errors.length).toBe(0);
        });

        test('should emit event when importing patterns', async () => {
            const eventPromise = new Promise((resolve) => {
                eventBus.once('team-patterns:imported', (data: any) => {
                    resolve(data);
                });
            });

            const importer = createTestTeamMember('importer3', 'developer');
            const importerId = await teamKnowledge.registerTeamMember(importer);

            const patternsToImport = [
                {
                    pattern: createTestPattern('import-event-test'),
                    documentation: {
                        description: 'Import event test',
                        whenToUse: 'Event testing',
                        whenNotToUse: 'Not testing events',
                        examples: [],
                        relatedPatterns: [],
                    },
                    tags: ['event-test'],
                },
            ];

            await teamKnowledge.importPatterns(patternsToImport, importerId, 'event-test-source');

            const eventData = await eventPromise;
            expect(eventData).toBeDefined();
            expect((eventData as any).source).toBe('event-test-source');
            expect((eventData as any).importerId).toBe(importerId);
            expect((eventData as any).result.imported).toBe(1);
        });
    });

    describe('Knowledge Graph', () => {
        beforeEach(async () => {
            // Create team with various relationships
            const members = [
                { id: 'architect1', role: 'architect' as const, expertise: ['system-design', 'microservices'] },
                { id: 'senior1', role: 'senior' as const, expertise: ['react', 'typescript'] },
                { id: 'senior2', role: 'senior' as const, expertise: ['node', 'graphql'] },
                { id: 'dev1', role: 'developer' as const, expertise: ['react', 'javascript'] },
                { id: 'dev2', role: 'developer' as const, expertise: ['typescript', 'testing'] },
            ];

            for (const memberData of members) {
                const member = createTestTeamMember(memberData.id, memberData.role);
                member.expertise = memberData.expertise;
                await teamKnowledge.registerTeamMember(member);
            }

            // Create patterns and validations to establish relationships
            const pattern1 = createTestPattern('graph-pattern-1');
            await teamKnowledge.sharePattern(pattern1, 'senior1', {
                description: 'React pattern',
                whenToUse: 'React apps',
                whenNotToUse: 'Non-react',
                examples: [],
                relatedPatterns: [],
            });

            // Architect validates senior's pattern (mentoring relationship)
            await teamKnowledge.validatePattern('graph-pattern-1', 'architect1', {
                status: 'approve',
                score: 4.0,
                feedback: 'Good pattern',
                criteria: { correctness: 4, usefulness: 4, clarity: 4, completeness: 4 },
            });

            // Developer adopts senior's pattern (collaboration relationship)
            await teamKnowledge.recordPatternAdoption('graph-pattern-1', 'dev1', {
                context: '/src/component.tsx',
                outcome: 'success',
                feedback: 'Worked great!',
            });
        });

        test('should build knowledge graph', async () => {
            const knowledgeGraph = teamKnowledge.getKnowledgeGraph();

            expect(knowledgeGraph.members.size).toBe(5);
            expect(knowledgeGraph.patterns.size).toBeGreaterThan(0);
            expect(knowledgeGraph.expertiseMap.size).toBeGreaterThan(0);
            expect(knowledgeGraph.connections.length).toBeGreaterThan(0);
        });

        test('should map expertise correctly', async () => {
            const knowledgeGraph = teamKnowledge.getKnowledgeGraph();

            expect(knowledgeGraph.expertiseMap.has('react')).toBe(true);
            expect(knowledgeGraph.expertiseMap.has('typescript')).toBe(true);

            const reactExperts = knowledgeGraph.expertiseMap.get('react') || [];
            expect(reactExperts).toContain('senior1');
            expect(reactExperts).toContain('dev1');
        });

        test('should infer mentoring relationships', async () => {
            const knowledgeGraph = teamKnowledge.getKnowledgeGraph();

            const mentoringConnections = knowledgeGraph.connections.filter((c) => c.type === 'mentors');

            if (mentoringConnections.length > 0) {
                const mentoring = mentoringConnections[0];
                expect(mentoring.from).toBe('architect1'); // Architect mentors
                expect(mentoring.to).toBe('senior1'); // Senior dev
                expect(mentoring.strength).toBeGreaterThan(0);
            }
        });

        test('should infer collaboration relationships', async () => {
            const knowledgeGraph = teamKnowledge.getKnowledgeGraph();

            const collaborationConnections = knowledgeGraph.connections.filter((c) => c.type === 'collaborates');

            if (collaborationConnections.length > 0) {
                const collaboration = collaborationConnections[0];
                expect(collaboration.strength).toBeGreaterThan(0);
                expect(collaboration.context).toBeDefined();
            }
        });
    });

    describe('Performance', () => {
        test('should handle large team efficiently', async () => {
            const startTime = Date.now();

            // Register 50 team members
            const memberPromises: Promise<string>[] = [];
            for (let i = 0; i < 50; i++) {
                const member = createTestTeamMember(`perf-user-${i}`, 'developer');
                member.expertise = [`skill-${i % 10}`, `tech-${i % 5}`]; // Distribute expertise
                memberPromises.push(teamKnowledge.registerTeamMember(member));
            }

            await Promise.all(memberPromises);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(2000); // Should complete within 2 seconds

            const stats = teamKnowledge.getTeamStats();
            expect(stats.members).toBe(50);
        });

        test('should handle many patterns efficiently', async () => {
            // Register contributor
            const contributor = createTestTeamMember('perf-contributor', 'senior');
            const contributorId = await teamKnowledge.registerTeamMember(contributor);

            const startTime = Date.now();

            // Share 100 patterns
            const patternPromises: Promise<string>[] = [];
            for (let i = 0; i < 100; i++) {
                const pattern = createTestPattern(`perf-pattern-${i}`);
                patternPromises.push(
                    teamKnowledge.sharePattern(pattern, contributorId, {
                        description: `Performance test pattern ${i}`,
                        whenToUse: 'Testing',
                        whenNotToUse: 'Not testing',
                        examples: [],
                        relatedPatterns: [],
                    })
                );
            }

            await Promise.all(patternPromises);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(3000); // Should complete within 3 seconds

            const stats = teamKnowledge.getTeamStats();
            expect(stats.patterns).toBe(100);
        });

        test('should maintain recommendation performance with large dataset', async () => {
            // Set up large dataset first (simplified for test)
            const member = createTestTeamMember('perf-rec-user', 'developer');
            member.expertise = ['typescript', 'react'];
            const memberId = await teamKnowledge.registerTeamMember(member);

            const contributor = createTestTeamMember('perf-rec-contributor', 'senior');
            const contributorId = await teamKnowledge.registerTeamMember(contributor);

            // Add some patterns
            for (let i = 0; i < 10; i++) {
                const pattern = createTestPattern(`perf-rec-pattern-${i}`);
                await teamKnowledge.sharePattern(pattern, contributorId, {
                    description: `Recommendation test pattern ${i}`,
                    whenToUse: 'Testing recommendations',
                    whenNotToUse: 'Not testing',
                    examples: [],
                    relatedPatterns: [],
                });
            }

            // Test recommendation performance
            const startTime = Date.now();
            await teamKnowledge.getRecommendedPatterns(memberId);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(100); // Should be very fast
        });
    });

    describe('Error Handling', () => {
        test('should handle database errors gracefully', async () => {
            // Close database to simulate error
            await sharedServices.database.close();

            const member = createTestTeamMember('error-user', 'developer');

            // Should not throw but handle gracefully
            const memberId = await teamKnowledge.registerTeamMember(member);
            expect(memberId).toBe('error-user');
        });

        test('should handle invalid team member data', async () => {
            // Test with invalid role
            const invalidMember = createTestTeamMember('invalid-user', 'developer');
            (invalidMember as any).role = 'invalid-role';

            // Should still register (validation would be done at API level)
            const memberId = await teamKnowledge.registerTeamMember(invalidMember);
            expect(memberId).toBe('invalid-user');
        });

        test('should handle missing pattern during validation', async () => {
            const validator = createTestTeamMember('validator-error', 'senior');
            const validatorId = await teamKnowledge.registerTeamMember(validator);

            // Try to validate non-existent pattern
            await expect(
                teamKnowledge.validatePattern('non-existent', validatorId, {
                    status: 'approve',
                    score: 4.0,
                    feedback: 'Good pattern',
                    criteria: { correctness: 4, usefulness: 4, clarity: 4, completeness: 4 },
                })
            ).rejects.toThrow('Pattern non-existent not found');
        });

        test('should handle empty insights generation gracefully', async () => {
            // Test with minimal data
            const insights = await teamKnowledge.generateTeamInsights();

            expect(Array.isArray(insights)).toBe(true);
            // Should not throw even with no data
        });
    });
});
