/**
 * Plugin Manager - Core system for loading, managing, and orchestrating plugins
 * Provides secure, performant plugin execution with comprehensive lifecycle management
 */

import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { performance } from 'perf_hooks';
import type { Worker } from 'worker_threads';
import type { SharedServices } from '../core/services/index.js';

import { type CoreConfig, type EventBus, LayerMetrics } from '../core/types.js';
import {
    AnalysisPlugin,
    type BasePlugin,
    IntegrationPlugin,
    LanguagePlugin,
    LayerPlugin,
    LogLevel,
    NewLayerPlugin,
    type PerformanceBudget,
    type PluginConfig,
    type PluginContext,
    type PluginEvent,
    type PluginHealthStatus,
    PluginLoadPhase,
    type PluginManifest,
    type PluginPerformanceMetrics,
    PluginState,
    type PluginType,
    ProtocolPlugin,
    type SecurityCapabilities,
} from './plugin-api.js';

// ============================================================================
// Plugin Registry and Discovery
// ============================================================================

export interface PluginRegistry {
    plugins: Map<string, LoadedPlugin>;
    manifests: Map<string, PluginManifest>;
    configs: Map<string, PluginConfig>;
    states: Map<string, PluginState>;
    workers: Map<string, Worker>;
    performance: Map<string, PluginPerformanceMetrics>;
}

export interface LoadedPlugin {
    manifest: PluginManifest;
    instance?: BasePlugin;
    worker?: Worker;
    context: PluginContext;
    config: PluginConfig;
    state: PluginState;
    healthStatus: PluginHealthStatus;
    lastError?: Error;
    loadedAt: number;
    activatedAt?: number;
}

export interface PluginDiscoveryOptions {
    directories: string[];
    includeDevPlugins: boolean;
    includeDisabled: boolean;
    filterByType?: PluginType[];
    filterByCategory?: string[];
}

export interface PluginLoadOptions {
    skipValidation?: boolean;
    sandboxed?: boolean;
    enableHotReload?: boolean;
    customConfig?: Partial<PluginConfig>;
    maxRetries?: number;
    loadTimeout?: number;
}

// ============================================================================
// Plugin Manager Implementation
// ============================================================================

export class PluginManager extends EventEmitter {
    private registry: PluginRegistry;
    private coreConfig: CoreConfig;
    private sharedServices: SharedServices;
    private eventBus: EventBus;
    private validator: PluginValidator;
    private securityManager: PluginSecurityManager;
    private performanceMonitor: PluginPerformanceMonitor;

    private initialized = false;
    private pluginDirectories: string[] = [];
    private watchedDirectories: Map<string, fs.FSWatcher> = new Map();
    private healthCheckTimer?: NodeJS.Timeout;
    private performanceReportTimer?: NodeJS.Timeout;

    constructor(coreConfig: CoreConfig, sharedServices: SharedServices, eventBus: EventBus) {
        super();
        this.coreConfig = coreConfig;
        this.sharedServices = sharedServices;
        this.eventBus = eventBus;

        this.registry = {
            plugins: new Map(),
            manifests: new Map(),
            configs: new Map(),
            states: new Map(),
            workers: new Map(),
            performance: new Map(),
        };

        this.validator = new PluginValidator();
        this.securityManager = new PluginSecurityManager();
        this.performanceMonitor = new PluginPerformanceMonitor();

        this.setupEventHandlers();
    }

    // ============================================================================
    // Initialization and Lifecycle
    // ============================================================================

    async initialize(pluginDirectories: string[] = []): Promise<void> {
        if (this.initialized) {
            throw new Error('PluginManager already initialized');
        }

        this.pluginDirectories = [
            ...pluginDirectories,
            path.join(process.cwd(), 'plugins'),
            path.join(process.cwd(), 'node_modules'),
            path.join(__dirname, '../../plugins'),
        ];

        // Start background services
        this.startHealthChecks();
        this.startPerformanceReporting();

        // Discover and load plugins
        await this.discoverPlugins({
            directories: this.pluginDirectories,
            includeDevPlugins: this.coreConfig.development?.enableDevPlugins || false,
            includeDisabled: false,
        });

        this.initialized = true;
        this.emit('initialized');
    }

