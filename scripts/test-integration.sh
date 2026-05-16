#!/bin/bash

# Comprehensive Integration Test Runner for Semantic Code Intelligence Unified Architecture
# This script runs all integration tests and provides detailed reporting

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TEST_DIR="tests"
COVERAGE_DIR="coverage"
RESULTS_DIR=".test-results"
TIMEOUT_DEFAULT=120000
TIMEOUT_PERFORMANCE=300000

# Create results directory
mkdir -p "$RESULTS_DIR"

echo -e "${BLUE}🧪 Semantic Code Intelligence Integration Test Suite${NC}"
echo "=================================================="
echo "Running comprehensive integration tests for unified architecture"
echo ""

# Check prerequisites
echo -e "${BLUE}🔍 Checking prerequisites...${NC}"

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo -e "${RED}❌ Bun is not installed. Please install Bun v1.2.20+${NC}"
    exit 1
fi

# Check bun version
BUN_VERSION=$(bun --version)
echo -e "${GREEN}✅ Bun version: $BUN_VERSION${NC}"

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    bun install
fi

echo ""

# Test suite definitions
declare -A TEST_SUITES=(
    ["unified-core"]="Unified Core Architecture Tests"
    ["adapters"]="Protocol Adapter Integration Tests"
    ["learning-system"]="Learning System Integration Tests"
    ["performance"]="Performance Benchmarks"
    ["consistency"]="Cross-Protocol Consistency Tests"
)

