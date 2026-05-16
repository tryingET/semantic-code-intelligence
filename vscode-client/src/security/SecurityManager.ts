/**
 * Security Manager
 * Handles sensitive pattern filtering, privacy protection, and secure communication
 * 
 * Fifth-order consideration: Prevents exposure of proprietary patterns and secrets
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ConfigurationManager } from '../config/ConfigurationManager';

export class SecurityManager {
    private sensitivePatterns: RegExp[] = [
        // API keys and tokens
        /(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|bearer)\s*[:=]\s*['"][^'"]+['"]/gi,
        // Passwords
        /(?:password|passwd|pwd|pass)\s*[:=]\s*['"][^'"]+['"]/gi,
        // Private keys
        /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
        // AWS credentials
        /(?:aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*['"][^'"]+['"]/gi,
        // Database connection strings
        /(?:mongodb|postgres|mysql|redis):\/\/[^'"\s]+/gi,
        // JWT tokens
        /eyJ[a-zA-Z0-9-_]+\.eyJ[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+/g
    ];
    
    private trustedDomains: Set<string> = new Set([
        'localhost',
        '127.0.0.1',
        '::1'
    ]);
    
    private encryptionKey: Buffer | null = null;
    private securityLevel: 'low' | 'medium' | 'high' = 'medium';
    
    constructor(private config: ConfigurationManager) {}
    
    async initialize(): Promise<void> {
        // Generate or load encryption key for sensitive data
        this.encryptionKey = await this.getOrCreateEncryptionKey();
        
        // Determine security level based on environment
        this.securityLevel = this.determineSecurityLevel();
        
        // Load custom sensitive patterns from workspace settings
        await this.loadCustomPatterns();
        
        // Setup file watcher for security configuration
        this.setupSecurityWatcher();
    }
    
    /**
     * Filter sensitive information from patterns before learning
     */
    filterSensitivePatterns(code: string): string {
        let filtered = code;
        
        for (const pattern of this.sensitivePatterns) {
            filtered = filtered.replace(pattern, (match) => {
                // Replace with placeholder maintaining structure
                return match.replace(/['"][^'"]+['"]/, '["<REDACTED>"]');
            });
        }
        
        return filtered;
    }
    
    /**
     * Check if a file should be excluded from analysis for security reasons
     */
    shouldExcludeFile(uri: vscode.Uri): boolean {
        const path = uri.fsPath.toLowerCase();
        
        // Exclude known sensitive files
        const sensitiveFiles = [
            '.env',
            '.env.local',
            '.env.production',
            'secrets.json',
            'credentials.json',
            'private.key',
            'id_rsa',
            '.npmrc',
            '.netrc'
        ];
        
        return sensitiveFiles.some(file => path.endsWith(file));
    }
    
    /**
     * Validate if a pattern is safe to share with team
     */
    isPatternSafeToShare(pattern: any): boolean {
        if (this.securityLevel === 'high') {
            // In high security mode, require explicit approval
            return pattern.approved === true;
        }
        
        // Check pattern content for sensitive information
        const content = JSON.stringify(pattern);
        
        for (const sensitivePattern of this.sensitivePatterns) {
            if (sensitivePattern.test(content)) {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * Encrypt sensitive data before storage
     */
    encrypt(data: string): string {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not initialized');
        }
        
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    }
    
    /**
     * Decrypt sensitive data from storage
     */
    decrypt(encryptedData: string): string {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not initialized');
        }
        
        const parts = encryptedData.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }
    
    /**
     * Validate connection to language server
     */
    validateConnection(host: string, port: number): boolean {
        // Only allow connections to trusted domains
        if (!this.trustedDomains.has(host)) {
            vscode.window.showWarningMessage(
                `Untrusted connection attempt to ${host}:${port}`
            );
            return false;
        }
        
        return true;
    }
    
    /**
     * Get current security level for server communication
     */
    getSecurityLevel(): string {
        return this.securityLevel;
    }
    
    /**
     * Generate audit log entry for security events
     */
    auditLog(event: string, details: any): void {
        const entry = {
            timestamp: new Date().toISOString(),
            event,
            details,
            user: process.env.USER || 'unknown',
            workspace: vscode.workspace.name
        };
        
        // In production, this would send to a secure audit service
        console.log('[AUDIT]', JSON.stringify(entry));
    }
    
    private async getOrCreateEncryptionKey(): Promise<Buffer> {
        const context = this.config['context'];
        const keyId = 'ontology.encryptionKey';
        
        let key = context.globalState.get<string>(keyId);
        
        if (!key) {
            // Generate new key
            const newKey = crypto.randomBytes(32);
            key = newKey.toString('base64');
            await context.globalState.update(keyId, key);
            
            this.auditLog('encryption_key_generated', {
                timestamp: new Date().toISOString()
            });
        }
        
        return Buffer.from(key, 'base64');
    }
    
    private determineSecurityLevel(): 'low' | 'medium' | 'high' {
        // Check for enterprise environment indicators
        if (process.env.ENTERPRISE_MODE === 'true') {
            return 'high';
        }
        
        // Check for sensitive workspace indicators
        const workspaceName = vscode.workspace.name?.toLowerCase() || '';
        const sensitiveKeywords = ['production', 'prod', 'finance', 'banking', 'healthcare'];
        
        if (sensitiveKeywords.some(keyword => workspaceName.includes(keyword))) {
            return 'high';
        }
        
        // Default to medium security
        return 'medium';
    }
    
    private async loadCustomPatterns(): Promise<void> {
        const customPatterns = this.config.get<string[]>('security.sensitivePatterns', []);
        
        for (const pattern of customPatterns) {
            try {
                this.sensitivePatterns.push(new RegExp(pattern, 'gi'));
            } catch (error) {
                console.error(`Invalid security pattern: ${pattern}`, error);
            }
        }
    }
    
    private setupSecurityWatcher(): void {
        const watcher = vscode.workspace.createFileSystemWatcher('**/.ontologysecurity');
        
        watcher.onDidCreate(async (uri) => {
            await this.loadSecurityConfig(uri);
        });
        
        watcher.onDidChange(async (uri) => {
            await this.loadSecurityConfig(uri);
        });
    }
    
    private async loadSecurityConfig(uri: vscode.Uri): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const content = document.getText();
            const config = JSON.parse(content);
            
            if (config.sensitivePatterns) {
                for (const pattern of config.sensitivePatterns) {
                    this.sensitivePatterns.push(new RegExp(pattern, 'gi'));
                }
            }
            
            if (config.trustedDomains) {
                for (const domain of config.trustedDomains) {
                    this.trustedDomains.add(domain);
                }
            }
            
            this.auditLog('security_config_loaded', {
                source: uri.toString(),
                patterns: config.sensitivePatterns?.length || 0,
                domains: config.trustedDomains?.length || 0
            });
        } catch (error) {
            console.error('Failed to load security config:', error);
        }
    }
}