    async dispose(): Promise<void> {
        if (!this.initialized) return;

        // Stop background services
        this.stopHealthChecks();
        this.stopPerformanceReporting();

        // Unload all plugins
        const unloadPromises = Array.from(this.registry.plugins.keys()).map((id) => this.unloadPlugin(id));

        await Promise.allSettled(unloadPromises);

        // Close file watchers
        for (const watcher of this.watchedDirectories.values()) {
            watcher.close();
        }
        this.watchedDirectories.clear();

        this.initialized = false;
        this.emit('disposed');
    }

    // ============================================================================
    // Plugin Discovery
    // ============================================================================

    async discoverPlugins(options: PluginDiscoveryOptions): Promise<PluginManifest[]> {
        const discovered: PluginManifest[] = [];

        for (const directory of options.directories) {
            try {
                const plugins = await this.scanDirectory(directory, options);
                discovered.push(...plugins);
            } catch (error) {
                this.emit('discovery-error', { directory, error });
            }
        }

        // Filter and validate discovered plugins
        const validPlugins = await this.validateDiscoveredPlugins(discovered);

        // Auto-load enabled plugins
        const autoLoadPromises = validPlugins
            .filter((manifest) => this.shouldAutoLoad(manifest))
            .map((manifest) => this.loadPlugin(manifest.id));

        await Promise.allSettled(autoLoadPromises);

        this.emit('discovery-complete', { count: discovered.length, loaded: validPlugins.length });
        return validPlugins;
    }

    private async scanDirectory(directory: string, options: PluginDiscoveryOptions): Promise<PluginManifest[]> {
        const manifests: PluginManifest[] = [];

        try {
            const entries = await fs.readdir(directory, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const pluginPath = path.join(directory, entry.name);
                    const manifestPath = path.join(pluginPath, 'plugin.json');

                    try {
                        const manifestContent = await fs.readFile(manifestPath, 'utf8');
                        const manifest = JSON.parse(manifestContent) as PluginManifest;

                        // Apply filters
                        if (options.filterByType && !options.filterByType.includes(manifest.type)) {
                            continue;
                        }
                        if (options.filterByCategory && !options.filterByCategory.includes(manifest.category)) {
                            continue;
                        }

                        // Add plugin directory path
                        manifest.metadata = manifest.metadata || {};
                        manifest.metadata.pluginPath = pluginPath;

                        manifests.push(manifest);
                    } catch (error) {}
                }
            }
        } catch (error) {
            // Directory doesn't exist or can't be read
            return [];
        }