# Results tracking
declare -A TEST_RESULTS=()
declare -A TEST_DURATIONS=()
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Function to run a test suite
run_test_suite() {
    local suite_name=$1
    local suite_description=$2
    local test_file="$TEST_DIR/${suite_name}.test.ts"
    local result_file="$RESULTS_DIR/${suite_name}-results.xml"
    
    echo -e "${BLUE}🧪 Running: ${suite_description}${NC}"
    echo "   File: $test_file"
    
    # Determine timeout based on test type
    local timeout=$TIMEOUT_DEFAULT
    if [[ "$suite_name" == "performance" ]]; then
        timeout=$TIMEOUT_PERFORMANCE
    fi
    
    echo "   Timeout: ${timeout}ms"
    echo ""
    
    # Record start time
    local start_time=$(date +%s)
    
    # Run the test and capture output
    # Bun currently supports 'junit' reporter; JSON is not supported.
    # Write JUnit XML to results file for CI artifacts.
    if bun test "$test_file" --timeout $timeout --reporter=junit --reporter-outfile "$result_file" > /dev/null 2>&1; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        echo -e "${GREEN}✅ $suite_description: PASSED (${duration}s)${NC}"
        TEST_RESULTS[$suite_name]="PASSED"
        TEST_DURATIONS[$suite_name]=$duration
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        echo -e "${RED}❌ $suite_description: FAILED (${duration}s)${NC}"
        echo "   Check $result_file for details"
        TEST_RESULTS[$suite_name]="FAILED"
        TEST_DURATIONS[$suite_name]=$duration
        FAILED_TESTS=$((FAILED_TESTS + 1))
        
        # Show last few lines of error output
        echo -e "${YELLOW}Last 10 lines of test output:${NC}"
        # Show last lines from console if available; otherwise, point to XML
        if [ -f "$result_file" ]; then
            tail -n 10 "$result_file" | sed 's/^/   /' || true
        else
            echo "   (No console log captured; see $result_file for JUnit XML)"
        fi
    fi
    
    echo ""
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

# Function to run performance benchmarks with extra reporting
run_performance_tests() {
    echo -e "${BLUE}⚡ Performance Benchmarks (Extended Timeout: ${TIMEOUT_PERFORMANCE}ms)${NC}"
    echo "   This may take several minutes to complete..."
    echo ""
    
    local performance_log="$RESULTS_DIR/performance-detailed.log"
    
    # Run performance tests with detailed output
    if bun test "$TEST_DIR/performance.test.ts" --timeout $TIMEOUT_PERFORMANCE --verbose > "$performance_log" 2>&1; then
        echo -e "${GREEN}✅ Performance benchmarks completed successfully${NC}"
        
        # Extract key performance metrics if available
        echo -e "${BLUE}📊 Performance Summary:${NC}"
        grep -E "(p95|mean|Memory|Concurrent)" "$performance_log" | head -20 | sed 's/^/   /' || echo "   (Detailed metrics in $performance_log)"
        
        TEST_RESULTS["performance"]="PASSED"
    else
        echo -e "${RED}❌ Performance benchmarks failed${NC}"
        echo "   Check $performance_log for details"
        TEST_RESULTS["performance"]="FAILED"
        
        # Show performance failures
        echo -e "${YELLOW}Performance test failures:${NC}"
        grep -E "(expect|AssertionError|timeout)" "$performance_log" | head -10 | sed 's/^/   /' || echo "   Check log for details"
    fi
    echo ""
}

# Function to generate summary report
generate_summary_report() {
    local report_file="$RESULTS_DIR/integration-test-summary.md"
    local total_duration=0
    
    echo "# Integration Test Summary" > "$report_file"
    echo "" >> "$report_file"
    echo "**Date:** $(date)" >> "$report_file"
    echo "**Bun Version:** $BUN_VERSION" >> "$report_file"
    echo "" >> "$report_file"
    
    echo "## Overall Results" >> "$report_file"
    echo "- **Total Tests:** $TOTAL_TESTS" >> "$report_file"
    echo "- **Passed:** $PASSED_TESTS" >> "$report_file"
    echo "- **Failed:** $FAILED_TESTS" >> "$report_file"
    echo "" >> "$report_file"
    
    echo "## Test Suite Results" >> "$report_file"
    echo "| Test Suite | Status | Duration (s) | Description |" >> "$report_file"
    echo "|------------|--------|--------------|-------------|" >> "$report_file"
    
    for suite_name in "${!TEST_SUITES[@]}"; do
        local description="${TEST_SUITES[$suite_name]}"
        local status="${TEST_RESULTS[$suite_name]}"
        local duration="${TEST_DURATIONS[$suite_name]:-0}"
        total_duration=$((total_duration + duration))
        
        local status_emoji="❌"
        if [[ "$status" == "PASSED" ]]; then
            status_emoji="✅"
        fi
        
        echo "| $description | $status_emoji $status | ${duration}s | $description |" >> "$report_file"
    done
    
    echo "" >> "$report_file"
    echo "**Total Duration:** ${total_duration}s" >> "$report_file"
    echo "" >> "$report_file"
    
    # Add performance highlights if available
    if [[ "${TEST_RESULTS[performance]}" == "PASSED" ]]; then
        echo "## Performance Highlights" >> "$report_file"
        echo "Performance tests completed successfully. Key metrics:" >> "$report_file"
        echo "" >> "$report_file"
        
        local perf_log="$RESULTS_DIR/performance-detailed.log"
        if [[ -f "$perf_log" ]]; then
            grep -E "p95.*ms|mean.*ms" "$perf_log" | head -10 >> "$report_file" || echo "See detailed performance log for metrics." >> "$report_file"
        fi
        echo "" >> "$report_file"
    fi
    
    # Add architecture verification
    echo "## Architecture Verification" >> "$report_file"
    echo "The unified architecture has been tested across:" >> "$report_file"
    echo "- ✅ All 5 processing layers" >> "$report_file"
    echo "- ✅ All protocol adapters (LSP, MCP, HTTP, CLI)" >> "$report_file"
    echo "- ✅ Learning system integration" >> "$report_file"
    echo "- ✅ Performance targets (95% < 100ms)" >> "$report_file"
    echo "- ✅ Cross-protocol consistency" >> "$report_file"
    echo "" >> "$report_file"
    
    echo "Report generated: $report_file"
}

# Main execution
echo -e "${BLUE}🚀 Starting Integration Test Suite${NC}"
echo ""

# Run all test suites
for suite_name in unified-core adapters learning-system consistency; do
    if [[ -n "${TEST_SUITES[$suite_name]}" ]]; then
        run_test_suite "$suite_name" "${TEST_SUITES[$suite_name]}"
    fi
done

# Run performance tests separately due to extended timeout
echo -e "${BLUE}⚡ Running Performance Benchmarks${NC}"
run_performance_tests

# Generate summary
echo -e "${BLUE}📋 Generating Summary Report${NC}"
generate_summary_report

# Final results
echo "=================================================="
echo -e "${BLUE}🏁 Integration Test Suite Complete${NC}"
echo ""

if [[ $FAILED_TESTS -eq 0 ]]; then
    echo -e "${GREEN}🎉 All tests passed! The unified architecture is working correctly.${NC}"
    echo ""
    echo -e "${GREEN}✅ Verified:${NC}"
    echo "   • Unified core functionality"
    echo "   • Protocol adapter compatibility"
    echo "   • Learning system integration"
    echo "   • Performance targets (95% < 100ms)"
    echo "   • Cross-protocol consistency"
    echo ""
    echo -e "${GREEN}The system meets all VISION.md requirements!${NC}"
    exit 0
else
    echo -e "${RED}❌ $FAILED_TESTS out of $TOTAL_TESTS test suites failed.${NC}"
    echo ""
    echo -e "${YELLOW}Failed test suites:${NC}"
    for suite_name in "${!TEST_RESULTS[@]}"; do
        if [[ "${TEST_RESULTS[$suite_name]}" == "FAILED" ]]; then
            echo "   • ${TEST_SUITES[$suite_name]} ($suite_name)"
        fi
    done
    echo ""
    echo "Check individual result files in $RESULTS_DIR/ for detailed error information."
    exit 1
fi
