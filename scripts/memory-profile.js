#!/usr/bin/env bun

/**
 * Memory Profiler for Ontology-LSP
 * Analyzes memory usage and provides optimization recommendations
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Helper function to format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Get process information
function getProcessInfo() {
    try {
        const psOutput = execSync("ps aux | grep -E '(src/servers|bun)' | grep -v grep", { encoding: 'utf8' });
        const lines = psOutput.trim().split('\n').filter(line => line.includes('src/servers'));
        
        const processes = lines.map(line => {
            const parts = line.trim().split(/\s+/);
            return {
                pid: parseInt(parts[1]),
                command: parts.slice(10).join(' '),
                cpu: parseFloat(parts[2]),
                memory: parseFloat(parts[3]),
                rss_kb: parseInt(parts[5]),
                vsz_kb: parseInt(parts[4])
            };
        });
        
        return processes;
    } catch (error) {
        console.error('Error getting process info:', error.message);
        return [];
    }
}

// Get detailed memory info for a specific process
function getDetailedMemoryInfo(pid) {
    try {
        const statusPath = `/proc/${pid}/status`;
        if (!fs.existsSync(statusPath)) {
            return null;
        }
        
        const statusContent = fs.readFileSync(statusPath, 'utf8');
        const memoryInfo = {};
        
        const relevantFields = [
            'VmSize', 'VmRSS', 'VmData', 'VmStk', 'VmExe', 'VmLib',
            'VmHWM', 'VmPTE', 'VmSwap'
        ];
        
        for (const field of relevantFields) {
            const match = statusContent.match(new RegExp(`${field}:\\s+(\\d+)\\s+kB`));
            if (match) {
                memoryInfo[field] = parseInt(match[1]) * 1024; // Convert to bytes
            }
        }
        
        return memoryInfo;
    } catch (error) {
        return null;
    }
}

// Analyze cache directory sizes
function analyzeCacheUsage() {
    const cacheAnalysis = {
        ontologyCache: 0,
        bunCache: 0,
        nodeModules: 0,
        totalCacheSize: 0
    };
    
    try {
        // Check .ontology directory
        const ontologyPath = '.ontology';
        if (fs.existsSync(ontologyPath)) {
            const ontologyStats = execSync(`du -sb ${ontologyPath} 2>/dev/null`, { encoding: 'utf8' });
            cacheAnalysis.ontologyCache = parseInt(ontologyStats.split('\t')[0]) || 0;
        }
        
        // Check node_modules
        if (fs.existsSync('node_modules')) {
            const nodeModulesStats = execSync('du -sb node_modules 2>/dev/null', { encoding: 'utf8' });
            cacheAnalysis.nodeModules = parseInt(nodeModulesStats.split('\t')[0]) || 0;
        }
        
        // Check bun cache (if accessible)
        const homeDir = process.env.HOME;
        const bunCachePath = path.join(homeDir, '.bun/install/cache');
        if (fs.existsSync(bunCachePath)) {
            try {
                const bunCacheStats = execSync(`du -sb "${bunCachePath}" 2>/dev/null`, { encoding: 'utf8' });
                cacheAnalysis.bunCache = parseInt(bunCacheStats.split('\t')[0]) || 0;
            } catch (error) {
                // Bun cache might not be accessible
            }
        }
        
        cacheAnalysis.totalCacheSize = cacheAnalysis.ontologyCache + cacheAnalysis.nodeModules;
        
    } catch (error) {
        console.error('Error analyzing cache usage:', error.message);
    }
    
    return cacheAnalysis;
}

// Get system memory information
function getSystemMemory() {
    try {
        const meminfoContent = fs.readFileSync('/proc/meminfo', 'utf8');
        const memoryInfo = {};
        
        const relevantFields = ['MemTotal', 'MemFree', 'MemAvailable', 'Buffers', 'Cached'];
        
        for (const field of relevantFields) {
            const match = meminfoContent.match(new RegExp(`${field}:\\s+(\\d+)\\s+kB`));
            if (match) {
                memoryInfo[field] = parseInt(match[1]) * 1024; // Convert to bytes
            }
        }
        
        return memoryInfo;
    } catch (error) {
        return null;
    }
}

// Check database size
function getDatabaseSize() {
    const dbSizes = {};
    const ontologyDir = '.ontology';
    
    if (fs.existsSync(ontologyDir)) {
        try {
            const files = fs.readdirSync(ontologyDir);
            for (const file of files) {
                if (file.endsWith('.db') || file.endsWith('.sqlite')) {
                    const filePath = path.join(ontologyDir, file);
                    const stats = fs.statSync(filePath);
                    dbSizes[file] = stats.size;
                }
            }
        } catch (error) {
            console.error('Error reading database sizes:', error.message);
        }
    }
    
    return dbSizes;
}

// Main profiling function
async function profileMemory() {
    console.log('🔍 Memory Profile Report for Ontology-LSP');
    console.log('=' .repeat(60));
    console.log(`Report generated: ${new Date().toISOString()}\n`);
    
    // Get process information
    const processes = getProcessInfo();
    
    if (processes.length === 0) {
        console.log('❌ No Ontology-LSP processes found');
        return;
    }
    
    console.log('📊 Running Processes:');
    console.log('-'.repeat(40));
    
    let totalRSS = 0;
    let totalVSZ = 0;
    
    for (const proc of processes) {
        console.log(`PID: ${proc.pid}`);
        console.log(`Command: ${proc.command}`);
        console.log(`CPU: ${proc.cpu}%`);
        console.log(`Memory: ${proc.memory}%`);
        console.log(`RSS: ${formatBytes(proc.rss_kb * 1024)}`);
        console.log(`VSZ: ${formatBytes(proc.vsz_kb * 1024)}`);
        
        const detailedInfo = getDetailedMemoryInfo(proc.pid);
        if (detailedInfo) {
            console.log(`Virtual Memory Size: ${formatBytes(detailedInfo.VmSize || 0)}`);
            console.log(`Physical Memory (RSS): ${formatBytes(detailedInfo.VmRSS || 0)}`);
            console.log(`Data Segment: ${formatBytes(detailedInfo.VmData || 0)}`);
            console.log(`Stack: ${formatBytes(detailedInfo.VmStk || 0)}`);
            console.log(`High Water Mark: ${formatBytes(detailedInfo.VmHWM || 0)}`);
            if (detailedInfo.VmSwap > 0) {
                console.log(`⚠️  Swap Usage: ${formatBytes(detailedInfo.VmSwap)}`);
            }
        }
        
        totalRSS += proc.rss_kb * 1024;
        totalVSZ += proc.vsz_kb * 1024;
        console.log('');
    }
    
    console.log('📈 Memory Summary:');
    console.log('-'.repeat(40));
    console.log(`Total Processes: ${processes.length}`);
    console.log(`Total RSS (Physical): ${formatBytes(totalRSS)}`);
    console.log(`Total VSZ (Virtual): ${formatBytes(totalVSZ)}`);
    console.log(`Average RSS per process: ${formatBytes(totalRSS / processes.length)}`);
    console.log('');
    
    // System memory information
    const systemMemory = getSystemMemory();
    if (systemMemory) {
        console.log('🖥️  System Memory:');
        console.log('-'.repeat(40));
        console.log(`Total: ${formatBytes(systemMemory.MemTotal)}`);
        console.log(`Available: ${formatBytes(systemMemory.MemAvailable)}`);
        console.log(`Free: ${formatBytes(systemMemory.MemFree)}`);
        console.log(`Used by System: ${formatBytes(systemMemory.MemTotal - systemMemory.MemAvailable)}`);
        console.log(`Ontology-LSP Usage: ${((totalRSS / systemMemory.MemTotal) * 100).toFixed(2)}% of total system memory`);
        console.log('');
    }
    
    // Cache analysis
    const cacheAnalysis = analyzeCacheUsage();
    console.log('💾 Cache Analysis:');
    console.log('-'.repeat(40));
    console.log(`Ontology Cache (.ontology): ${formatBytes(cacheAnalysis.ontologyCache)}`);
    console.log(`Node Modules: ${formatBytes(cacheAnalysis.nodeModules)}`);
    console.log(`Bun Cache: ${formatBytes(cacheAnalysis.bunCache)}`);
    console.log(`Total Project Cache: ${formatBytes(cacheAnalysis.totalCacheSize)}`);
    console.log('');
    
    // Database sizes
    const dbSizes = getDatabaseSize();
    if (Object.keys(dbSizes).length > 0) {
        console.log('🗄️  Database Sizes:');
        console.log('-'.repeat(40));
        let totalDbSize = 0;
        for (const [filename, size] of Object.entries(dbSizes)) {
            console.log(`${filename}: ${formatBytes(size)}`);
            totalDbSize += size;
        }
        console.log(`Total Database Size: ${formatBytes(totalDbSize)}`);
        console.log('');
    }
    
    // Memory analysis and recommendations
    console.log('🎯 Memory Analysis & Recommendations:');
    console.log('-'.repeat(60));
    
    const memoryEfficiencyScore = calculateMemoryEfficiency(totalRSS, processes.length);
    console.log(`Memory Efficiency Score: ${memoryEfficiencyScore}/10`);
    
    // Generate recommendations
    const recommendations = generateRecommendations(totalRSS, processes, cacheAnalysis, dbSizes);
    recommendations.forEach((rec, i) => {
        console.log(`${i + 1}. ${rec}`);
    });
    console.log('');
    
    // Memory hotspots
    identifyMemoryHotspots(processes, cacheAnalysis, dbSizes);
}

function calculateMemoryEfficiency(totalRSS, processCount) {
    // Score based on memory usage per process and overall efficiency
    const avgMemoryPerProcess = totalRSS / processCount;
    const baseScore = 10;
    
    // Deduct points for high memory usage
    let score = baseScore;
    
    if (avgMemoryPerProcess > 200 * 1024 * 1024) { // > 200MB per process
        score -= 3;
    } else if (avgMemoryPerProcess > 100 * 1024 * 1024) { // > 100MB per process
        score -= 1;
    }
    
    if (totalRSS > 1024 * 1024 * 1024) { // > 1GB total
        score -= 2;
    }
    
    return Math.max(1, score);
}

function generateRecommendations(totalRSS, processes, cacheAnalysis, dbSizes) {
    const recommendations = [];
    
    // Process-based recommendations
    if (processes.length > 5) {
        recommendations.push("Consider reducing the number of concurrent processes to decrease memory overhead");
    }
    
    const avgMemory = totalRSS / processes.length;
    if (avgMemory > 100 * 1024 * 1024) { // > 100MB per process
        recommendations.push("High memory usage per process detected. Consider implementing memory pooling for large objects");
    }
    
    // Cache-based recommendations
    if (cacheAnalysis.ontologyCache > 100 * 1024 * 1024) { // > 100MB
        recommendations.push("Large ontology cache detected. Consider implementing cache size limits and LRU eviction");
    }
    
    if (cacheAnalysis.nodeModules > 500 * 1024 * 1024) { // > 500MB
        recommendations.push("Large node_modules detected. Consider dependency analysis and tree-shaking");
    }
    
    // Database-based recommendations
    const totalDbSize = Object.values(dbSizes).reduce((sum, size) => sum + size, 0);
    if (totalDbSize > 50 * 1024 * 1024) { // > 50MB
        recommendations.push("Large database size detected. Consider implementing database cleanup routines");
    }
    
    // General recommendations
    if (totalRSS > 500 * 1024 * 1024) { // > 500MB total
        recommendations.push("High total memory usage. Consider implementing connection pooling and object reuse");
        recommendations.push("Review layer implementations for potential memory leaks or unnecessary data retention");
    }
    
    if (recommendations.length === 0) {
        recommendations.push("Memory usage appears optimal. Continue monitoring for gradual increases");
    }
    
    return recommendations;
}

function identifyMemoryHotspots(processes, cacheAnalysis, dbSizes) {
    console.log('🔥 Memory Hotspots:');
    console.log('-'.repeat(40));
    
    const hotspots = [];
    
    // Process hotspots
    processes.forEach(proc => {
        if (proc.rss_kb * 1024 > 150 * 1024 * 1024) { // > 150MB
            hotspots.push({
                type: 'Process',
                name: `PID ${proc.pid} (${proc.command.split(' ').pop()})`,
                size: proc.rss_kb * 1024,
                impact: 'High'
            });
        }
    });
    
    // Cache hotspots
    if (cacheAnalysis.ontologyCache > 50 * 1024 * 1024) { // > 50MB
        hotspots.push({
            type: 'Cache',
            name: 'Ontology Cache',
            size: cacheAnalysis.ontologyCache,
            impact: 'Medium'
        });
    }
    
    if (cacheAnalysis.nodeModules > 300 * 1024 * 1024) { // > 300MB
        hotspots.push({
            type: 'Dependencies',
            name: 'Node Modules',
            size: cacheAnalysis.nodeModules,
            impact: 'Low' // Expected to be large
        });
    }
    
    // Database hotspots
    Object.entries(dbSizes).forEach(([filename, size]) => {
        if (size > 20 * 1024 * 1024) { // > 20MB
            hotspots.push({
                type: 'Database',
                name: filename,
                size: size,
                impact: 'Medium'
            });
        }
    });
    
    // Sort by size
    hotspots.sort((a, b) => b.size - a.size);
    
    if (hotspots.length === 0) {
        console.log('✅ No significant memory hotspots detected');
    } else {
        hotspots.forEach((hotspot, i) => {
            console.log(`${i + 1}. ${hotspot.type}: ${hotspot.name}`);
            console.log(`   Size: ${formatBytes(hotspot.size)}`);
            console.log(`   Impact: ${hotspot.impact}`);
        });
    }
}

// Run the profiler
if (import.meta.main) {
    profileMemory().catch(console.error);
}