        return manifests;
    }

    private async validateDiscoveredPlugins(manifests: PluginManifest[]): Promise<PluginManifest[]> {
        const validationPromises = manifests.map(async (manifest) => {
            try {
                const result = await this.validator.validateManifest(manifest);
                return result.valid ? manifest : null;
            } catch (error) {
                this.emit('validation-error', { pluginId: manifest.id, error });
                return null;
            }
        });

        const results = await Promise.allSettled(validationPromises);
        return results
            .filter((result) => result.status === 'fulfilled' && result.value !== null)
            .map((result) => (result as PromiseFulfilledResult<PluginManifest>).value);
    }

    private shouldAutoLoad(manifest: PluginManifest): boolean {
        // Check if plugin is enabled in configuration
        const pluginConfig = this.coreConfig.plugins?.[manifest.id];
        return pluginConfig?.enabled !== false;
    }

    // ============================================================================
    // Plugin Loading and Unloading
    // ============================================================================

    async loadPlugin(pluginId: string, options: PluginLoadOptions = {}): Promise<boolean> {
        try {
            this.setPluginState(pluginId, PluginState.LOADING);

            const manifest = this.registry.manifests.get(pluginId);
            if (!manifest) {
                throw new Error(`Plugin manifest not found: ${pluginId}`);
            }

            // Validate plugin before loading
            if (!options.skipValidation) {
                const validationResult = await this.validator.validatePlugin(manifest);
                if (!validationResult.valid) {
                    throw new Error(`Plugin validation failed: ${validationResult.errors.join(', ')}`);
                }
            }

            // Create plugin context
            const context = await this.createPluginContext(pluginId, manifest);
            const config = this.createPluginConfig(manifest, options.customConfig);

            // Load plugin instance
            const instance = await this.instantiatePlugin(manifest, context, config);

            // Create loaded plugin record
            const loadedPlugin: LoadedPlugin = {
                manifest,
                instance,
                context,
                config,
                state: PluginState.LOADED,
                healthStatus: this.createInitialHealthStatus(pluginId),
                loadedAt: Date.now(),
            };

            // Store in registry
            this.registry.plugins.set(pluginId, loadedPlugin);
            this.registry.configs.set(pluginId, config);

            // Initialize plugin
            await this.initializePlugin(pluginId);

            // Activate plugin if configured
            if (config.enabled) {
                await this.activatePlugin(pluginId);
            }

            this.emit('plugin-loaded', { pluginId, manifest });
            return true;
        } catch (error) {
            this.setPluginState(pluginId, PluginState.ERROR);
            this.emit('plugin-load-error', { pluginId, error });
            return false;
        }
    }

    async unloadPlugin(pluginId: string): Promise<boolean> {
        try {
            const plugin = this.registry.plugins.get(pluginId);
            if (!plugin) {
                return false; // Plugin not loaded
            }

            // Deactivate if active
            if (plugin.state === PluginState.ACTIVE) {
                await this.deactivatePlugin(pluginId);
            }

            // Call plugin cleanup
            if (plugin.instance) {
                await plugin.instance.onUnload();
            }

            // Cleanup worker if sandboxed
            if (plugin.worker) {
                plugin.worker.terminate();
                this.registry.workers.delete(pluginId);
            }

            // Remove from registry
            this.registry.plugins.delete(pluginId);
            this.registry.configs.delete(pluginId);
            this.registry.states.delete(pluginId);
            this.registry.performance.delete(pluginId);

            this.emit('plugin-unloaded', { pluginId });
            return true;
        } catch (error) {
            this.emit('plugin-unload-error', { pluginId, error });
            return false;
        }
    }

    // ============================================================================
    // Plugin Activation and Deactivation
    // ============================================================================

    async activatePlugin(pluginId: string): Promise<boolean> {
        try {
            const plugin = this.registry.plugins.get(pluginId);
            if (!plugin || plugin.state !== PluginState.READY) {
                return false;
            }

            this.setPluginState(pluginId, PluginState.ACTIVE);

            if (plugin.instance) {
                await plugin.instance.onActivate();
            }

            plugin.activatedAt = Date.now();
            this.emit('plugin-activated', { pluginId });
            return true;
        } catch (error) {
            this.setPluginState(pluginId, PluginState.ERROR);
            this.emit('plugin-activation-error', { pluginId, error });
            return false;
        }
    }

    async deactivatePlugin(pluginId: string): Promise<boolean> {
        try {
            const plugin = this.registry.plugins.get(pluginId);
            if (!plugin || plugin.state !== PluginState.ACTIVE) {
                return false;
            }

            if (plugin.instance) {
                await plugin.instance.onDeactivate();
            }

            this.setPluginState(pluginId, PluginState.READY);
            this.emit('plugin-deactivated', { pluginId });
            return true;
        } catch (error) {
            this.emit('plugin-deactivation-error', { pluginId, error });
            return false;
        }
    }

    private async initializePlugin(pluginId: string): Promise<void> {
        const plugin = this.registry.plugins.get(pluginId);
        if (!plugin || !plugin.instance) {
            throw new Error(`Plugin not found or not loaded: ${pluginId}`);
        }

        this.setPluginState(pluginId, PluginState.INITIALIZING);

        try {
            await plugin.instance.onInitialize(plugin.config);
            this.setPluginState(pluginId, PluginState.READY);
        } catch (error) {
            this.setPluginState(pluginId, PluginState.ERROR);
            plugin.lastError = error as Error;
            throw error;
        }
    }

    // ============================================================================
    // Plugin Instance Management
    // ============================================================================

    private async instantiatePlugin(
        manifest: PluginManifest,
        context: PluginContext,
        config: PluginConfig
    ): Promise<BasePlugin> {
        const pluginPath = manifest.metadata?.pluginPath;
        if (!pluginPath) {
            throw new Error(`Plugin path not found for: ${manifest.id}`);
        }

        const mainFile = path.resolve(pluginPath, manifest.main);

        // Check if file exists
        try {
            await fs.access(mainFile);
        } catch (error) {
            throw new Error(`Plugin main file not found: ${mainFile}`);
        }

        // Load plugin module
        const pluginModule = await import(mainFile);
        const PluginClass = pluginModule.default || pluginModule[manifest.name];

        if (!PluginClass) {
            throw new Error(`Plugin class not found in: ${mainFile}`);
        }

        // Create instance
        const instance = new PluginClass(context, config);

        // Validate instance implements required interface
        this.validatePluginInstance(instance, manifest);

        return instance;
    }

    private validatePluginInstance(instance: any, manifest: PluginManifest): void {
        const requiredMethods = ['onLoad', 'onInitialize', 'onActivate', 'onDeactivate', 'onUnload', 'onHealthCheck'];

        for (const method of requiredMethods) {
            if (typeof instance[method] !== 'function') {
                throw new Error(`Plugin ${manifest.id} missing required method: ${method}`);
            }
        }

        // Type-specific validation
        switch (manifest.type) {
            case 'layer':
                if (typeof instance.process !== 'function') {
                    throw new Error(`Layer plugin ${manifest.id} missing process method`);
                }
                break;
            case 'protocol':
                if (typeof instance.initialize !== 'function' || typeof instance.handleRequest !== 'function') {
                    throw new Error(`Protocol plugin ${manifest.id} missing required methods`);
                }
                break;
            case 'language':
                if (!instance.parser || !instance.analyzer) {
                    throw new Error(`Language plugin ${manifest.id} missing parser or analyzer`);
                }
                break;
        }
    }

    // ============================================================================
    // Plugin Context and Configuration
    // ============================================================================

    private async createPluginContext(pluginId: string, manifest: PluginManifest): Promise<PluginContext> {
        const workspacePath = this.coreConfig.workspace?.root || process.cwd();

        return {
            pluginId,
            workspacePath,
            logger: new PluginLogger(pluginId, this.coreConfig.logging?.level || LogLevel.INFO),
            eventBus: new PluginEventBus(pluginId, this.eventBus),
            storage: new PluginStorage(pluginId, this.sharedServices),
            cache: new PluginCache(pluginId, this.sharedServices),
            core: new CoreAPIProxy(this.sharedServices, this.securityManager.getCapabilities(pluginId)),
            config: {} as PluginConfig, // Will be set after creation
            performance: new PluginPerformanceTracker(pluginId, this.performanceMonitor),

            createTimer: (name: string) => new PluginTimer(name),
            reportMetrics: (metrics: Record<string, number>) => {
                this.performanceMonitor.recordMetrics(pluginId, metrics);
            },
            requestPermission: async (capability: string) => {
                return this.securityManager.checkPermission(pluginId, capability);
            },
        };
    }

    private createPluginConfig(manifest: PluginManifest, customConfig?: Partial<PluginConfig>): PluginConfig {
        const defaultConfig = manifest.defaultConfig || {};
        const globalConfig = this.coreConfig.plugins?.[manifest.id] || {};

        return {
            enabled: true,
            priority: 100,
            timeout: 30000,
            retries: 3,

            logging: {
                level: LogLevel.INFO,
                destination: 'console',
                includeStackTrace: false,
            },

            performance: {
                maxMemoryMB: manifest.performance.maxMemoryMB,
                maxCpuPercent: manifest.performance.maxCpuPercent,
                cacheEnabled: true,
                cacheSizeMB: 10,
                cacheTtlMs: 300000,
            },

            security: {
                allowedHosts: manifest.capabilities.network.outbound,
                allowedPaths: [...manifest.capabilities.filesystem.read, ...manifest.capabilities.filesystem.write],
                restrictedApis: [],
            },

            custom: {
                ...defaultConfig,
                ...globalConfig,
                ...customConfig,
            },
        };
    }

    // ============================================================================
    // Plugin State Management
    // ============================================================================

    private setPluginState(pluginId: string, state: PluginState): void {
        this.registry.states.set(pluginId, state);

        const plugin = this.registry.plugins.get(pluginId);
        if (plugin) {
            plugin.state = state;
        }

        this.emit('plugin-state-changed', { pluginId, state });
    }

    getPluginState(pluginId: string): PluginState | undefined {
        return this.registry.states.get(pluginId);
    }

    getAllPluginStates(): Map<string, PluginState> {
        return new Map(this.registry.states);
    }

    // ============================================================================
    // Plugin Registry Access
    // ============================================================================

    getPlugin(pluginId: string): LoadedPlugin | undefined {
        return this.registry.plugins.get(pluginId);
    }

    getAllPlugins(): LoadedPlugin[] {
        return Array.from(this.registry.plugins.values());
    }

    getPluginsByType(type: PluginType): LoadedPlugin[] {
        return this.getAllPlugins().filter((plugin) => plugin.manifest.type === type);
    }

    getActivePlugins(): LoadedPlugin[] {
        return this.getAllPlugins().filter((plugin) => plugin.state === PluginState.ACTIVE);
    }

    getPluginManifest(pluginId: string): PluginManifest | undefined {
        return this.registry.manifests.get(pluginId);
    }

    // ============================================================================
    // Health Monitoring
    // ============================================================================

    private startHealthChecks(): void {
        this.healthCheckTimer = setInterval(() => {
            this.performHealthChecks();
        }, 30000); // Check every 30 seconds
        this.healthCheckTimer?.unref?.();
    }

    private stopHealthChecks(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
        }
    }

    private async performHealthChecks(): Promise<void> {
        const activePlugins = this.getActivePlugins();

        const healthPromises = activePlugins.map(async (plugin) => {
            try {
                if (plugin.instance) {
                    const healthStatus = await plugin.instance.onHealthCheck();
                    plugin.healthStatus = healthStatus;

                    // Update performance metrics
                    this.performanceMonitor.recordHealthCheck(plugin.manifest.id, healthStatus);

                    // Emit health events
                    if (healthStatus.status === 'unhealthy') {
                        this.emit('plugin-unhealthy', { pluginId: plugin.manifest.id, healthStatus });
                    }
                }
            } catch (error) {
                plugin.healthStatus = {
                    status: 'unhealthy',
                    latency: -1,
                    errorRate: 1.0,
                    memoryUsage: 0,
                    cpuUsage: 0,
                    lastCheck: Date.now(),
                    details: `Health check failed: ${error.message}`,
                    metrics: {},
                };
            }
        });

        await Promise.allSettled(healthPromises);
    }

    async getSystemHealth(): Promise<{ overall: string; plugins: Record<string, PluginHealthStatus> }> {
        const plugins: Record<string, PluginHealthStatus> = {};
        let healthyCount = 0;
        let totalCount = 0;

        for (const plugin of this.getActivePlugins()) {
            plugins[plugin.manifest.id] = plugin.healthStatus;
            totalCount++;

            if (plugin.healthStatus.status === 'healthy') {
                healthyCount++;
            }
        }

        const healthRatio = totalCount > 0 ? healthyCount / totalCount : 1;
        const overall = healthRatio >= 0.8 ? 'healthy' : healthRatio >= 0.5 ? 'degraded' : 'unhealthy';

        return { overall, plugins };
    }

    // ============================================================================
    // Performance Monitoring
    // ============================================================================

    private startPerformanceReporting(): void {
        this.performanceReportTimer = setInterval(() => {
            this.generatePerformanceReport();
        }, 60000); // Report every minute
        this.performanceReportTimer?.unref?.();
    }

    private stopPerformanceReporting(): void {
        if (this.performanceReportTimer) {
            clearInterval(this.performanceReportTimer);
            this.performanceReportTimer = undefined;
        }
    }

    private generatePerformanceReport(): void {
        const report = this.performanceMonitor.generateReport();
        this.emit('performance-report', report);

        // Check for performance violations
        for (const [pluginId, metrics] of Object.entries(report.plugins)) {
            const manifest = this.getPluginManifest(pluginId);
            if (manifest && this.hasPerformanceViolation(metrics, manifest.performance)) {
                this.emit('performance-violation', { pluginId, metrics, budget: manifest.performance });
            }
        }
    }

    private hasPerformanceViolation(metrics: PluginPerformanceMetrics, budget: PerformanceBudget): boolean {
        return (
            metrics.averageLatency > budget.maxLatencyMs ||
            metrics.memoryUsage > budget.maxMemoryMB * 1024 * 1024 ||
            metrics.cpuUsage > budget.maxCpuPercent ||
            (budget.cacheHitRateMin && metrics.cacheHitRate < budget.cacheHitRateMin)
        );
    }

    getPerformanceMetrics(): Record<string, PluginPerformanceMetrics> {
        return this.performanceMonitor.getAllMetrics();
    }

    // ============================================================================
    // Event Handling
    // ============================================================================

    private setupEventHandlers(): void {
        // Handle core system events
        this.eventBus.on('core-shutdown', () => {
            this.dispose();
        });

        this.eventBus.on('config-changed', (event: any) => {
            this.handleConfigChange(event);
        });

        // Handle plugin events
        this.on('plugin-load-error', (event) => {
            console.error(`Failed to load plugin ${event.pluginId}:`, event.error);
        });

        this.on('plugin-unhealthy', (event) => {
            console.warn(`Plugin ${event.pluginId} is unhealthy:`, event.healthStatus.details);
        });

        this.on('performance-violation', (event) => {
            console.warn(`Plugin ${event.pluginId} exceeded performance budget:`, event.metrics);
        });
    }

    private async handleConfigChange(event: { pluginId?: string; config: any }): Promise<void> {
        if (event.pluginId) {
            // Plugin-specific config change
            const plugin = this.getPlugin(event.pluginId);
            if (plugin && plugin.instance) {
                const newConfig = this.createPluginConfig(plugin.manifest, event.config);
                plugin.config = newConfig;
                this.registry.configs.set(event.pluginId, newConfig);

                try {
                    await plugin.instance.onConfigChange(newConfig);
                } catch (error) {
                    this.emit('plugin-config-error', { pluginId: event.pluginId, error });
                }
            }
        } else {
            // Global config change - may affect multiple plugins
            this.coreConfig = { ...this.coreConfig, ...event.config };
        }
    }

    // ============================================================================
    // Utility Methods
    // ============================================================================

    private createInitialHealthStatus(pluginId: string): PluginHealthStatus {
        return {
            status: 'healthy',
            latency: 0,
            errorRate: 0,
            memoryUsage: 0,
            cpuUsage: 0,
            lastCheck: Date.now(),
            metrics: {},
        };
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    getPluginCount(): number {
        return this.registry.plugins.size;
    }

    getActivePluginCount(): number {
        return this.getActivePlugins().length;
    }
}

// ============================================================================
// Supporting Classes
// ============================================================================

class PluginValidator {
    async validateManifest(manifest: PluginManifest): Promise<{ valid: boolean; errors: string[] }> {
        const errors: string[] = [];

        // Required fields
        if (!manifest.id) errors.push('Missing required field: id');
        if (!manifest.name) errors.push('Missing required field: name');
        if (!manifest.version) errors.push('Missing required field: version');
        if (!manifest.type) errors.push('Missing required field: type');
        if (!manifest.main) errors.push('Missing required field: main');

        // Version format
        if (manifest.version && !this.isValidSemver(manifest.version)) {
            errors.push('Invalid semantic version format');
        }

        // Capabilities validation
        if (!manifest.capabilities) {
            errors.push('Missing required field: capabilities');
        }

        return { valid: errors.length === 0, errors };
    }

    async validatePlugin(manifest: PluginManifest): Promise<{ valid: boolean; errors: string[] }> {
        // First validate manifest
        const manifestResult = await this.validateManifest(manifest);
        if (!manifestResult.valid) {
            return manifestResult;
        }

        // Additional plugin-specific validation would go here
        return { valid: true, errors: [] };
    }

    private isValidSemver(version: string): boolean {
        const semverRegex =
            /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
        return semverRegex.test(version);
    }
}

class PluginSecurityManager {
    private capabilities: Map<string, SecurityCapabilities> = new Map();

    getCapabilities(pluginId: string): SecurityCapabilities | undefined {
        return this.capabilities.get(pluginId);
    }

    setCapabilities(pluginId: string, capabilities: SecurityCapabilities): void {
        this.capabilities.set(pluginId, capabilities);
    }

    async checkPermission(pluginId: string, capability: string): Promise<boolean> {
        const caps = this.capabilities.get(pluginId);
        if (!caps) return false;

        // Implement permission checking logic
        return true; // Simplified for now
    }
}

class PluginPerformanceMonitor {
    private metrics: Map<string, PluginPerformanceMetrics> = new Map();

    recordMetrics(pluginId: string, metrics: Record<string, number>): void {
        // Implementation would record and aggregate metrics
    }

    recordHealthCheck(pluginId: string, healthStatus: PluginHealthStatus): void {
        // Implementation would update health metrics
    }

    getAllMetrics(): Record<string, PluginPerformanceMetrics> {
        return Object.fromEntries(this.metrics);
    }

    generateReport(): { overall: any; plugins: Record<string, PluginPerformanceMetrics> } {
        return {
            overall: {},
            plugins: this.getAllMetrics(),
        };
    }
}

// Utility classes for plugin context
class PluginLogger {
    constructor(
        private pluginId: string,
        private level: LogLevel
    ) {}

    trace(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.TRACE) console.log(`[${this.pluginId}] TRACE:`, message, ...args);
    }

    debug(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.DEBUG) console.log(`[${this.pluginId}] DEBUG:`, message, ...args);
    }

    info(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.INFO) console.log(`[${this.pluginId}] INFO:`, message, ...args);
    }

    warn(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.WARN) console.warn(`[${this.pluginId}] WARN:`, message, ...args);
    }

    error(message: string, error?: Error, ...args: any[]): void {
        if (this.level <= LogLevel.ERROR) {
            console.error(`[${this.pluginId}] ERROR:`, message, error, ...args);
        }
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }
}

class PluginEventBus extends EventEmitter {
    constructor(
        private pluginId: string,
        private coreEventBus: EventBus
    ) {
        super();
    }

    async publish(event: PluginEvent): Promise<void> {
        event.pluginId = this.pluginId;
        this.emit(event.type, event);
        this.coreEventBus.emit('plugin-event', event);
    }

    subscribe(eventType: string, handler: any): void {
        this.on(eventType, handler);
    }

    unsubscribe(eventType: string, handler: any): void {
        this.off(eventType, handler);
    }

    subscribeToCore(eventType: string, handler: any): void {
        this.coreEventBus.on(eventType, handler);
    }
}

class PluginStorage {
    constructor(
        private pluginId: string,
        private sharedServices: SharedServices
    ) {}

    async get<T>(key: string): Promise<T | undefined> {
        // Implementation would use shared storage service
        return undefined;
    }

    async set<T>(key: string, value: T): Promise<void> {
        // Implementation would use shared storage service
    }

    async delete(key: string): Promise<void> {
        // Implementation would use shared storage service
    }

    async clear(): Promise<void> {
        // Implementation would use shared storage service
    }

    async keys(): Promise<string[]> {
        // Implementation would use shared storage service
        return [];
    }

    async exists(key: string): Promise<boolean> {
        // Implementation would use shared storage service
        return false;
    }
}

class PluginCache {
    constructor(
        private pluginId: string,
        private sharedServices: SharedServices
    ) {}

    async get<T>(key: string): Promise<T | undefined> {
        // Implementation would use shared cache service
        return undefined;
    }

    async set<T>(key: string, value: T, ttl?: number): Promise<void> {
        // Implementation would use shared cache service
    }

    async delete(key: string): Promise<void> {
        // Implementation would use shared cache service
    }

    async clear(): Promise<void> {
        // Implementation would use shared cache service
    }

    async stats(): Promise<any> {
        // Implementation would return cache statistics
        return {};
    }
}

class CoreAPIProxy {
    constructor(
        private sharedServices: SharedServices,
        private capabilities?: SecurityCapabilities
    ) {}

    // Implementation would provide secure, controlled access to core APIs
    async findDefinition(identifier: string, uri: string, position?: any): Promise<any[]> {
        // Secure proxy to core definition finding
        return [];
    }

    // ... other core API methods would be implemented here
}

class PluginPerformanceTracker {
    constructor(
        private pluginId: string,
        private monitor: PluginPerformanceMonitor
    ) {}

    startOperation(name: string): any {
        return new PluginTimer(name);
    }

    recordLatency(operation: string, latency: number): void {
        this.monitor.recordMetrics(this.pluginId, { [`${operation}_latency`]: latency });
    }

    recordMemoryUsage(bytes: number): void {
        this.monitor.recordMetrics(this.pluginId, { memory_usage: bytes });
    }

    recordCacheHit(key: string): void {
        this.monitor.recordMetrics(this.pluginId, { cache_hits: 1 });
    }

    recordCacheMiss(key: string): void {
        this.monitor.recordMetrics(this.pluginId, { cache_misses: 1 });
    }

    getMetrics(): any {
        return {};
    }
}

class PluginTimer {
    private startTime?: number;

    constructor(private name: string) {}

    start(): void {
        this.startTime = performance.now();
    }

    stop(): number {
        if (!this.startTime) return 0;
        const duration = performance.now() - this.startTime;
        this.startTime = undefined;
        return duration;
    }

    reset(): void {
        this.startTime = undefined;
    }

    elapsed(): number {
        if (!this.startTime) return 0;
        return performance.now() - this.startTime;
    }
}

export default PluginManager;
